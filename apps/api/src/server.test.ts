import assert from 'node:assert/strict';
import test from 'node:test';

import type { LogEvent, Logger } from '@aetherion/shared';

import type { ReadinessPorts } from './features/health/application/check-readiness.ts';
import { buildServer } from './server.ts';

const capture = () => {
  const events: LogEvent[] = [];
  const logger: Logger = {
    child: () => logger,
    debug: (event) => events.push(event),
    info: (event) => events.push(event),
    warn: (event) => events.push(event),
    error: (event) => events.push(event),
  };
  return { logger, events };
};

const ports = (database: 'ok' | 'unavailable' | 'not_configured' = 'ok'): ReadinessPorts => ({
  database: () => Promise.resolve(database),
  inference: () => Promise.resolve({ inference: 'ok', ollama: 'ok' }),
});

await test('liveness answers without touching dependencies', async () => {
  let probed = false;
  const app = buildServer({
    readiness: {
      database: () => {
        probed = true;
        return Promise.resolve('ok');
      },
      inference: () => Promise.resolve({ inference: 'ok', ollama: 'ok' }),
    },
    logger: capture().logger,
  });

  const response = await app.inject({ method: 'GET', url: '/api/v1/health' });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { status: 'ok' });
  assert.equal(probed, false);
});

await test('readiness is 200 when ready and 503 with per-dependency statuses otherwise', async () => {
  const ready = await buildServer({ readiness: ports(), logger: capture().logger }).inject({
    method: 'GET',
    url: '/api/v1/health/ready',
  });
  const degraded = await buildServer({
    readiness: ports('not_configured'),
    logger: capture().logger,
  }).inject({ method: 'GET', url: '/api/v1/health/ready' });

  assert.equal(ready.statusCode, 200);
  assert.equal(degraded.statusCode, 503);
  assert.deepEqual(degraded.json(), {
    status: 'not_ready',
    checks: { database: 'not_configured', inference: 'ok', ollama: 'ok' },
  });
});

await test('unknown routes return the error envelope with a server-generated request ID', async () => {
  const app = buildServer({ readiness: ports(), logger: capture().logger });

  const response = await app.inject({
    method: 'GET',
    url: '/api/v1/nope',
    headers: { 'x-request-id': 'attacker-chosen' },
  });
  const body = response.json<{ error: { code: string; requestId: string } }>();

  assert.equal(response.statusCode, 404);
  assert.equal(body.error.code, 'NOT_FOUND');
  assert.notEqual(body.error.requestId, 'attacker-chosen');
  assert.equal(response.headers['x-request-id'], body.error.requestId);
});

await test('malformed bodies map to a 400 envelope and every request is logged safely', async () => {
  const { logger, events } = capture();
  const app = buildServer({ readiness: ports(), logger });
  app.post('/api/v1/echo', () => ({}));

  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/echo',
    headers: { 'content-type': 'application/json' },
    payload: '{"secret":',
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.json<{ error: { code: string } }>().error.code, 'VALIDATION_FAILED');
  assert.doesNotMatch(JSON.stringify(events), /secret/);
  assert.ok(events.some((event) => event.event === 'http.request' && event.count === 400));
});

await test('unexpected handler errors become a generic 503 without internals', async () => {
  const { logger, events } = capture();
  const app = buildServer({ readiness: ports(), logger });
  app.get('/api/v1/boom', () => {
    throw new Error('db password=hunter2');
  });

  const response = await app.inject({ method: 'GET', url: '/api/v1/boom' });

  assert.equal(response.statusCode, 503);
  assert.doesNotMatch(response.body, /hunter2|Error/);
  assert.doesNotMatch(JSON.stringify(events), /hunter2/);
  assert.ok(events.some((event) => event.event === 'http.unhandled'));
});
