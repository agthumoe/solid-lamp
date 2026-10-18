import assert from 'node:assert/strict';
import test from 'node:test';

import { fakeFetch } from '../../test/support/fake-fetch.ts';
import { createOllamaAdapter } from './ollama-adapter.ts';
import {
  classifyLoad,
  compareResidency,
  createResidencyMetrics,
  type LoadedModel,
} from './residency.ts';

const loaded = (model: string, contextLength?: number): LoadedModel => ({
  model,
  contextLength,
  sizeBytes: 1,
  vramBytes: 1,
});

const chat = { model: 'qwen3.5:9b', numCtx: 16384 };

await test('loaded models are parsed from /api/ps with canonical tags', async () => {
  const fake = fakeFetch([
    {
      kind: 'json',
      body: {
        models: [
          {
            name: 'qwen3.5:9b',
            model: 'qwen3.5:9b',
            size: 10,
            size_vram: 8,
            context_length: 16384,
          },
          { name: 'nomic-embed-text', model: 'nomic-embed-text', size: 2, size_vram: 2 },
        ],
      },
    },
  ]);
  const adapter = createOllamaAdapter({ baseUrl: 'http://127.0.0.1:11434', fetch: fake.fetch });

  const result = await adapter.loaded(new AbortController().signal);

  assert.equal(fake.calls[0]?.url, 'http://127.0.0.1:11434/api/ps');
  assert.deepEqual(result, {
    ok: true,
    value: [
      { model: 'qwen3.5:9b', contextLength: 16384, sizeBytes: 10, vramBytes: 8 },
      { model: 'nomic-embed-text:latest', contextLength: undefined, sizeBytes: 2, vramBytes: 2 },
    ],
  });
});

await test('an unexpected /api/ps body is INVALID_RESPONSE', async () => {
  const fake = fakeFetch([{ kind: 'json', body: { models: [{ size: 1 }] } }]);
  const adapter = createOllamaAdapter({ baseUrl: 'http://127.0.0.1:11434', fetch: fake.fetch });

  const result = await adapter.loaded(new AbortController().signal);

  assert.equal(result.ok ? null : result.error.code, 'INVALID_RESPONSE');
});

await test('load kind distinguishes warm, cold and shared-model context reloads', () => {
  assert.equal(classifyLoad([loaded('qwen3.5:9b', 16384)], chat), 'warm');
  assert.equal(classifyLoad([], chat), 'cold');
  assert.equal(classifyLoad([loaded('qwen3.5:9b', 8192)], chat), 'context_reload');
  // An unknown loaded context is never assumed compatible.
  assert.equal(classifyLoad([loaded('qwen3.5:9b')], chat), 'context_reload');
  assert.equal(
    classifyLoad([loaded('nomic-embed-text:latest', 2048)], {
      model: 'nomic-embed-text',
      numCtx: 2048,
    }),
    'warm',
  );
});

await test('comparison reports observed evictions and residency after the request', () => {
  const before = [loaded('qwen3.5:9b', 16384), loaded('qwen3-embedding:0.6b', 8192)];
  const after = [loaded('qwen2.5-coder:14b', 16384), loaded('qwen3-embedding:0.6b', 8192)];

  const change = compareResidency(before, after, { model: 'qwen2.5-coder:14b', numCtx: 16384 });

  assert.deepEqual(change, {
    model: 'qwen2.5-coder:14b',
    expected: 'cold',
    evicted: ['qwen3.5:9b'],
    residentAfter: true,
  });
  assert.equal(compareResidency(before, [], chat).residentAfter, false);
});

await test('metrics count cold loads, context reloads, evictions and missed residency', () => {
  const metrics = createResidencyMetrics();
  metrics.record({ model: 'a:1', expected: 'cold', evicted: ['b:1'], residentAfter: true });
  metrics.record({ model: 'a:1', expected: 'context_reload', evicted: [], residentAfter: false });
  metrics.record({ model: 'a:1', expected: 'warm', evicted: [], residentAfter: true });

  assert.deepEqual(metrics.snapshot(), {
    coldLoads: 1,
    contextReloads: 1,
    evictions: 1,
    notResidentAfter: 1,
  });
});
