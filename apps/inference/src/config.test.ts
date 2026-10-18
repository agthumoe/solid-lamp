import assert from 'node:assert/strict';
import test from 'node:test';

import { loadInferenceConfig } from './config.ts';

const SECRET = 'z'.repeat(32);

await test('defaults bind loopback port 4100 and keep shared settings', () => {
  const result = loadInferenceConfig({ AETHERION_INFERENCE_SECRET: SECRET });

  assert.ok(result.ok);
  assert.equal(result.value.host, '127.0.0.1');
  assert.equal(result.value.port, 4100);
  assert.equal(result.value.configDir, 'config');
  assert.equal(result.value.secret, SECRET);
});

await test('a missing or short secret fails and the error names keys, not values', () => {
  const short = loadInferenceConfig({ AETHERION_INFERENCE_SECRET: 'tooshort-secret-value' });
  const missing = loadInferenceConfig({});

  assert.equal(
    short.ok ? null : short.error.message,
    'invalid environment: AETHERION_INFERENCE_SECRET',
  );
  assert.doesNotMatch(short.ok ? '' : short.error.message, /tooshort/);
  assert.equal(missing.ok, false);
});

await test('wildcard or public hosts and privileged ports are rejected', () => {
  for (const env of [
    { AETHERION_INFERENCE_HOST: ['0', '0', '0', '0'].join('.') },
    { AETHERION_INFERENCE_HOST: '192.168.1.10' },
    { AETHERION_INFERENCE_PORT: '80' },
    { AETHERION_INFERENCE_PORT: 'http' },
  ]) {
    const result = loadInferenceConfig({ AETHERION_INFERENCE_SECRET: SECRET, ...env });

    assert.equal(result.ok, false);
  }
});

await test('a Tailscale host and explicit port are accepted; empty values mean defaults', () => {
  const tailscale = loadInferenceConfig({
    AETHERION_INFERENCE_SECRET: SECRET,
    AETHERION_INFERENCE_HOST: '100.101.102.103',
    AETHERION_INFERENCE_PORT: '4101',
  });
  const empty = loadInferenceConfig({
    AETHERION_INFERENCE_SECRET: SECRET,
    AETHERION_INFERENCE_HOST: '',
    AETHERION_INFERENCE_PORT: '',
  });

  assert.ok(tailscale.ok && empty.ok);
  assert.equal(tailscale.value.port, 4101);
  assert.equal(empty.value.host, '127.0.0.1');
});
