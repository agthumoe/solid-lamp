// Reference reciprocal rank fusion (#126, docs/specs/brain-retrieval-core.md). The SQL
// `search_brain` function (#95) must order candidates exactly like this; tests compare them.

export const RRF_CONSTANT = 60;
export const MAX_FUSED_RESULTS = 50;

export type VectorHit = { readonly chunkId: string; readonly cosine: number };
export type LexicalHit = { readonly chunkId: string; readonly score: number };

export type FusedCandidate = {
  readonly chunkId: string;
  readonly fusedScore: number;
  readonly vectorRank: number | null;
  readonly lexicalRank: number | null;
  readonly cosine: number | null;
  readonly lexical: number | null;
};

export type FuseOptions = { readonly k?: number; readonly limit: number };

// Code-unit order, matching `ORDER BY chunk_id COLLATE "C"` in SQL.
const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

const bestRank = (candidate: FusedCandidate) =>
  Math.min(candidate.vectorRank ?? Infinity, candidate.lexicalRank ?? Infinity);

/**
 * Tie-break, in order: higher fused score; better best single-branch rank; chunk ID in
 * code-unit order. (A "found by both branches" step would be dead: at equal best rank the
 * two-branch candidate always has the strictly higher score.) Each branch list is in its own rank order (best
 * first); a chunk repeated within one branch keeps its first (best) rank.
 */
export const compareFused = (a: FusedCandidate, b: FusedCandidate): number =>
  b.fusedScore - a.fusedScore || bestRank(a) - bestRank(b) || byCodeUnit(a.chunkId, b.chunkId);

export const fuseRankings = (
  vector: readonly VectorHit[],
  lexical: readonly LexicalHit[],
  options: FuseOptions,
): FusedCandidate[] => {
  const k = options.k ?? RRF_CONSTANT;
  if (!Number.isInteger(k) || k < 1)
    throw new RangeError('rrf constant must be a positive integer');
  if (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > MAX_FUSED_RESULTS)
    throw new RangeError(`limit must be an integer from 1 to ${MAX_FUSED_RESULTS}`);

  type Entry = {
    vectorRank: number | null;
    lexicalRank: number | null;
    cosine: number | null;
    lexical: number | null;
  };
  const entries = new Map<string, Entry>();
  const entry = (chunkId: string): Entry => {
    const existing = entries.get(chunkId);
    if (existing) return existing;
    const created: Entry = { vectorRank: null, lexicalRank: null, cosine: null, lexical: null };
    entries.set(chunkId, created);
    return created;
  };

  let rank = 0;
  for (const hit of vector) {
    if (!Number.isFinite(hit.cosine)) throw new RangeError('cosine must be finite');
    const target = entry(hit.chunkId);
    if (target.vectorRank !== null) continue;
    target.vectorRank = ++rank;
    target.cosine = hit.cosine;
  }
  rank = 0;
  for (const hit of lexical) {
    if (!Number.isFinite(hit.score)) throw new RangeError('lexical score must be finite');
    const target = entry(hit.chunkId);
    if (target.lexicalRank !== null) continue;
    target.lexicalRank = ++rank;
    target.lexical = hit.score;
  }

  return [...entries]
    .map(([chunkId, e]): FusedCandidate => ({
      chunkId,
      fusedScore:
        (e.vectorRank === null ? 0 : 1 / (k + e.vectorRank)) +
        (e.lexicalRank === null ? 0 : 1 / (k + e.lexicalRank)),
      ...e,
    }))
    .sort(compareFused)
    .slice(0, options.limit);
};
