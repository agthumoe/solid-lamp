import assert from 'node:assert/strict';
import test from 'node:test';

import type { LogEvent, Logger } from '@aetherion/shared';
import Fastify from 'fastify';

import { registerErrorEnvelope } from './error-envelope.ts';
import {
  registerServiceScope,
  SERVICE_KEY_HEADER,
  type ServiceScopeOptions,
} from './service-scope.ts';

const KEY = 'k'.repeat(40);

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

const build = (overrides: Partial<ServiceScopeOptions> = {}, gate?: Promise<void>) => {
  const { logger, events } = capture();
  const app = Fastify({ logger: false });
  registerErrorEnvelope(app, logger);
  const work = { handled: 0, parsed: 0 };
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_request, body, done) => {
    work.parsed += 1;
    done(null, JSON.parse(String(body)) as unknown);
  });
  registerServiceScope(
    app,
    { serviceKey: KEY, boundHost: '127.0.0.1', maxInFlight: 2, logger, ...overrides },
    (scope) => {
      scope.post('/api/v1/brain/probe', async () => {
        work.handled += 1;
        await gate;
        return { ok: true };
      });
    },
  );
  app.get('/api/v1/open', () => ({ open: true }));
  return { app, work, events };
};

const call = (
  app: ReturnType<typeof build>['app'],
  headers: Record<string, string> = { [SERVICE_KEY_HEADER]: KEY },
  remoteAddress = '127.0.0.1',
) =>
  app.inject({
    method: 'POST',
    url: '/api/v1/brain/probe?q=secret-query',
    headers: { 'content-type': 'application/json', ...headers },
    payload: '{"query":"private note text"}',
    remoteAddress,
  });

await test('a request with the right key from loopback reaches the handler, marked no-store', async () => {
  const { app, work } = build();
  const response = await call(app);

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.deepEqual(work, { handled: 1, parsed: 1 });
});

await test('every rejection happens before body parsing or handler work and is no-store', async () => {
  const cases: [
    string,
    ReturnType<typeof build>,
    Parameters<typeof call>[1],
    string,
    number,
    string,
  ][] = [
    [
      'no key configured',
      build({ serviceKey: undefined }),
      undefined,
      '127.0.0.1',
      503,
      'UNAVAILABLE',
    ],
    [
      'non-loopback bind',
      build({ boundHost: '100.101.102.103' }),
      undefined,
      '127.0.0.1',
      403,
      'FORBIDDEN',
    ],
    ['wildcard bind', build({ boundHost: '0.0.0.0' }), undefined, '127.0.0.1', 403, 'FORBIDDEN'],
    ['tailscale peer', build(), undefined, '100.101.102.103', 403, 'FORBIDDEN'],
    [
      'browser origin',
      build(),
      { [SERVICE_KEY_HEADER]: KEY, origin: 'http://127.0.0.1:3000' },
      '127.0.0.1',
      403,
      'FORBIDDEN',
    ],
    [
      'fetch metadata',
      build(),
      { [SERVICE_KEY_HEADER]: KEY, 'sec-fetch-site': 'same-origin' },
      '127.0.0.1',
      403,
      'FORBIDDEN',
    ],
    ['missing key', build(), {}, '127.0.0.1', 401, 'UNAUTHENTICATED'],
    [
      'wrong key',
      build(),
      { [SERVICE_KEY_HEADER]: 'x'.repeat(40) },
      '127.0.0.1',
      401,
      'UNAUTHENTICATED',
    ],
    [
      'key prefix',
      build(),
      { [SERVICE_KEY_HEADER]: KEY.slice(0, 39) },
      '127.0.0.1',
      401,
      'UNAUTHENTICATED',
    ],
    [
      'inference-style header',
      build(),
      { 'x-aetherion-inference-key': KEY },
      '127.0.0.1',
      401,
      'UNAUTHENTICATED',
    ],
  ];
  for (const [name, { app, work, events }, headers, peer, status, code] of cases) {
    const response = await call(app, headers, peer);

    assert.equal(response.statusCode, status, name);
    assert.equal(response.json<{ error: { code: string } }>().error.code, code, name);
    assert.equal(response.headers['cache-control'], 'no-store', name);
    assert.equal(response.headers['access-control-allow-origin'], undefined, name);
    assert.deepEqual(work, { handled: 0, parsed: 0 }, name);
    const logged = JSON.stringify(events);
    for (const secret of ['secret-query', 'private note text', KEY, '/api/v1/brain'])
      assert.ok(!logged.includes(secret), `${name}: ${secret} logged`);
  }
});

await test('loopback spellings are accepted for the bind and the peer', async () => {
  for (const host of ['127.0.0.1', '::1', '[::1]', 'localhost', '127.4.5.6']) {
    const { app } = build({ boundHost: host });
    assert.equal((await call(app, undefined, '::ffff:127.0.0.1')).statusCode, 200, host);
  }
});

await test('in-flight requests are bounded and slots are released after completion', async () => {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const { app, work } = build({}, gate);
  const first = call(app);
  const second = call(app);
  await new Promise((resolve) => setTimeout(resolve, 20));

  const third = await call(app);
  assert.equal(third.statusCode, 429);
  assert.equal(work.handled, 2);

  release();
  assert.equal((await first).statusCode, 200);
  assert.equal((await second).statusCode, 200);
  assert.equal((await call(app)).statusCode, 200);
});

await test('routes outside the scope are unaffected', async () => {
  const { app } = build({ serviceKey: undefined });
  const response = await app.inject({ method: 'GET', url: '/api/v1/open' });

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['cache-control'], undefined);
});

await test('a client that disconnects mid-request releases its slot (real socket)', async () => {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const { app, work } = build({ maxInFlight: 1 }, gate);
  await app.listen({ host: '127.0.0.1', port: 0 });
  try {
    const { port } = app.server.address() as { port: number };
    const aborted = new AbortController();
    const pending = fetch(`http://127.0.0.1:${port}/api/v1/brain/probe`, {
      method: 'POST',
      headers: { [SERVICE_KEY_HEADER]: KEY, 'content-type': 'application/json' },
      body: '{}',
      signal: aborted.signal,
    }).catch(() => undefined);
    while (work.handled === 0) await new Promise((resolve) => setTimeout(resolve, 5));
    aborted.abort();
    await pending;
    await new Promise((resolve) => setTimeout(resolve, 50));
    release();

    const next = await fetch(`http://127.0.0.1:${port}/api/v1/brain/probe`, {
      method: 'POST',
      headers: { [SERVICE_KEY_HEADER]: KEY, 'content-type': 'application/json' },
      body: '{}',
    });
    assert.equal(next.status, 200);
    assert.equal(next.headers.get('cache-control'), 'no-store');
  } finally {
    release();
    await app.close();
  }
});
