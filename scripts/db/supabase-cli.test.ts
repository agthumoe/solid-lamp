import assert from 'node:assert/strict';
import test from 'node:test';

import { supabaseInvocation } from './supabase-cli.ts';

await test('the password moves to PGPASSWORD and telemetry is disabled', () => {
  const call = supabaseInvocation('migrate', {
    AETHERION_DATABASE_URL: 'postgresql://postgres:s%40cret@127.0.0.1:54322/postgres',
  });

  assert.deepEqual(call.args, [
    'migration',
    'up',
    '--db-url',
    'postgresql://postgres@127.0.0.1:54322/postgres',
  ]);
  assert.deepEqual(call.env, {
    SUPABASE_TELEMETRY_DISABLED: '1',
    DO_NOT_TRACK: '1',
    PGPASSWORD: 's@cret',
  });
  assert.doesNotMatch(call.args.join(' '), /cret/);
});

await test('status lists migrations; a URL without a password sets no PGPASSWORD', () => {
  const call = supabaseInvocation('status', {
    AETHERION_DATABASE_URL: 'postgres://postgres@localhost:54322/postgres',
  });

  assert.deepEqual(call.args.slice(0, 2), ['migration', 'list']);
  assert.equal('PGPASSWORD' in call.env, false);
});

await test('missing, malformed or non-private URLs are refused', () => {
  for (const url of [
    undefined,
    'nope',
    'mysql://root@127.0.0.1/db',
    'postgresql://postgres:pw@db.example.com:5432/postgres',
  ])
    assert.throws(() => supabaseInvocation('migrate', { AETHERION_DATABASE_URL: url }));
});
