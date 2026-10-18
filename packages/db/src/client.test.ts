import assert from 'node:assert/strict';
import test from 'node:test';

import { createDatabaseClient } from './client.ts';

await test('the client refuses non-Postgres or non-private database URLs', () => {
  for (const url of [
    'postgresql://u:p@db.example.com:5432/postgres',
    'http://127.0.0.1:54322/postgres',
    'not a url',
  ])
    assert.throws(() => createDatabaseClient({ url }), RangeError);
});

await test('a private URL builds a client lazily without connecting', async () => {
  const client = createDatabaseClient({ url: 'postgresql://u:p@127.0.0.1:1/postgres' });

  assert.equal(typeof client.db.select, 'function');
  await client.close();
});
