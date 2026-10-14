import { inputSchema, suiteSchema, reasonsByKind, type Input, type Suite } from './schema.ts';

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
// Always clone; each case is independent. Null and arrays replace whole values.
export function expandPatch(base: unknown, patch: unknown): unknown {
  if (!object(base) || !object(patch)) return structuredClone(patch);
  const result: Record<string, unknown> = structuredClone(base);
  for (const [key, value] of Object.entries(patch)) {
    if (['__proto__', 'constructor', 'prototype'].includes(key)) {
      throw new Error('forbidden patch key');
    }
    result[key] =
      object(value) && object(result[key])
        ? expandPatch(result[key], value)
        : structuredClone(value);
  }
  return result;
}
function references(input: Input): void {
  if (
    new Set(input.allowedAgents).size !== input.allowedAgents.length ||
    new Set(input.enabledAgents).size !== input.enabledAgents.length
  ) {
    throw new Error('duplicate trusted agent');
  }
  for (const enabled of input.enabledAgents) {
    if (!input.allowedAgents.includes(enabled)) throw new Error('enabled agent not allowed');
  }
  for (const binding of Object.values(input.bindings)) {
    if (!binding) continue;
    if (
      !input.models[binding.primary] ||
      (binding.fallback !== null && !input.models[binding.fallback])
    ) {
      throw new Error('binding model reference missing');
    }
  }
}
function expectedResult(input: Input, expected: Suite['cases'][number]['expected']): void {
  if (!reasonsByKind[expected.kind].includes(expected.reason)) {
    throw new Error('reason is incompatible with expected kind');
  }
  if (expected.degradedRetrieval === true) {
    const retrievalFailed =
      !input.retrieval.embedAvailable ||
      input.retrieval.activeSpace !== input.retrieval.querySpace ||
      input.retrieval.activeDimensions !== input.retrieval.queryDimensions;
    if (
      input.retrieval.required ||
      !retrievalFailed ||
      !['route', 'fallback'].includes(expected.kind)
    ) {
      throw new Error('invalid degraded retrieval expectation');
    }
  }
  if (['reject', 'clarify'].includes(expected.kind)) {
    if (expected.agent !== null || expected.modelId !== null || expected.steps !== undefined) {
      throw new Error('no-dispatch result has execution identity');
    }
  } else if (expected.steps === undefined) {
    if (expected.agent === null || expected.modelId === null || !input.models[expected.modelId]) {
      throw new Error('execution result requires known identity');
    }
  }
  if (expected.kind === 'route' && expected.steps === undefined) {
    const binding = expected.agent === null ? undefined : input.bindings[expected.agent];
    if (
      !binding?.enabled ||
      binding.primary !== expected.modelId ||
      expected.agent === null ||
      !input.enabledAgents.includes(expected.agent)
    ) {
      throw new Error('route identity does not match enabled binding');
    }
  }
  if (expected.kind === 'fallback') {
    const binding = expected.agent === null ? undefined : input.bindings[expected.agent];
    if (
      input.request.outputStarted ||
      input.request.cancelled ||
      input.request.remainingMs === 0 ||
      input.request.attempts >= expected.attemptLimit ||
      !binding?.fallbackEnabled ||
      expected.modelId !== binding.fallback
    )
      throw new Error('inconsistent fallback expectation');
    const fallback = expected.modelId === null ? undefined : input.models[expected.modelId];
    if (
      !fallback ||
      fallback.state !== 'enabled' ||
      fallback.license !== 'verified' ||
      fallback.evidenceRevoked ||
      !fallback.artifactResolved ||
      !fallback.profileAccepted ||
      !fallback.domainAccepted ||
      fallback.capability !== 'text' ||
      binding.primary === binding.fallback
    ) {
      throw new Error('fallback expectation lacks accepted distinct model');
    }
  }
  if (expected.kind === 'partial-failure') {
    if (!input.request.outputStarted) throw new Error('partial failure requires started output');
    const binding = expected.agent === null ? undefined : input.bindings[expected.agent];
    const attemptedModel = input.request.attempts === 2 ? binding?.fallback : binding?.primary;
    if (
      !binding ||
      input.request.attempts < 1 ||
      input.request.attempts > 2 ||
      expected.modelId !== attemptedModel
    ) {
      throw new Error('partial failure identity does not match active attempt');
    }
  }
  if (expected.steps !== undefined) {
    if (
      input.request.plan === null ||
      JSON.stringify(expected.steps) !== JSON.stringify([...input.request.plan, 'knowledge']) ||
      expected.kind !== 'route' ||
      expected.steps.length < 2 ||
      expected.steps.length > 4 ||
      new Set(expected.steps).size !== expected.steps.length ||
      expected.steps.at(-1) !== 'knowledge' ||
      expected.steps.some((step) => !input.enabledAgents.includes(step))
    ) {
      throw new Error('inconsistent sequential plan expectation');
    }
  }
}
export function validateSuite(value: unknown): Suite {
  const suite = suiteSchema.parse(value);
  references(suite.defaults);
  const ids = new Set<string>();
  for (const entry of suite.cases) {
    if (ids.has(entry.id)) throw new Error('duplicate fixture ID');
    ids.add(entry.id);
    const input = inputSchema.parse(expandPatch(suite.defaults, entry.inputPatch));
    // Patch records must refer to default identities, never create hidden candidates.
    for (const key of Object.keys(entry.inputPatch.models ?? {})) {
      if (!Object.hasOwn(suite.defaults.models, key))
        throw new Error('patch model reference missing');
    }
    for (const key of Object.keys(entry.inputPatch.bindings ?? {})) {
      if (!Object.hasOwn(suite.defaults.bindings, key))
        throw new Error('patch binding reference missing');
    }
    references(input);
    try {
      expectedResult(input, entry.expected);
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'invalid expected result';
      throw new Error(`fixture ${entry.id}: ${reason}`, { cause: error });
    }
  }
  return suite;
}
