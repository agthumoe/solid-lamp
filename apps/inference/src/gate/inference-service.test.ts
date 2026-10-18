import assert from 'node:assert/strict';
import test from 'node:test';

import { LlmGate, type InferenceError, type StreamEvent } from '@aetherion/llm';
import { ok, parseModelsConfig, type Result } from '@aetherion/shared';

import {
  call,
  doneEvent,
  fakeAdapter,
  modelsConfig,
  serviceWith,
  tokensThenDone,
} from '../../test/support/fakes.ts';

const request = { role: 'chat' as const, messages: [{ role: 'user' as const, content: 'hi' }] };

const drain = async (events: AsyncIterable<StreamEvent>) => {
  const out: StreamEvent[] = [];
  for await (const event of events) out.push(event);
  return out;
};

await test('a stream emits started, tokens and one done that matches the gate result', async () => {
  const fake = fakeAdapter();
  const { service, residency, events } = serviceWith(fake.adapter);

  const out = await drain(service.stream(request, call()));

  assert.deepEqual(
    out.map((event) => event.type),
    ['started', 'token', 'token', 'done'],
  );
  assert.deepEqual(out[0]?.type === 'started' ? out[0].model : null, {
    role: 'chat',
    model: 'qwen3.5:9b',
    numCtx: 16384,
  });
  assert.equal(fake.loadedCalls(), 2);
  assert.deepEqual(residency, [
    { model: 'qwen3.5:9b', expected: 'warm', evicted: [], residentAfter: true },
  ]);
  assert.deepEqual(
    events.map((event) => [event.event, event.outcome, event.role]),
    [['inference.job', 'complete', 'chat']],
  );
});

await test('generate collects text and the resolved model', async () => {
  const { service } = serviceWith(fakeAdapter().adapter);

  const result = await service.generate(request, call());

  assert.ok(result.ok);
  assert.equal(result.value.text, 'Hello');
  assert.equal(result.value.model?.model, 'qwen3.5:9b');
});

await test('an unbound role fails before the gate with a non-partial error', async () => {
  const fake = fakeAdapter();
  const { service, gate } = serviceWith(fake.adapter);

  const out = await drain(service.stream({ ...request, role: 'deep' }, call()));

  assert.deepEqual(out, [
    {
      type: 'error',
      error: { code: 'INFERENCE_UNAVAILABLE', message: 'role deep is not bound' },
      partial: false,
    },
  ]);
  assert.equal(fake.streams.length, 0);
  assert.equal(gate.metrics().completed, 0);
});

await test('a full queue is a terminal QUEUE_FULL error with no output', async () => {
  let release: () => void = () => undefined;
  const fake = fakeAdapter({
    stream: async function* () {
      await new Promise<void>((resolve) => (release = resolve));
      yield doneEvent();
    },
  });
  const gate = new LlmGate({ maxInteractive: 1 });
  const { service } = serviceWith(fake.adapter, { gate });
  const active = drain(service.stream(request, call()));
  const queued = drain(service.stream(request, call()));
  await new Promise((resolve) => setImmediate(resolve));

  const overflow = await drain(service.stream(request, call()));
  release();
  await active;
  release();
  await queued;

  assert.deepEqual(overflow, [
    {
      type: 'error',
      error: { code: 'QUEUE_FULL', message: 'interactive queue is full (1)' },
      partial: false,
    },
  ]);
});

await test('an adapter failure after tokens is terminal and partial', async () => {
  const fake = fakeAdapter({
    stream: async function* () {
      await Promise.resolve();
      yield { type: 'token', text: 'par' };
      yield {
        type: 'error',
        error: { code: 'INFERENCE_UNAVAILABLE', message: 'dropped' },
        partial: true,
      };
    },
  });
  const { service, events } = serviceWith(fake.adapter);

  const out = await drain(service.stream(request, call()));

  assert.deepEqual(out.at(-1), {
    type: 'error',
    error: { code: 'INFERENCE_UNAVAILABLE', message: 'dropped' },
    partial: true,
  });
  assert.equal(events[0]?.errorCode, 'INFERENCE_UNAVAILABLE');
  assert.equal(events[0]?.level, 'warn');
});

await test('a deadline that passes during generation turns done into DEADLINE_EXPIRED', async () => {
  let now = 1_000;
  const fake = fakeAdapter({
    stream: async function* () {
      await Promise.resolve();
      yield { type: 'token', text: 'late' };
      now += 60_000; // the clock passes the deadline before the gate timer fires
      yield doneEvent();
    },
  });
  const { service } = serviceWith(fake.adapter, { now: () => now });

  const out = await drain(
    service.stream(request, call('interactive', { deadline: new Date(now + 50) })),
  );

  assert.deepEqual(
    out.map((event) => event.type),
    ['started', 'token', 'error'],
  );
  assert.deepEqual(out.at(-1), {
    type: 'error',
    error: { code: 'DEADLINE_EXPIRED', message: 'request deadline expired' },
    partial: true,
  });
});

await test('caller cancellation aborts the active job and reports CANCELLED', async () => {
  const controller = new AbortController();
  const fake = fakeAdapter({
    stream: async function* (_snapshot, _request, signal) {
      yield { type: 'token', text: 'a' };
      await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve()));
      yield {
        type: 'error',
        error: { code: 'CANCELLED', message: 'request was cancelled' },
        partial: true,
      };
    },
  });
  const { service } = serviceWith(fake.adapter);

  const out: StreamEvent[] = [];
  for await (const event of service.stream(
    request,
    call('interactive', { signal: controller.signal }),
  )) {
    out.push(event);
    if (event.type === 'token') controller.abort();
  }

  assert.deepEqual(out.at(-1), {
    type: 'error',
    error: { code: 'CANCELLED', message: 'request was cancelled' },
    partial: true,
  });
});

await test('residency is not recorded when the before-observation fails', async () => {
  const fake = fakeAdapter({
    loaded: () => ({ ok: false, error: { code: 'INFERENCE_UNAVAILABLE', message: 'down' } }),
    stream: () => tokensThenDone('x'),
  });
  const { service, residency } = serviceWith(fake.adapter);

  const out = await drain(service.stream(request, call()));

  assert.equal(out.at(-1)?.type, 'done');
  assert.deepEqual(residency, []);
});

await test('embed snapshots the role at enqueue and reports the model identity', async () => {
  const fake = fakeAdapter();
  let config = modelsConfig();
  let release: () => void = () => undefined;
  const gate = new LlmGate();
  const { service } = serviceWith(fake.adapter, { gate, config: () => config });
  const hold = gate.run(
    () =>
      new Promise<Result<string, InferenceError>>(
        (resolve) => (release = () => resolve(ok('held'))),
      ),
    call(),
  );

  const pending = service.embed({ texts: ['a', 'b'], kind: 'query' }, call('background'));
  const reloaded = parseModelsConfig(`
ollama: { base_url: 'http://127.0.0.1:11434' }
roles:
  chat: { model: 'qwen3.5:9b', num_ctx: 16384, residency: resident }
  router: { model: 'qwen3.5:9b', num_ctx: 16384, residency: shared }
  coder: { model: 'qwen3.5:9b', num_ctx: 16384, residency: shared }
  embed: { model: 'nomic-embed-text', num_ctx: 2048, residency: resident, dimensions: 768 }
`);
  assert.ok(reloaded.ok);
  config = reloaded.value;
  release();
  await hold;
  const result = await pending;

  assert.ok(result.ok);
  assert.deepEqual(result.value.model, {
    model: 'qwen3-embedding:0.6b',
    numCtx: 8192,
    dimensions: 3,
  });
  assert.equal(fake.embeds[0]?.snapshot.queryPrefix, 'q: ');
  assert.equal(fake.embeds[0]?.kind, 'query');
});

await test('embed failures pass through the gate as Results', async () => {
  const fake = fakeAdapter({
    embed: () => ({ ok: false, error: { code: 'INVALID_RESPONSE', message: 'dims' } }),
  });
  const { service } = serviceWith(fake.adapter);

  const result = await service.embed({ texts: ['a'], kind: 'document' }, call('background'));

  assert.equal(result.ok ? null : result.error.code, 'INVALID_RESPONSE');
});
