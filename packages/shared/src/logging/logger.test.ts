import assert from 'node:assert/strict';
import { Writable } from 'node:stream';
import test from 'node:test';

import {
  createLogger,
  createPinoLogger,
  validateLogEvent,
  type LogBindings,
  type LogEvent,
  type LoggerIdentity,
} from './logger.ts';

const capture = () => {
  let output = '';
  const destination = new Writable({
    write(chunk: Buffer, _encoding, done) {
      output += chunk.toString();
      done();
    },
  });
  return { destination, read: () => output };
};

await test('writes allowlisted events with scoped context as JSON', () => {
  const sink = capture();
  const logger = createLogger({ service: 'api', component: 'approvals' }, sink.destination);

  logger.child({ requestId: 'req_1', runId: 'run_1' }).info({
    event: 'approval.decided',
    outcome: 'complete',
    durationMs: 12,
  });

  const record = JSON.parse(sink.read()) as Record<string, unknown>;
  assert.equal(record.level, 30);
  assert.equal(record.service, 'api');
  assert.equal(record.component, 'approvals');
  assert.equal(record.requestId, 'req_1');
  assert.equal(record.runId, 'run_1');
  assert.equal(record.event, 'approval.decided');
  assert.equal(record.outcome, 'complete');
  assert.equal(record.durationMs, 12);
});

await test('enables debug events only when the caller selects the debug level', () => {
  const sink = capture();
  const logger = createLogger({ service: 'api' }, sink.destination, 'debug');

  logger.debug({ event: 'diagnostic.checkpoint' });

  assert.equal(sink.read().includes('diagnostic.checkpoint'), true);
});

await test('rejects arbitrary/private event fields before they reach the logger', () => {
  const sink = capture();
  const logger = createLogger({ service: 'api' }, sink.destination);

  assert.throws(() => validateLogEvent({ event: 'chat.complete', prompt: 'synthetic-secret' }));
  assert.throws(() =>
    logger.info({ event: 'chat.complete', content: 'synthetic-secret' } as unknown as LogEvent),
  );
  assert.equal(sink.read().includes('synthetic-secret'), false);
});

await test('rejects nested metadata and invalid correlation identifiers', () => {
  assert.throws(() => validateLogEvent({ event: 'chat.complete', details: { x: 1 } }));
  assert.throws(() =>
    createLogger({ service: 'api', token: 'synthetic-secret' } as unknown as Parameters<
      typeof createLogger
    >[0]),
  );
  assert.throws(() => createLogger({ component: 'api' } as unknown as LoggerIdentity));
  assert.throws(() =>
    createLogger({ service: 'api' }).child({ service: 'worker' } as unknown as LogBindings),
  );
  assert.throws(() => createLogger({ service: 'api' }).child({ requestId: 'owner@example.com' }));
});

await test('redacts credential-shaped keys as a secondary defense', () => {
  const sink = capture();
  const rawPino = createPinoLogger({ service: 'api' }, sink.destination);

  rawPino.info({ authorization: 'synthetic-token', nested: { password: 'synthetic-password' } });

  assert.equal(sink.read().includes('synthetic-token'), false);
  assert.equal(sink.read().includes('synthetic-password'), false);
  assert.equal(sink.read().match(/\[REDACTED\]/g)?.length, 2);
});
