import assert from 'node:assert/strict';
import test from 'node:test';

import { ok } from '@aetherion/shared';

import { listInstalled } from './artifacts.ts';
import type { OllamaHttp } from './ollama-http.ts';

const http = (body: unknown): OllamaHttp => ({
  getJson: () => Promise.resolve(ok(body)),
  postJson: () => Promise.reject(new Error('unused')),
  postStream: () => Promise.reject(new Error('unused')),
});

await test('installed artifacts are keyed by canonical model name with their digests', async () => {
  const result = await listInstalled(
    http({
      models: [
        { model: 'nomic-embed-text', digest: 'a'.repeat(64), size: 1 },
        { model: 'qwen3-embedding:0.6b', digest: 'b'.repeat(64) },
      ],
    }),
    AbortSignal.timeout(1_000),
  );
  assert.ok(result.ok);
  assert.deepEqual(
    [...result.value],
    [
      ['nomic-embed-text:latest', 'a'.repeat(64)],
      ['qwen3-embedding:0.6b', 'b'.repeat(64)],
    ],
  );
});

await test('an unexpected /api/tags body is INVALID_RESPONSE', async () => {
  for (const body of [{}, { models: [{ model: 'm', digest: 'short' }] }]) {
    const result = await listInstalled(http(body), AbortSignal.timeout(1_000));
    assert.equal(result.ok ? null : result.error.code, 'INVALID_RESPONSE');
  }
});
