import assert from 'node:assert/strict';
import test from 'node:test';

import { loadApiConfig } from './config.ts';

const SECRET = 'a'.repeat(32);

await test('defaults bind loopback 4000 and point at the local inference process', () => {
  const result = loadApiConfig({ AETHERION_INFERENCE_SECRET: SECRET });

  assert.ok(result.ok);
  assert.equal(result.value.host, '127.0.0.1');
  assert.equal(result.value.port, 4000);
  assert.equal(result.value.inferenceUrl, 'http://127.0.0.1:4100');
  assert.equal(result.value.databaseUrl, undefined);
});

await test('a private Supabase URL is accepted; public or non-Postgres URLs are not', () => {
  const local = loadApiConfig({
    AETHERION_INFERENCE_SECRET: SECRET,
    AETHERION_DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
  });
  assert.ok(local.ok);

  for (const url of [
    'postgresql://postgres:pw@db.example.com:5432/postgres',
    'http://127.0.0.1:54322',
    'not a url',
  ]) {
    const result = loadApiConfig({
      AETHERION_INFERENCE_SECRET: SECRET,
      AETHERION_DATABASE_URL: url,
    });

    assert.equal(result.ok, false);
    assert.doesNotMatch(result.ok ? '' : result.error.message, /pw|example/);
  }
});

await test('wildcard hosts, public inference URLs and a missing secret are rejected', () => {
  for (const env of [
    { AETHERION_INFERENCE_SECRET: SECRET, AETHERION_API_HOST: ['0', '0', '0', '0'].join('.') },
    { AETHERION_INFERENCE_SECRET: SECRET, AETHERION_INFERENCE_URL: 'http://8.8.8.8:4100' },
    {},
  ]) {
    assert.equal(loadApiConfig(env).ok, false);
  }
});

await test('the brain service key is optional, bounded and must differ from the inference secret', () => {
  const absent = loadApiConfig({
    AETHERION_INFERENCE_SECRET: SECRET,
    AETHERION_BRAIN_SERVICE_KEY: '',
  });
  assert.ok(absent.ok);
  assert.equal(absent.value.brainServiceKey, undefined);

  const key = 'b'.repeat(40);
  const set = loadApiConfig({
    AETHERION_INFERENCE_SECRET: SECRET,
    AETHERION_BRAIN_SERVICE_KEY: key,
  });
  assert.ok(set.ok);
  assert.equal(set.value.brainServiceKey, key);

  for (const bad of ['short', SECRET]) {
    const result = loadApiConfig({
      AETHERION_INFERENCE_SECRET: SECRET,
      AETHERION_BRAIN_SERVICE_KEY: bad,
    });
    assert.equal(result.ok, false);
    assert.match(result.ok ? '' : result.error.message, /AETHERION_BRAIN_SERVICE_KEY/);
    assert.doesNotMatch(result.ok ? '' : result.error.message, /short|aaaa/);
  }
});
