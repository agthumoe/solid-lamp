import assert from 'node:assert/strict';
import test from 'node:test';

import type { EmbedSnapshot } from '@aetherion/llm';

import { fakeFetch, noSleep, type Reply } from '../../test/support/fake-fetch.ts';
import { MAX_EMBED_BATCH } from './embed.ts';
import { createOllamaAdapter } from './ollama-adapter.ts';

const snapshot: EmbedSnapshot = Object.freeze({
  kind: 'embed',
  role: 'embed',
  model: 'qwen3-embedding:0.6b',
  numCtx: 8192,
  dimensions: 3,
  queryPrefix: 'Query: ',
  documentPrefix: '',
});

const setup = (replies: Reply[]) => {
  const fake = fakeFetch(replies);
  const adapter = createOllamaAdapter({
    baseUrl: 'http://localhost:11434/',
    fetch: fake.fetch,
    sleep: noSleep,
  });
  return { adapter, fake };
};

const signal = () => new AbortController().signal;

const vectors = (count: number, dims = 3) =>
  Array.from({ length: count }, () => Array.from({ length: dims }, () => 0.25));

await test('queries get the query prefix, explicit num_ctx and no silent truncation', async () => {
  const { adapter, fake } = setup([
    {
      kind: 'json',
      body: { embeddings: vectors(2), prompt_eval_count: 9, total_duration: 2e7, load_duration: 0 },
    },
  ]);

  const result = await adapter.embed(snapshot, ['a', 'b'], 'query', signal());

  assert.deepEqual(fake.calls[0], {
    url: 'http://localhost:11434/api/embed',
    method: 'POST',
    body: {
      model: 'qwen3-embedding:0.6b',
      input: ['Query: a', 'Query: b'],
      truncate: false,
      options: { num_ctx: 8192 },
    },
  });
  assert.ok(result.ok);
  assert.equal(result.value.vectors.length, 2);
  assert.equal(result.value.tokensIn, 9);
  assert.equal(result.value.totalMs, 20);
});

await test('documents get the document prefix, never the query prefix', async () => {
  const { adapter, fake } = setup([{ kind: 'json', body: { embeddings: vectors(1) } }]);

  await adapter.embed(snapshot, ['note'], 'document', signal());

  assert.deepEqual((fake.calls[0]?.body as { input: string[] }).input, ['note']);
});

await test('count, dimension and non-finite mismatches are INVALID_RESPONSE', async () => {
  const bodies = [
    { embeddings: vectors(1) },
    { embeddings: vectors(2, 4) },
    {
      embeddings: [
        [0, 1, 2],
        [0, 1],
      ],
    },
    { embeddings: 'nope' },
  ];
  for (const body of bodies) {
    const { adapter } = setup([{ kind: 'json', body }]);

    const result = await adapter.embed(snapshot, ['a', 'b'], 'document', signal());

    assert.equal(result.ok ? null : result.error.code, 'INVALID_RESPONSE');
  }
});

await test('transient failures are retried once; client errors are not', async () => {
  const retried = setup([{ kind: 'network' }, { kind: 'json', body: { embeddings: vectors(1) } }]);
  const ok = await retried.adapter.embed(snapshot, ['a'], 'query', signal());
  assert.ok(ok.ok);
  assert.equal(retried.fake.calls.length, 2);

  const rejected = setup([{ kind: 'json', status: 400, body: { error: 'input too long' } }]);
  const bad = await rejected.adapter.embed(snapshot, ['a'], 'query', signal());
  assert.equal(bad.ok ? null : bad.error.code, 'INVALID_RESPONSE');
  assert.equal(rejected.fake.calls.length, 1);
});

await test('empty input makes no request; an oversized batch is a programmer error', async () => {
  const { adapter, fake } = setup([]);

  const empty = await adapter.embed(snapshot, [], 'document', signal());

  assert.deepEqual(empty, { ok: true, value: { vectors: [], tokensIn: 0, totalMs: 0, loadMs: 0 } });
  assert.equal(fake.calls.length, 0);
  await assert.rejects(
    adapter.embed(
      snapshot,
      Array.from({ length: MAX_EMBED_BATCH + 1 }, () => 'x'),
      'document',
      signal(),
    ),
    RangeError,
  );
});

await test('an aborted request reports the gate reason', async () => {
  const { adapter } = setup([{ kind: 'hang' }]);
  const controller = new AbortController();

  const pending = adapter.embed(snapshot, ['a'], 'query', controller.signal);
  controller.abort('DEADLINE_EXPIRED');
  const result = await pending;

  assert.equal(result.ok ? null : result.error.code, 'DEADLINE_EXPIRED');
});
