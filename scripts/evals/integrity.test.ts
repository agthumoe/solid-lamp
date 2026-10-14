import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { expandPatch, validateSuite } from './integrity.ts';

const original: unknown = JSON.parse(
  readFileSync(new URL('../../evals/routing/cases.json', import.meta.url), 'utf8'),
);
function suite() {
  return structuredClone(validateSuite(original));
}
function first() {
  const value = suite();
  const entry = value.cases[0];
  assert.ok(entry);
  return { value, entry };
}
await test('full synthetic suite validates without executing routing or inference', () => {
  assert.equal(validateSuite(original).cases.length, 51);
});
await test('versions, count, unknown fields, malformed types and duplicate IDs fail closed', () => {
  const base = suite();
  assert.throws(() => validateSuite({ ...base, schemaVersion: 2 }));
  assert.throws(() => validateSuite({ ...base, boundaryVersion: 2 }));
  assert.throws(() => validateSuite({ ...base, unknown: true }));
  assert.throws(() => validateSuite({ ...base, cases: base.cases.slice(0, 19) }));
  assert.throws(() => validateSuite({ ...base, cases: [...base.cases, base.cases[0]] }));
  const { value, entry } = first();
  entry.inputPatch = { ...entry.inputPatch, request: { remainingMs: -1 } };
  assert.throws(() => validateSuite(value));
  assert.throws(() =>
    validateSuite({
      ...base,
      defaults: { ...base.defaults, request: { ...base.defaults.request, cancelled: 'false' } },
    }),
  );
});
await test('trusted identities and references must resolve; external adversarial strings remain data', () => {
  const { value, entry } = first();
  entry.inputPatch.bindings = { finance: { primary: 'qwen-deep' } };
  assert.throws(() => validateSuite(value), /reference missing/);
  entry.inputPatch = { models: { 'qwen-deep': { state: 'disabled' } } };
  assert.throws(() => validateSuite(value));
  entry.inputPatch = { request: { ownerAgent: 'stock-trader' } };
  entry.expected = {
    kind: 'reject',
    reason: 'INVALID_REQUEST',
    agent: null,
    modelId: null,
    attemptLimit: 2,
    writeAllowed: false,
  };
  assert.doesNotThrow(() => validateSuite(value));
});
await test('unauthorized writes and identities on no-dispatch results are rejected', () => {
  const { value, entry } = first();
  assert.throws(() =>
    validateSuite({
      ...value,
      cases: [
        { ...entry, expected: { ...entry.expected, writeAllowed: true } },
        ...value.cases.slice(1),
      ],
    }),
  );
  entry.expected.kind = 'reject';
  entry.expected.reason = 'INVALID_REQUEST';
  assert.throws(() => validateSuite(value), /no-dispatch/);
});
await test('streamed, cancelled, expired, disabled and exhausted fallback expectations are invalid', () => {
  for (const patch of [
    { request: { outputStarted: true } },
    { request: { cancelled: true } },
    { request: { remainingMs: 0 } },
    { request: { attempts: 2 } },
    { bindings: { finance: { fallbackEnabled: false } } },
  ]) {
    const value = suite();
    const entry = value.cases.find((item) => item.expected.kind === 'fallback');
    assert.ok(entry);
    entry.inputPatch = { ...entry.inputPatch, ...patch };
    assert.throws(() => validateSuite(value), /fallback/);
  }
});
await test('partial results and sequential plans require coherent output and unique enabled steps', () => {
  const value = suite();
  const partial = value.cases.find((item) => item.expected.kind === 'partial-failure');
  assert.ok(partial);
  partial.inputPatch.request = { outputStarted: false };
  assert.throws(() => validateSuite(value), /started output/);
  const planSuite = suite();
  const plan = planSuite.cases.find((item) => item.expected.steps);
  assert.ok(plan);
  plan.expected.steps = ['finance', 'finance', 'knowledge'];
  assert.throws(() => validateSuite(planSuite), /sequential plan/);
});
await test('patches are independent, arrays/null replace and prototype keys cannot be applied', () => {
  const base = {
    request: { proposal: ['finance'], plan: ['finance'] },
    models: { finance: { state: 'enabled' } },
  };
  const changed = expandPatch(base, { request: { proposal: ['accountant'], plan: null } });
  assert.deepEqual(changed, { ...base, request: { proposal: ['accountant'], plan: null } });
  assert.deepEqual(base.request, { proposal: ['finance'], plan: ['finance'] });
  assert.deepEqual(expandPatch(base, {}), base);
  assert.throws(
    () => expandPatch(base, JSON.parse('{"__proto__":{"injected":true}}')),
    /forbidden/,
  );
  assert.throws(() => expandPatch(base, { constructor: {} }), /forbidden/);
});

await test('successful route identity must match the enabled binding', () => {
  const { value, entry } = first();
  entry.expected.modelId = 'qwen-general';
  assert.throws(() => validateSuite(value), /route identity/);
});

await test('unknown reasons and kind/reason mismatches are rejected', () => {
  const { value, entry } = first();
  assert.throws(() =>
    validateSuite({
      ...value,
      cases: [
        { ...entry, expected: { ...entry.expected, reason: 'PRIMARY_REDY' } },
        ...value.cases.slice(1),
      ],
    }),
  );
  entry.expected.reason = 'FALLBACK_EXHAUSTED';
  assert.throws(() => validateSuite(value), /incompatible/);
});
await test('sequential result must preserve the full requested plan plus synthesis', () => {
  const value = suite();
  const entry = value.cases.find((item) => item.expected.steps);
  assert.ok(entry);
  entry.expected.steps = ['finance', 'knowledge'];
  assert.throws(() => validateSuite(value), /sequential/);
});
await test('partial output identity must describe the actual active attempt', () => {
  const value = suite();
  const entry = value.cases.find((item) => item.expected.kind === 'partial-failure');
  assert.ok(entry);
  entry.expected.modelId = 'qwen-general';
  assert.throws(() => validateSuite(value), /active attempt/);
  entry.inputPatch.request = { outputStarted: true, attempts: 2 };
  assert.doesNotThrow(() => validateSuite(value));
});
await test('fallback expectation requires every scoped acceptance gate', () => {
  for (const failure of [
    { state: 'candidate' as const },
    { license: 'unresolved' as const },
    { evidenceRevoked: true },
    { artifactResolved: false },
    { profileAccepted: false },
    { domainAccepted: false },
    { capability: 'embedding' as const },
  ]) {
    const value = suite();
    const entry = value.cases.find((item) => item.expected.kind === 'fallback');
    assert.ok(entry);
    entry.inputPatch.models = { ...entry.inputPatch.models, 'qwen-general': failure };
    assert.throws(() => validateSuite(value), /accepted distinct/);
  }
});
await test('degraded retrieval cannot hide failure of required evidence', () => {
  const value = suite();
  const entry = value.cases.find((item) => item.expected.degradedRetrieval);
  assert.ok(entry);
  entry.inputPatch.retrieval = { ...entry.inputPatch.retrieval, required: true };
  assert.throws(() => validateSuite(value), /degraded/);
});

await test('failed optional retrieval must disclose degradation in successful expectations', () => {
  for (const id of ['R49', 'R50']) {
    const value = suite();
    const entry = value.cases.find((item) => item.id === id);
    assert.ok(entry);
    delete entry.expected.degradedRetrieval;
    assert.throws(() => validateSuite(value), /missing degraded/);
  }
  const value = suite();
  const entry = value.cases.find((item) => item.expected.kind === 'fallback');
  assert.ok(entry);
  entry.inputPatch.retrieval = { required: false, embedAvailable: false };
  assert.throws(() => validateSuite(value), /missing degraded/);
});
await test('successful routes and plans cannot use self or null enabled fallback bindings', () => {
  for (const target of ['qwen-general', null] as const) {
    const value = suite();
    const entry = value.cases.find((item) => item.id === 'R46');
    assert.ok(entry);
    entry.inputPatch.bindings = { knowledge: { fallbackEnabled: true, fallback: target } };
    entry.expected = {
      kind: 'route',
      reason: 'PRIMARY_READY',
      agent: 'knowledge',
      modelId: 'qwen-general',
      attemptLimit: 2,
      writeAllowed: false,
    };
    assert.throws(() => validateSuite(value), /invalid fallback binding/);
    entry.expected = {
      kind: 'reject',
      reason: 'BINDING_INVALID',
      agent: null,
      modelId: null,
      attemptLimit: 2,
      writeAllowed: false,
    };
    assert.doesNotThrow(() => validateSuite(value));
  }
  const value = suite();
  const entry = value.cases.find((item) => item.expected.steps);
  assert.ok(entry);
  entry.inputPatch.bindings = { finance: { fallbackEnabled: true, fallback: 'fin-r1' } };
  assert.throws(() => validateSuite(value), /invalid fallback binding/);
});
