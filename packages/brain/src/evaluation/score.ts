import type { EvaluationRun, Hit, Observation } from './contract.ts';
import { citationKey, validateEvaluationRun } from './validate-run.ts';

const ratio = (count: number, total: number): number | null => (total ? count / total : null);
const percentile = (sorted: readonly number[], fraction: number): number | null =>
  sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] ?? null;
const distinctHits = (hits: readonly Hit[]): Hit[] => {
  const seen = new Set<string>();
  return hits.filter((hit) => {
    if (seen.has(hit.chunkId)) return false;
    seen.add(hit.chunkId);
    return true;
  });
};

const aggregate = (run: EvaluationRun) => {
  const heldOut = run.questions.filter((question) => question.split === 'held_out');
  const observations = new Map(
    run.observations.map((observation) => [observation.questionId, observation]),
  );
  let answerable = 0,
    recallHits = 0,
    reciprocalRanks = 0,
    correctAbstentions = 0;
  let correctUnanswerable = 0,
    unanswerable = 0,
    verifiedCitations = 0,
    returnedCitations = 0;
  let errors = 0,
    degraded = 0;
  const latencies: number[] = [];
  for (const question of heldOut) {
    // Presence was validated before aggregation, so no case can silently disappear.
    const observation = observations.get(question.id) as Observation;
    const hits = distinctHits(observation.hits);
    const normal = observation.status === 'ok' || observation.status === 'no_match';
    const usable = normal || observation.status === 'lexical_only';
    errors += usable ? 0 : 1;
    degraded += ['incomplete', 'lexical_only'].includes(observation.status) ? 1 : 0;
    latencies.push(observation.latencyMs);
    returnedCitations += hits.length;
    verifiedCitations += hits.filter((hit) => hit.citationVerified).length;
    if (question.answerable) {
      answerable++;
      const expected = new Set(question.expected.map(citationKey));
      const rank = usable
        ? hits.findIndex((hit) => hit.citationVerified && expected.has(citationKey(hit.citation))) +
          1
        : 0;
      if (rank > 0 && rank <= 5) recallHits++;
      reciprocalRanks += rank ? 1 / rank : 0;
      if (usable && hits.length > 0) correctAbstentions++;
    } else {
      unanswerable++;
      if (observation.status === 'no_match') {
        correctUnanswerable++;
        correctAbstentions++;
      }
    }
  }
  latencies.sort((a, b) => a - b);
  const recallAt5 = ratio(recallHits, answerable);
  return {
    evidenceKind: run.evidenceKind,
    profileId: run.profileId,
    chunkerVersion: run.chunkerVersion,
    thresholdVersion: run.thresholdVersion,
    counts: {
      heldOutQuestions: heldOut.length,
      answerableQuestions: answerable,
      unanswerableQuestions: unanswerable,
      errors,
      degradedQuestions: degraded,
      returnedCitations,
    },
    metrics: {
      recallAt5,
      meanReciprocalRank: ratio(reciprocalRanks, answerable),
      citationAccuracy: ratio(verifiedCitations, returnedCitations),
      abstentionAccuracy: ratio(correctAbstentions, heldOut.length),
      unanswerableAbstentionRate: ratio(correctUnanswerable, unanswerable),
    },
    latencyMs: {
      p50: percentile(latencies, 0.5),
      p95: percentile(latencies, 0.95),
      max: latencies.at(-1) ?? null,
    },
    acceptance: {
      recallTargetMet: recallAt5 !== null && recallAt5 >= 0.8,
      semanticRecallEvidence:
        run.evidenceKind !== 'synthetic_fake' && errors === 0 && degraded === 0 && answerable > 0,
      phase2Accepted: false as const,
    },
  };
};

export type EvaluationScore = ReturnType<typeof aggregate>;
export type ScoreResult =
  | { readonly ok: true; readonly value: EvaluationScore }
  | { readonly ok: false; readonly error: { readonly code: 'INVALID_EVALUATION_RUN' } };

/** Aggregate-only output: no question text, case IDs, paths, headings or raw retrieved content. */
export const scoreBrainEvaluation = (input: unknown): ScoreResult => {
  const run = validateEvaluationRun(input);
  return run.ok ? { ok: true, value: aggregate(run.value) } : run;
};
