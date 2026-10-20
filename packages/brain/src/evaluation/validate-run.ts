import { evaluationRunSchema, type EvaluationRun } from './contract.ts';

export type RunValidation =
  | { readonly ok: true; readonly value: EvaluationRun }
  | { readonly ok: false; readonly error: { readonly code: 'INVALID_EVALUATION_RUN' } };

// Full identity, not a concatenation that can collide when names contain delimiters.
export const citationKey = (
  citation: EvaluationRun['questions'][number]['expected'][number],
): string => JSON.stringify([citation.sourceId, citation.path, citation.headingPath]);

export const validateEvaluationRun = (input: unknown): RunValidation => {
  const invalid = { ok: false, error: { code: 'INVALID_EVALUATION_RUN' } } as const;
  const parsed = evaluationRunSchema.safeParse(input);
  if (!parsed.success) return invalid;
  const run = parsed.data;
  const ids = new Set(run.questions.map((question) => question.id));
  if (ids.size !== run.questions.length) return invalid;
  const observed = new Set<string>();
  for (const observation of run.observations) {
    if (!ids.has(observation.questionId) || observed.has(observation.questionId)) return invalid;
    observed.add(observation.questionId);
    const hits = new Map<string, string>();
    for (const hit of observation.hits) {
      const signature = JSON.stringify([citationKey(hit.citation), hit.citationVerified]);
      if (hits.has(hit.chunkId) && hits.get(hit.chunkId) !== signature) return invalid;
      hits.set(hit.chunkId, signature);
    }
  }
  const heldOut = run.questions.filter((question) => question.split === 'held_out');
  if (!heldOut.length || heldOut.some((question) => !observed.has(question.id))) return invalid;
  return { ok: true, value: run };
};
