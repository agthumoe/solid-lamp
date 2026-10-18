import assert from 'node:assert/strict';
import test from 'node:test';

import { z } from 'zod';

import { repairToolCalls } from './repair-tool-calls.ts';
import { validateToolCall } from './tool-call.ts';

const allowlist = new Map<string, z.ZodType>([
  [
    'brain.search',
    z.strictObject({ query: z.string().min(1), limit: z.int().min(1).max(10).default(5) }),
  ],
  ['time.now', z.strictObject({})],
]);

const code = (result: ReturnType<typeof repairToolCalls>) => (result.ok ? 'OK' : result.error.code);

await test('repairs a whole-response JSON call and applies schema defaults', () => {
  const result = repairToolCalls(
    '  {"name":"brain.search","arguments":{"query":"taxes"}}  ',
    allowlist,
  );
  assert.deepEqual(result, {
    ok: true,
    value: [{ name: 'brain.search', arguments: { query: 'taxes', limit: 5 }, repaired: true }],
  });
});

await test('repairs wrapped and fenced calls, including stringified arguments', () => {
  const wrapped = repairToolCalls(
    '<tool_call>{"name":"time.now","arguments":{}}</tool_call>\n<tool_call>{"name":"brain.search","parameters":"{\\"query\\":\\"x\\",\\"limit\\":2}"}</tool_call>',
    allowlist,
  );
  assert.ok(wrapped.ok);
  assert.deepEqual(
    wrapped.value.map((call) => call.name),
    ['time.now', 'brain.search'],
  );
  const fenced = repairToolCalls('```json\n{"name":"time.now","arguments":{}}\n```', allowlist);
  assert.equal(code(fenced), 'OK');
});

await test('JSON quoted in prose is not a call', () => {
  for (const text of [
    'I would call {"name":"brain.search","arguments":{"query":"x"}} next.',
    'Sure:\n```json\n{"name":"time.now","arguments":{}}\n```\nThat should work.',
    '<tool_call>{"name":"time.now","arguments":{}}</tool_call> and then I will summarize.',
    'No tools needed.',
    '',
  ])
    assert.equal(code(repairToolCalls(text, allowlist)), 'NO_EXPLICIT_CALL', text);
});

await test('scalar, array and malformed arguments are rejected', () => {
  for (const text of [
    '{"name":"brain.search","arguments":5}',
    '{"name":"brain.search","arguments":["x"]}',
    '{"name":"brain.search","arguments":"not json"}',
    '{"name":"brain.search","arguments":"\\"quoted scalar\\""}',
    '{"name":"brain.search","arguments":{},"parameters":{}}',
    '{"name":"","arguments":{}}',
    '{"name":"brain.search","arguments":{},"extra":1}',
    '{"name":"brain.search","arguments":{"query":"x"}',
  ])
    assert.equal(code(repairToolCalls(text, allowlist)), 'MALFORMED_CALL', text);
});

await test('arguments must pass the tool schema', () => {
  for (const text of [
    '{"name":"brain.search","arguments":{}}',
    '{"name":"brain.search","arguments":{"query":"x","limit":50}}',
    '{"name":"brain.search","arguments":{"query":"x","admin":true}}',
    '{"name":"brain.search","arguments":{"query":"x","__proto__":{"admin":true}}}',
  ])
    assert.equal(code(repairToolCalls(text, allowlist)), 'INVALID_ARGUMENTS', text);
});

await test('tools outside the allowlist are rejected, and one bad call rejects all', () => {
  assert.equal(
    code(repairToolCalls('{"name":"email.send","arguments":{"to":"x"}}', allowlist)),
    'TOOL_NOT_ALLOWED',
  );
  const mixed = repairToolCalls(
    '<tool_call>{"name":"time.now","arguments":{}}</tool_call><tool_call>{"name":"shell.exec","arguments":{}}</tool_call>',
    allowlist,
  );
  assert.ok(!mixed.ok);
  assert.equal(mixed.error.code, 'TOOL_NOT_ALLOWED');
  assert.equal(mixed.error.tool, 'shell.exec');
});

await test('oversized responses and too many calls are rejected', () => {
  assert.equal(
    code(
      repairToolCalls(`{"name":"time.now","arguments":{"pad":"${'x'.repeat(40_000)}"}}`, allowlist),
    ),
    'MALFORMED_CALL',
  );
  const nine = '<tool_call>{"name":"time.now","arguments":{}}</tool_call>'.repeat(9);
  assert.equal(code(repairToolCalls(nine, allowlist)), 'MALFORMED_CALL');
});

await test('native calls use the same validation path', () => {
  assert.deepEqual(validateToolCall({ name: 'time.now', arguments: {} }, allowlist, false), {
    ok: true,
    value: { name: 'time.now', arguments: {}, repaired: false },
  });
  const denied = validateToolCall({ name: 'email.send', arguments: {} }, allowlist, false);
  assert.equal(denied.ok ? null : denied.error.code, 'TOOL_NOT_ALLOWED');
});
