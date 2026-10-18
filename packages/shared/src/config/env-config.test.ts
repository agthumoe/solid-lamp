import assert from 'node:assert/strict';
import test from 'node:test';

import { loadEnvConfig } from './env-config.ts';

await test('env config defaults when unset or empty', () => {
  assert.deepEqual(loadEnvConfig({ AETHERION_LOG_LEVEL: '' }), {
    ok: true,
    value: { configDir: 'config', logLevel: 'info' },
  });
});

await test('env config reads AETHERION_ keys', () => {
  const result = loadEnvConfig({
    AETHERION_CONFIG_DIR: '/srv/config',
    AETHERION_LOG_LEVEL: 'debug',
    AETHERION_OLLAMA_URL: 'http://127.0.0.1:11434',
    UNRELATED: 'ignored',
  });
  assert.deepEqual(result, {
    ok: true,
    value: { configDir: '/srv/config', logLevel: 'debug', ollamaUrl: 'http://127.0.0.1:11434' },
  });
});

await test('env config rejects invalid values without echoing them', () => {
  const result = loadEnvConfig({
    AETHERION_LOG_LEVEL: 'verbose',
    AETHERION_OLLAMA_URL: 'http://secret-host.example.com:11434',
  });
  assert.ok(!result.ok);
  assert.match(result.error.message, /AETHERION_LOG_LEVEL/);
  assert.match(result.error.message, /AETHERION_OLLAMA_URL/);
  assert.doesNotMatch(result.error.message, /secret-host|verbose/);
});
