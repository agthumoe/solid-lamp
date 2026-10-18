import assert from 'node:assert/strict';
import test from 'node:test';

import { err, ok } from '@aetherion/shared';

import { collectStream } from '../inference/stream-event.ts';
import { createFakeInferenceClient } from './fake-inference-client.ts';

const input = { role: 'chat' as const, messages: [{ role: 'user' as const, content: 'hi' }] };
const options = (extra: { signal?: AbortSignal; deadline?: Date } = {}) => ({
  priority: 'interactive' as const,
  signal: extra.signal ?? new AbortController().signal,
  deadline: extra.deadline ?? new Date(Date.now() + 10_000),
});

await test('the fake streams a scripted reply with one terminal done', async () => {
  const fake = createFakeInferenceClient({ reply: () => ok('two words') });

  const result = await collectStream(fake.stream(input, options()));

  assert.ok(result.ok);
  assert.equal(result.value.text, 'two words');
  assert.equal(result.value.done.tokensOut, 2);
  assert.deepEqual(
    fake.calls.map((call) => call.kind),
    ['stream'],
  );
});

await test('the fake honours cancellation, expired deadlines and scripted errors', async () => {
  const aborted = new AbortController();
  aborted.abort();
  const fake = createFakeInferenceClient({
    reply: () => err({ code: 'MODEL_NOT_LOADED', message: 'scripted' }),
  });

  const cancelled = await fake.generate(input, options({ signal: aborted.signal }));
  const expired = await fake.embed(
    { texts: ['a'], kind: 'query' },
    options({ deadline: new Date(Date.now() - 1) }),
  );
  const scripted = await collectStream(fake.stream(input, options()));

  assert.equal(cancelled.ok ? null : cancelled.error.code, 'CANCELLED');
  assert.equal(expired.ok ? null : expired.error.code, 'DEADLINE_EXPIRED');
  assert.equal(scripted.ok ? null : scripted.error.error.code, 'MODEL_NOT_LOADED');
});

await test('cancelling mid-stream ends with a partial CANCELLED error', async () => {
  const controller = new AbortController();
  const fake = createFakeInferenceClient({ reply: () => ok('a b c d') });

  const events = [];
  for await (const event of fake.stream(input, options({ signal: controller.signal }))) {
    events.push(event);
    if (event.type === 'token') controller.abort();
  }

  assert.deepEqual(events.at(-1), {
    type: 'error',
    error: { code: 'CANCELLED', message: 'request was cancelled' },
    partial: true,
  });
});

await test('fake embeddings have the configured dimensions', async () => {
  const fake = createFakeInferenceClient({ dimensions: 5 });

  const result = await fake.embed({ texts: ['a', 'bb'], kind: 'document' }, options());

  assert.ok(result.ok);
  assert.deepEqual(
    result.value.vectors.map((vector) => vector.length),
    [5, 5],
  );
});
