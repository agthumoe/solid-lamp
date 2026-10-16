import assert from 'node:assert/strict';
import test from 'node:test';

import { err, ok } from './result.ts';

await test('Result creates a discriminated success value', () => {
  assert.deepEqual(ok(42), { ok: true, value: 42 });
});

await test('Result creates a discriminated failure value', () => {
  assert.deepEqual(err('NOPE'), { ok: false, error: 'NOPE' });
});
