import assert from 'node:assert/strict';
import test from 'node:test';

import { INFERENCE_KEY_HEADER, LlmGate, streamEventSchema } from '@aetherion/llm';

import { capturingLogger, doneEvent, fakeAdapter, serviceWith } from '../test/support/fakes.ts';
import type { ReadinessProbe } from './rpc/health-routes.ts';
import { buildServer } from './server.ts';

const SECRET = 's'.repeat(40);
const auth = { [INFERENCE_KEY_HEADER]: SECRET };

const readiness = (ollama = true): ReadinessProbe => ({
  ollama: () => Promise.resolve(ollama),
  gate: () => new LlmGate().metrics(),
  residency: () => ({ coldLoads: 0, contextReloads: 0, evictions: 0, notResidentAfter: 0 }),
});

const setup = (
  fake = fakeAdapter(),
  options: { ollama?: boolean; gate?: LlmGate; secret?: string } = {},
) => {
  const { service } = serviceWith(fake.adapter, options.gate ? { gate: options.gate } : {});
  const { logger, events } = capturingLogger();
  const app = buildServer({
    service,
    readiness: readiness(options.ollama ?? true),
    secret: options.secret ?? SECRET,
    logger,
  });
  return { app, fake, events };
};

const generateBody = (extra: Record<string, unknown> = {}) => ({
  role: 'chat',
  messages: [{ role: 'user', content: 'private question' }],
  priority: 'interactive',
  deadline: new Date(Date.now() + 10_000).toISOString(),
  ...extra,
});

await test('liveness needs no key; readiness needs the key and reports Ollama state', async () => {
  const { app } = setup(fakeAdapter(), { ollama: false });

  const live = await app.inject({ method: 'GET', url: '/livez' });
  const anonymous = await app.inject({ method: 'GET', url: '/readyz' });
  const ready = await app.inject({ method: 'GET', url: '/readyz', headers: auth });

  assert.equal(live.statusCode, 200);
  assert.equal(anonymous.statusCode, 401);
  assert.equal(ready.statusCode, 503);
  const body = ready.json<{ status: string; ollama: string; gate: { completed: number } }>();
  assert.equal(body.status, 'not_ready');
  assert.equal(body.ollama, 'unavailable');
  assert.equal(body.gate.completed, 0);
  assert.doesNotMatch(ready.body, /11434|secret|sss/);
});

await test('a missing or wrong key is 401 and never reaches the gate', async () => {
  const { app, fake } = setup();

  for (const headers of [{}, { [INFERENCE_KEY_HEADER]: 'wrong' }]) {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/generate',
      headers,
      payload: generateBody(),
    });

    assert.equal(response.statusCode, 401);
    assert.deepEqual(response.json(), {
      error: { code: 'UNAUTHENTICATED', message: 'missing or invalid inference key' },
    });
  }
  assert.equal(fake.streams.length, 0);
});

await test('generate returns text, the resolved model and the done event', async () => {
  const { app, fake } = setup();

  const response = await app.inject({
    method: 'POST',
    url: '/v1/generate',
    headers: auth,
    payload: generateBody({ think: true }),
  });

  assert.equal(response.statusCode, 200);
  const body = response.json<{ text: string; model: { model: string }; done: { type: string } }>();
  assert.equal(body.text, 'Hello');
  assert.equal(body.model.model, 'qwen3.5:9b');
  assert.equal(body.done.type, 'done');
  assert.equal(fake.streams[0]?.request.think, true);
});

await test('invalid bodies are 400 with field paths and no echoed values', async () => {
  const { app, fake } = setup();
  const cases = [
    generateBody({ role: 'gpt-4' }),
    generateBody({ model: 'qwen3.5:9b' }), // callers name roles, never model tags
    generateBody({ messages: [] }),
    generateBody({ deadline: 'tomorrow' }),
  ];

  for (const payload of cases) {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/generate',
      headers: auth,
      payload,
    });

    assert.equal(response.statusCode, 400);
    assert.equal(response.json<{ error: { code: string } }>().error.code, 'VALIDATION_FAILED');
    assert.doesNotMatch(response.body, /gpt-4|qwen3\.5|tomorrow|private question/);
  }
  assert.equal(fake.streams.length, 0);
});

await test('a deadline beyond the server limit is rejected before the gate', async () => {
  const { app } = setup();

  const response = await app.inject({
    method: 'POST',
    url: '/v1/generate',
    headers: auth,
    payload: generateBody({ deadline: new Date(Date.now() + 3_600_000).toISOString() }),
  });

  assert.equal(response.statusCode, 400);
});

await test('inference failures map to stable statuses and envelopes', async () => {
  const fake = fakeAdapter({
    stream: async function* () {
      await Promise.resolve();
      yield { type: 'error', error: { code: 'MODEL_NOT_LOADED', message: 'gone' }, partial: false };
    },
  });
  const { app } = setup(fake);

  const unavailable = await app.inject({
    method: 'POST',
    url: '/v1/generate',
    headers: auth,
    payload: generateBody(),
  });
  const unbound = await app.inject({
    method: 'POST',
    url: '/v1/generate',
    headers: auth,
    payload: generateBody({ role: 'deep' }),
  });
  const expired = await app.inject({
    method: 'POST',
    url: '/v1/generate',
    headers: auth,
    payload: generateBody({ deadline: new Date(Date.now() - 1000).toISOString() }),
  });

  assert.equal(unavailable.statusCode, 503);
  assert.deepEqual(unavailable.json(), { error: { code: 'MODEL_NOT_LOADED', message: 'gone' } });
  assert.equal(unbound.statusCode, 503);
  assert.equal(expired.statusCode, 504);
});

await test('a full queue is 429 QUEUE_FULL while admitted requests still complete', async () => {
  const releases: (() => void)[] = [];
  const fake = fakeAdapter({
    stream: async function* () {
      await new Promise<void>((resolve) => releases.push(resolve));
      yield doneEvent();
    },
  });
  const { app } = setup(fake, { gate: new LlmGate({ maxInteractive: 1 }) });
  const send = () =>
    app.inject({ method: 'POST', url: '/v1/generate', headers: auth, payload: generateBody() });
  const active = send();
  await new Promise((resolve) => setImmediate(resolve));
  const queued = send();
  await new Promise((resolve) => setImmediate(resolve));

  const overflow = await send();
  releases.shift()?.();
  const first = await active;
  await new Promise((resolve) => setImmediate(resolve));
  releases.shift()?.();
  const second = await queued;

  assert.equal(overflow.statusCode, 429);
  assert.deepEqual(overflow.json(), {
    error: { code: 'QUEUE_FULL', message: 'interactive queue is full (1)' },
  });
  assert.equal(first.statusCode, 200);
  assert.equal(second.statusCode, 200);
});

await test('stream responds with NDJSON events ending in one terminal event', async () => {
  const { app } = setup();

  const response = await app.inject({
    method: 'POST',
    url: '/v1/stream',
    headers: auth,
    payload: generateBody(),
  });

  assert.equal(response.statusCode, 200);
  assert.match(response.headers['content-type'] ?? '', /application\/x-ndjson/);
  const events = response.body
    .trim()
    .split('\n')
    .map((line) => streamEventSchema.parse(JSON.parse(line)));
  assert.deepEqual(
    events.map((event) => event.type),
    ['started', 'token', 'token', 'done'],
  );
});

await test('embed validates kind and returns vectors with the embed identity', async () => {
  const { app, fake } = setup();
  const payload = {
    texts: ['a'],
    kind: 'document',
    priority: 'background',
    deadline: new Date(Date.now() + 10_000).toISOString(),
  };

  const response = await app.inject({ method: 'POST', url: '/v1/embed', headers: auth, payload });
  const invalid = await app.inject({
    method: 'POST',
    url: '/v1/embed',
    headers: auth,
    payload: { ...payload, kind: 'both' },
  });

  assert.equal(response.statusCode, 200);
  const { profile, ...rest } = response.json<{ profile: Record<string, unknown> }>();
  assert.deepEqual(rest, {
    vectors: [[0.1, 0.2, 0.3]],
    model: { model: 'qwen3-embedding:0.6b', numCtx: 8192, dimensions: 3 },
    tokensIn: 1,
    totalMs: 3,
  });
  assert.match(String(profile.id), /^ep-[0-9a-f]{24}$/);
  assert.deepEqual(
    { model: profile.model, dimensions: profile.dimensions, numCtx: profile.numCtx },
    { model: 'qwen3-embedding:0.6b', dimensions: 3, numCtx: 8192 },
  );
  assert.equal(fake.embeds[0]?.kind, 'document');
  assert.equal(invalid.statusCode, 400);
});

await test('unknown routes are 404 envelopes and logs carry no request content', async () => {
  const { app, events } = setup();

  const response = await app.inject({ method: 'GET', url: '/v1/models', headers: auth });
  await app.inject({ method: 'POST', url: '/v1/generate', headers: auth, payload: generateBody() });

  assert.equal(response.statusCode, 404);
  assert.deepEqual(response.json(), { error: { code: 'NOT_FOUND', message: 'unknown route' } });
  assert.doesNotMatch(JSON.stringify(events), /private question|sss/);
  assert.ok(events.some((event) => event.event === 'http.request' && event.count === 200));
});

await test('malformed JSON bodies are a 400 envelope', async () => {
  const { app } = setup();

  const response = await app.inject({
    method: 'POST',
    url: '/v1/generate',
    headers: { ...auth, 'content-type': 'application/json' },
    payload: '{"role":',
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.json<{ error: { code: string } }>().error.code, 'VALIDATION_FAILED');
});

await test('embed profiles are listed behind the key; a pinned profile is validated', async () => {
  const { app } = setup();
  const unauth = await app.inject({ method: 'GET', url: '/v1/embed-profiles' });
  assert.equal(unauth.statusCode, 401);

  const listing = await app.inject({ method: 'GET', url: '/v1/embed-profiles', headers: auth });
  assert.equal(listing.statusCode, 200);
  const body = listing.json<{
    defaultProfileId: string;
    profiles: { id: string; model: string }[];
  }>();
  assert.equal(body.profiles[0]?.model, 'qwen3-embedding:0.6b');
  assert.equal(body.defaultProfileId, body.profiles[0]?.id);

  const payload = {
    texts: ['a'],
    kind: 'query',
    priority: 'interactive',
    deadline: new Date(Date.now() + 10_000).toISOString(),
  };
  const pinned = await app.inject({
    method: 'POST',
    url: '/v1/embed',
    headers: auth,
    payload: { ...payload, profileId: body.defaultProfileId },
  });
  assert.equal(pinned.statusCode, 200);
  assert.equal(pinned.json<{ profile: { id: string } }>().profile.id, body.defaultProfileId);

  const malformed = await app.inject({
    method: 'POST',
    url: '/v1/embed',
    headers: auth,
    payload: { ...payload, profileId: 'qwen3-embedding:0.6b' }, // a model tag is never accepted
  });
  assert.equal(malformed.statusCode, 400);
  const unknown = await app.inject({
    method: 'POST',
    url: '/v1/embed',
    headers: auth,
    payload: { ...payload, profileId: 'ep-ffffffffffffffffffffffff' },
  });
  assert.equal(unknown.statusCode, 409);
  assert.equal(unknown.json<{ error: { code: string } }>().error.code, 'PROFILE_UNAVAILABLE');
});
