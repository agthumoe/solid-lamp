import assert from 'node:assert/strict';
import test from 'node:test';

import { duplicateJsonKeys } from './duplicate-keys.ts';

await test('finds duplicate keys that JSON.parse would silently collapse', () => {
  assert.deepEqual(duplicateJsonKeys('{"scripts":{"lint":"a","lint":"b"}}'), ['lint']);
  assert.deepEqual(duplicateJsonKeys('{"a":1,"b":{"a":2},"a":3}'), ['a']);
});

await test('structure characters inside strings are not structure', () => {
  const text = JSON.stringify({ scripts: { 'bench:models': 'echo {a,b} [x] "q" \\ }' } }).replace(
    '}}',
    '},"x":1}',
  );
  assert.deepEqual(duplicateJsonKeys(text), []);
  // The review's case: a brace in an earlier command must not end the scan before the duplicate.
  const reviewed =
    '{"scripts":{"bench:models":"echo {a,b}","lint":"eslint .","lint":"echo bypassed"}}';
  assert.deepEqual(duplicateJsonKeys(reviewed), ['lint']);
  assert.deepEqual(duplicateJsonKeys('{"a":"say \\"}\\" ok","a":2}'), ['a']);
});

await test('same key in sibling objects or array elements is not a duplicate', () => {
  assert.deepEqual(duplicateJsonKeys('{"x":{"k":1},"y":{"k":2},"z":[{"k":1},{"k":2}]}'), []);
  assert.deepEqual(duplicateJsonKeys('["k","k",{"k":1}]'), []);
});
