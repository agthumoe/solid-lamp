import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { loadModelsConfig, parseModelsConfig } from './models-config.ts';

const committed = fileURLToPath(new URL('../../../../config/models.yaml', import.meta.url));

const minimal = (overrides: { baseUrl?: string; extra?: string; embed?: string } = {}) => `
ollama:
  base_url: ${overrides.baseUrl ?? 'http://localhost:11434'}
roles:
  chat: { model: 'qwen3.5:9b', num_ctx: 16384, residency: resident }
  router: { model: 'qwen3.5:9b', num_ctx: 16384, residency: shared }
  coder: { model: 'qwen3.5:9b', num_ctx: 16384, residency: shared }
  embed: ${overrides.embed ?? "{ model: 'qwen3-embedding:0.6b', num_ctx: 8192, residency: resident, dimensions: 1024 }"}
${overrides.extra ?? ''}`;

await test('committed config/models.yaml parses', async () => {
  const result = await loadModelsConfig(committed);
  assert.ok(result.ok, result.ok ? '' : result.error.message);
  assert.equal(result.value.roles.embed.dimensions, 1024);
  assert.equal(result.value.roles.deep, undefined);
  assert.deepEqual(result.value.fallbacks.embed, ['nomic-embed-text']);
});

await test('minimal config applies defaults', () => {
  const result = parseModelsConfig(minimal());
  assert.ok(result.ok);
  assert.equal(result.value.roles.chat.think, false);
  assert.equal(result.value.roles.embed.query_prefix, '');
  assert.deepEqual(result.value.fallbacks, {});
});

await test('rejects unknown keys and missing embed dimensions', () => {
  const unknown = parseModelsConfig(minimal({ extra: 'surprise: true' }));
  assert.equal(unknown.ok, false);
  const noDims = parseModelsConfig(
    minimal({ embed: "{ model: 'qwen3-embedding:0.6b', num_ctx: 8192, residency: resident }" }),
  );
  assert.ok(!noDims.ok);
  assert.match(noDims.error.message, /roles\.embed\.dimensions/);
});

await test('rejects non-private Ollama URLs', () => {
  for (const baseUrl of [
    'http://0.0.0.0:11434',
    'http://192.168.1.5:11434',
    'https://api.example.com',
  ]) {
    const result = parseModelsConfig(minimal({ baseUrl }));
    assert.equal(result.ok, false, baseUrl);
  }
  for (const baseUrl of [
    'http://127.0.0.1:11434',
    'http://100.101.1.2:11434',
    'http://aetherion.tail1.ts.net:11434',
  ])
    assert.equal(parseModelsConfig(minimal({ baseUrl })).ok, true, baseUrl);
});

await test('rejects fallbacks for unbound roles and embed fallbacks without options', () => {
  const unbound = parseModelsConfig(minimal({ extra: 'fallbacks:\n  deep: [qwen3:8b]' }));
  assert.ok(!unbound.ok);
  assert.match(unbound.error.message, /fallbacks\.deep/);
  const embed = parseModelsConfig(minimal({ extra: 'fallbacks:\n  embed: [nomic-embed-text]' }));
  assert.ok(!embed.ok);
  assert.match(embed.error.message, /fallback_embedding_options/);
});

await test('invalid YAML and missing file are values, not throws', async () => {
  const yaml = parseModelsConfig('roles: [unclosed');
  assert.ok(!yaml.ok);
  assert.equal(yaml.error.code, 'VALIDATION_FAILED');
  const missing = await loadModelsConfig('/nonexistent/models.yaml');
  assert.ok(!missing.ok);
  assert.equal(missing.error.code, 'NOT_FOUND');
});
