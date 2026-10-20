// Evidence-gate calibration (#126) on the calibration split only. Exhaustive search over the
// observed evidence values (bounded by quantiles), so the result is reproducible and explainable.
import { createHash } from 'node:crypto';

import { z } from 'zod';

import { freezeGates, passesGates, type EvidenceGates } from './gates.ts';

const MAX_GRID = 256;

const candidateSchema = z.strictObject({
  chunkId: z.string().min(1).max(96),
  cosine: z.number().finite().min(-1).max(1).nullable(),
  lexical: z.number().finite().min(0).nullable(),
  relevant: z.boolean(),
});

export const calibrationSetSchema = z.strictObject({
  questions: z
    .array(
      z.strictObject({
        id: z.string().regex(/^[A-Za-z0-9_.-]{1,96}$/),
        split: z.enum(['calibration', 'held_out']),
        answerable: z.boolean(),
        // In fused order, as search would return them before gating.
        candidates: z.array(candidateSchema).max(200),
      }),
    )
    .min(2)
    .max(5_000),
});

export type CalibrationSet = z.infer<typeof calibrationSetSchema>;

export type CalibrationReport = {
  readonly questions: number;
  readonly answerableHits: number;
  readonly answerable: number;
  readonly correctAbstentions: number;
  readonly unanswerable: number;
};

export class CalibrationInputError extends Error {}

// Up to MAX_GRID distinct observed values (evenly spaced quantiles when there are more), plus
// `null` for "this branch's gate is off".
const grid = (values: readonly number[]): (number | null)[] => {
  const distinct = [...new Set(values)].sort((a, b) => a - b);
  const picked =
    distinct.length <= MAX_GRID
      ? distinct
      : Array.from(
          { length: MAX_GRID },
          (_, i) => distinct[Math.round((i * (distinct.length - 1)) / (MAX_GRID - 1))] ?? 0,
        );
  return [null, ...picked];
};

const canonicalHash = (set: CalibrationSet) =>
  createHash('sha256').update(JSON.stringify(set)).digest('hex');

export const calibrateEvidenceGates = (
  input: unknown,
  options: { readonly id: string; readonly topK?: number },
): { readonly gates: EvidenceGates; readonly report: CalibrationReport } => {
  const set = calibrationSetSchema.parse(input);
  const topK = options.topK ?? 5;
  if (set.questions.some((question) => question.split !== 'calibration'))
    throw new CalibrationInputError('held-out questions must not be used to calibrate gates');
  if (new Set(set.questions.map((question) => question.id)).size !== set.questions.length)
    throw new CalibrationInputError('duplicate question id');
  const answerable = set.questions.filter((question) => question.answerable).length;
  const unanswerable = set.questions.length - answerable;
  if (answerable === 0 || unanswerable === 0)
    throw new CalibrationInputError('calibration needs both answerable and unanswerable questions');
  if (set.questions.some((q) => !q.answerable && q.candidates.some((c) => c.relevant)))
    throw new CalibrationInputError('an unanswerable question has a relevant candidate');

  const all = set.questions.flatMap((question) => question.candidates);
  const cosines = grid(all.flatMap((c) => (c.cosine === null ? [] : [c.cosine])));
  const lexicals = grid(all.flatMap((c) => (c.lexical === null ? [] : [c.lexical])));

  let best:
    | {
        minCosine: number | null;
        minLexical: number | null;
        score: number;
        passing: number;
        report: CalibrationReport;
      }
    | undefined;
  for (const minCosine of cosines)
    for (const minLexical of lexicals) {
      const gates = { id: options.id, minCosine, minLexical, calibration: null };
      let answerableHits = 0;
      let correctAbstentions = 0;
      let passing = 0;
      for (const question of set.questions) {
        const passed = question.candidates.filter((c) => passesGates(c, gates, 'hybrid'));
        passing += passed.length;
        if (question.answerable) {
          if (passed.slice(0, topK).some((c) => c.relevant)) answerableHits += 1;
        } else if (passed.length === 0) correctAbstentions += 1;
      }
      const score = answerableHits + correctAbstentions;
      // Ties prefer the stricter gate (fewer candidates pass), then higher thresholds.
      const better =
        !best ||
        score > best.score ||
        (score === best.score &&
          (passing < best.passing ||
            (passing === best.passing &&
              ((minCosine ?? Infinity) > (best.minCosine ?? Infinity) ||
                ((minCosine ?? Infinity) === (best.minCosine ?? Infinity) &&
                  (minLexical ?? Infinity) > (best.minLexical ?? Infinity))))));
      if (better)
        best = {
          minCosine,
          minLexical,
          score,
          passing,
          report: {
            questions: set.questions.length,
            answerableHits,
            answerable,
            correctAbstentions,
            unanswerable,
          },
        };
    }

  if (!best) throw new CalibrationInputError('no candidate gates');
  return {
    gates: freezeGates({
      id: options.id,
      minCosine: best.minCosine,
      minLexical: best.minLexical,
      calibration: { questions: set.questions.length, sha256: canonicalHash(set), topK },
    }),
    report: best.report,
  };
};
