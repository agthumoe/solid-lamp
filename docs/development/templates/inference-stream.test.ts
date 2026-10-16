// Template: tests for the streaming failure contract, using a fake event stream.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { collectStream, type StreamEvent } from './inference-stream.ts';

async function* fakeStream(events: StreamEvent[]): AsyncIterable<StreamEvent> {
  for (const event of events) {
    await Promise.resolve();
    yield event;
  }
}

const started: StreamEvent = {
  type: 'started',
  model: { role: 'chat', model: 'qwen3.5:9b', numCtx: 16384 },
  queuedMs: 12,
};

void describe('collectStream', () => {
  void it('returns the full text and forwards each token on done', async () => {
    const seen: string[] = [];

    const result = await collectStream(
      fakeStream([
        started,
        { type: 'token', text: 'Hel' },
        { type: 'token', text: 'lo' },
        { type: 'done', finishReason: 'stop', tokensIn: 5, tokensOut: 2 },
      ]),
      (t) => seen.push(t),
    );

    assert.ok(result.ok);
    assert.equal(result.value.text, 'Hello');
    assert.equal(result.value.model?.model, 'qwen3.5:9b');
    assert.deepEqual(seen, ['Hel', 'lo']);
  });

  void it('reports a queue failure before output as non-partial (safe to retry)', async () => {
    const result = await collectStream(
      fakeStream([
        { type: 'error', error: { code: 'QUEUE_FULL', message: 'busy' }, partial: false },
      ]),
    );

    assert.ok(!result.ok);
    assert.equal(result.error.error.code, 'QUEUE_FULL');
    assert.equal(result.error.partial, false);
  });

  void it('keeps partial text when the stream fails after output started', async () => {
    const result = await collectStream(
      fakeStream([
        started,
        { type: 'token', text: 'Half an ans' },
        { type: 'error', error: { code: 'CANCELLED', message: 'owner stopped' }, partial: true },
      ]),
    );

    assert.ok(!result.ok);
    assert.equal(result.error.partial, true);
    assert.equal(result.error.partialText, 'Half an ans');
  });

  void it('treats a stream without a terminal event as INVALID_RESPONSE', async () => {
    const result = await collectStream(fakeStream([started, { type: 'token', text: 'x' }]));

    assert.ok(!result.ok);
    assert.equal(result.error.error.code, 'INVALID_RESPONSE');
    assert.equal(result.error.partial, true);
  });
});
