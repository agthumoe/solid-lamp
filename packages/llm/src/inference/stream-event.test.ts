import assert from 'node:assert/strict';
import test from 'node:test';

import { collectStream, type StreamDone, type StreamEvent } from './stream-event.ts';

async function* events(list: readonly StreamEvent[]): AsyncIterable<StreamEvent> {
  for (const event of list) {
    await Promise.resolve();
    yield event;
  }
}

const done: StreamDone = {
  type: 'done',
  finishReason: 'stop',
  tokensIn: 5,
  tokensOut: 2,
  toolCalls: [],
  timings: { totalMs: 10, loadMs: 0, promptEvalMs: 3, evalMs: 7 },
};

await test('collects text, model and terminal done while forwarding tokens', async () => {
  const seen: string[] = [];
  const model = { role: 'chat', model: 'qwen3.5:9b', numCtx: 16384 };

  const result = await collectStream(
    events([
      { type: 'started', model, queuedMs: 3 },
      { type: 'token', text: 'Hel' },
      { type: 'token', text: 'lo' },
      done,
    ]),
    (text) => seen.push(text),
  );

  assert.ok(result.ok);
  assert.equal(result.value.text, 'Hello');
  assert.deepEqual(result.value.model, model);
  assert.equal(result.value.done, done);
  assert.deepEqual(seen, ['Hel', 'lo']);
});

await test('an error after tokens keeps partial text and marks it partial', async () => {
  const result = await collectStream(
    events([
      { type: 'token', text: 'Hal' },
      {
        type: 'error',
        error: { code: 'INFERENCE_UNAVAILABLE', message: 'connection reset' },
        partial: true,
      },
    ]),
  );

  assert.deepEqual(result.ok ? null : result.error, {
    error: { code: 'INFERENCE_UNAVAILABLE', message: 'connection reset' },
    partial: true,
    partialText: 'Hal',
  });
});

await test('a stream without a terminal event is INVALID_RESPONSE', async () => {
  const result = await collectStream(events([{ type: 'token', text: 'x' }]));

  assert.equal(result.ok ? null : result.error.error.code, 'INVALID_RESPONSE');
  assert.equal(result.ok ? null : result.error.partial, true);
});
