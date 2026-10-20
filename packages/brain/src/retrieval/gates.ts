// Versioned evidence gates (#126). Fusion only orders candidates; a candidate is returned only
// with enough absolute evidence. Gates are calibrated once on the calibration split, frozen and
// stored with the version; held-out evaluation uses them unchanged.
import { z } from 'zod';

import type { FusedCandidate } from './fuse.ts';

const threshold = z.number().finite().nullable();

export const evidenceGatesSchema = z.strictObject({
  id: z.string().regex(/^[A-Za-z0-9_.-]{1,96}$/),
  // null disables that branch's gate: nothing passes on that evidence alone.
  minCosine: threshold.refine((v) => v === null || (v >= -1 && v <= 1), 'cosine range'),
  minLexical: threshold.refine((v) => v === null || v >= 0, 'lexical range'),
  calibration: z
    .strictObject({
      questions: z.int().min(1),
      sha256: z.string().regex(/^[a-f0-9]{64}$/),
      topK: z.int().min(1).max(50),
    })
    .nullable(),
});

export type EvidenceGates = Readonly<z.infer<typeof evidenceGatesSchema>>;
export type SearchMode = 'hybrid' | 'lexical_only';

export const freezeGates = (gates: unknown): EvidenceGates => {
  const parsed = evidenceGatesSchema.parse(gates);
  if (parsed.calibration) Object.freeze(parsed.calibration);
  return Object.freeze(parsed);
};

type Evidence = Pick<FusedCandidate, 'cosine' | 'lexical'>;

export const passesGates = (candidate: Evidence, gates: EvidenceGates, mode: SearchMode) =>
  (mode === 'hybrid' &&
    gates.minCosine !== null &&
    candidate.cosine !== null &&
    candidate.cosine >= gates.minCosine) ||
  (gates.minLexical !== null &&
    candidate.lexical !== null &&
    candidate.lexical >= gates.minLexical);

export type GatedResult<T> =
  | { readonly status: 'ok'; readonly results: readonly T[] }
  | { readonly status: 'no_match'; readonly results: readonly [] };

/** Keeps fused order; drops candidates without enough evidence. Nothing left is `no_match`. */
export const applyEvidenceGates = <T extends Evidence>(
  candidates: readonly T[],
  gates: EvidenceGates,
  mode: SearchMode,
): GatedResult<T> => {
  const results = candidates.filter((candidate) => passesGates(candidate, gates, mode));
  return results.length ? { status: 'ok', results } : { status: 'no_match', results: [] };
};
