import assert from 'node:assert/strict';
import test from 'node:test';

import { loadBrainClientConfig } from './brain-client-config.ts';

const KEY = 'k'.repeat(40);

await test('the brain client defaults to the local api and requires a service key', () => {
  const config = loadBrainClientConfig({ AETHERION_BRAIN_SERVICE_KEY: KEY });
  assert.ok(config.ok);
  assert.equal(config.value.apiUrl, 'http://127.0.0.1:4000');
  assert.equal(config.value.serviceKey, KEY);

  const missing = loadBrainClientConfig({});
  assert.equal(missing.ok, false);
  assert.match(missing.ok ? '' : missing.error.message, /AETHERION_BRAIN_SERVICE_KEY/);
});

await test('only an http loopback api URL without credentials is accepted', () => {
  for (const url of [
    'http://127.0.0.1:4000',
    'http://localhost:4000',
    'http://[::1]:4000',
    'http://127.9.9.9:1',
  ])
    assert.ok(
      loadBrainClientConfig({ AETHERION_BRAIN_SERVICE_KEY: KEY, AETHERION_API_URL: url }).ok,
      url,
    );
  for (const url of [
    'http://100.101.102.103:4000',
    'http://aetherion.tail1234.ts.net:4000',
    'http://0.0.0.0:4000',
    'https://127.0.0.1:4000',
    'http://user:secretpw@127.0.0.1:4000',
    'not a url',
  ]) {
    const result = loadBrainClientConfig({
      AETHERION_BRAIN_SERVICE_KEY: KEY,
      AETHERION_API_URL: url,
    });
    assert.equal(result.ok, false, url);
    assert.doesNotMatch(result.ok ? '' : result.error.message, /secretpw|kkkk/);
  }
});
