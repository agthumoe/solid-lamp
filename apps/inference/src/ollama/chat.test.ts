import assert from 'node:assert/strict';
import test from 'node:test';

import type { GenerationSnapshot, StreamEvent } from '@aetherion/llm';

import { fakeFetch, noSleep, type Reply } from '../../test/support/fake-fetch.ts';
import { createOllamaAdapter } from './ollama-adapter.ts';

const snapshot: GenerationSnapshot = Object.freeze({
  kind: 'generation',
  role: 'chat',
  model: 'qwen3.5:9b',
  numCtx: 16384,
  think: false,
  options: Object.freeze({ temperature: 0.6, seed: 7 }),
});

const final = {
  done: true,
  done_reason: 'stop',
  message: { role: 'assistant', content: '' },
  prompt_eval_count: 12,
  eval_count: 3,
  total_duration: 900_000_000,
  load_duration: 400_000_000,
  prompt_eval_duration: 100_000_000,
  eval_duration: 300_000_000,
};
const token = (content: string) => ({ done: false, message: { role: 'assistant', content } });
const request = { messages: [{ role: 'user' as const, content: 'hi' }] };

const setup = (replies: Reply[], sleeps: number[] = []) => {
  const fake = fakeFetch(replies);
  const adapter = createOllamaAdapter({
    baseUrl: 'http://127.0.0.1:11434',
    fetch: fake.fetch,
    sleep: (ms) => {
      sleeps.push(ms);
      return noSleep();
    },
  });
  return { adapter, fake, sleeps };
};

const drain = async (events: AsyncIterable<StreamEvent>) => {
  const out: StreamEvent[] = [];
  for await (const event of events) out.push(event);
  return out;
};

await test('sends num_ctx, every sampling option and think explicitly', async () => {
  const { adapter, fake } = setup([{ kind: 'ndjson', lines: [token('ok'), final] }]);

  await drain(adapter.stream(snapshot, request, new AbortController().signal));

  assert.equal(fake.calls[0]?.url, 'http://127.0.0.1:11434/api/chat');
  assert.deepEqual(fake.calls[0]?.body, {
    model: 'qwen3.5:9b',
    messages: request.messages,
    think: false,
    stream: true,
    options: { temperature: 0.6, seed: 7, num_ctx: 16384 },
  });
});

await test('streams tokens then exactly one done with counts, timings and tool calls', async () => {
  const toolChunk = {
    done: false,
    message: {
      role: 'assistant',
      content: '',
      tool_calls: [{ function: { name: 'brain.search', arguments: { query: 'x' } } }],
    },
  };
  const { adapter } = setup([
    {
      kind: 'ndjson',
      lines: [token('Hel'), token('lo'), toolChunk, { ...final, done_reason: 'length' }],
    },
  ]);

  const events = await drain(adapter.stream(snapshot, request, new AbortController().signal));

  assert.deepEqual(events, [
    { type: 'token', text: 'Hel' },
    { type: 'token', text: 'lo' },
    {
      type: 'done',
      finishReason: 'length',
      tokensIn: 12,
      tokensOut: 3,
      toolCalls: [{ name: 'brain.search', arguments: { query: 'x' } }],
      timings: { totalMs: 900, loadMs: 400, promptEvalMs: 100, evalMs: 300 },
    },
  ]);
});

await test('generate collects the same stream into a Result', async () => {
  const { adapter } = setup([{ kind: 'ndjson', lines: [token('a'), token('b'), final] }]);

  const result = await adapter.generate(snapshot, request, new AbortController().signal);

  assert.ok(result.ok);
  assert.equal(result.value.text, 'ab');
  assert.equal(result.value.done.tokensOut, 3);
});

await test('a transient failure before output is retried once with backoff', async () => {
  const { adapter, fake, sleeps } = setup([
    { kind: 'network' },
    { kind: 'ndjson', lines: [token('ok'), final] },
  ]);

  const events = await drain(adapter.stream(snapshot, request, new AbortController().signal));

  assert.equal(fake.calls.length, 2);
  assert.deepEqual(sleeps, [250]);
  assert.equal(events.at(-1)?.type, 'done');
});

await test('retries stop at the attempt limit and report a non-partial error', async () => {
  const { adapter, fake } = setup([
    { kind: 'json', status: 503, body: { error: 'busy' } },
    { kind: 'json', status: 500, body: { error: 'secret prompt text' } },
  ]);

  const events = await drain(adapter.stream(snapshot, request, new AbortController().signal));

  assert.equal(fake.calls.length, 2);
  assert.deepEqual(events, [
    {
      type: 'error',
      error: { code: 'INFERENCE_UNAVAILABLE', message: '/api/chat: Ollama 500' },
      partial: false,
    },
  ]);
});

await test('a failure after the first token is terminal, partial, and never retried', async () => {
  const { adapter, fake } = setup([{ kind: 'drop', lines: [token('par')] }, { kind: 'network' }]);

  const events = await drain(adapter.stream(snapshot, request, new AbortController().signal));

  assert.equal(fake.calls.length, 1);
  assert.equal(fake.pending(), 1);
  assert.deepEqual(events.at(-1), {
    type: 'error',
    error: { code: 'INFERENCE_UNAVAILABLE', message: 'chat stream was interrupted' },
    partial: true,
  });
});

await test('a connection drop before any token is transient and retried', async () => {
  const { adapter, fake } = setup([
    { kind: 'drop', lines: [] },
    { kind: 'ndjson', lines: [token('ok'), final] },
  ]);

  const events = await drain(adapter.stream(snapshot, request, new AbortController().signal));

  assert.equal(fake.calls.length, 2);
  assert.deepEqual(
    events.map((event) => event.type),
    ['token', 'done'],
  );
});

await test('model not found is MODEL_NOT_LOADED and not retried', async () => {
  const { adapter, fake } = setup([{ kind: 'json', status: 404, body: { error: 'not found' } }]);

  const events = await drain(adapter.stream(snapshot, request, new AbortController().signal));

  assert.equal(fake.calls.length, 1);
  assert.deepEqual(
    events.map((event) => (event.type === 'error' ? event.error.code : event.type)),
    ['MODEL_NOT_LOADED'],
  );
});

await test('malformed lines, schema violations and a missing done are INVALID_RESPONSE', async () => {
  for (const lines of [['{not json'], [{ done: 'yes' }], [token('x')]]) {
    const { adapter } = setup([{ kind: 'ndjson', lines }]);

    const events = await drain(adapter.stream(snapshot, request, new AbortController().signal));
    const last = events.at(-1);

    assert.equal(last?.type === 'error' ? last.error.code : last?.type, 'INVALID_RESPONSE');
    assert.equal(
      events.filter((event) => event.type === 'error' || event.type === 'done').length,
      1,
    );
  }
});

await test('an in-stream Ollama error is reported without echoing its text', async () => {
  const { adapter } = setup([
    { kind: 'ndjson', lines: [token('a'), { error: 'CUDA out of memory: private' }] },
  ]);

  const events = await drain(adapter.stream(snapshot, request, new AbortController().signal));

  assert.deepEqual(events.at(-1), {
    type: 'error',
    error: { code: 'INFERENCE_UNAVAILABLE', message: 'Ollama reported a stream error' },
    partial: true,
  });
});

await test('gate aborts map to the gate reason and stop without retry', async () => {
  for (const reason of ['DEADLINE_EXPIRED', 'CANCELLED'] as const) {
    const { adapter, fake } = setup([{ kind: 'hang' }, { kind: 'network' }]);
    const controller = new AbortController();

    const pending = drain(adapter.stream(snapshot, request, controller.signal));
    controller.abort(reason);
    const events = await pending;

    assert.equal(fake.calls.length, 1);
    assert.equal(events.length, 1);
    assert.equal(events[0]?.type === 'error' ? events[0].error.code : null, reason);
    assert.equal(events[0]?.type === 'error' ? events[0].partial : null, false);
  }
});

await test('the adapter refuses a non-private Ollama URL', () => {
  assert.throws(
    () => createOllamaAdapter({ baseUrl: 'http://example.com:11434', fetch: fakeFetch([]).fetch }),
    RangeError,
  );
});
