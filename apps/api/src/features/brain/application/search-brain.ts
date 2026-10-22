// search_brain use case (#95, docs/specs/brain-search.md). Pins the active version first and
// keeps it for the whole request: the query is embedded with that version's profile, the
// returned identity is verified, candidates come only from that version's selection, and the
// version's frozen evidence gates decide what is returned. Nothing falls back silently.
import { applyEvidenceGates, type SearchMode } from '@aetherion/brain';
import { appError, err, ok, type AppError, type Result } from '@aetherion/shared';
import {
  BRAIN_SNIPPET_MAX_CHARS,
  type BrainSearchQuery,
  type BrainSearchResponse,
  type BrainSearchResult,
} from '@aetherion/shared/contracts';

import { bounded, citationFor } from './citations.ts';
import type { BrainStore, Candidate, QueryEmbedder } from './ports.ts';

// Per-branch candidates before fusion; filters apply before this bound (in SQL).
export const BRANCH_LIMIT = 100;
// Fused candidates fetched before gating. The requested limit is applied only after gates and
// citation eligibility, so a rejected high-fusion candidate never hides one that passes.
export const CANDIDATE_POOL = 50;

export type SearchDeps = {
  readonly store: BrainStore;
  readonly embed: QueryEmbedder;
  readonly now?: () => number;
};

const unavailable = (message: string): Result<never, AppError<'UNAVAILABLE'>> =>
  err(appError('UNAVAILABLE', message));

export const searchBrain = async (
  deps: SearchDeps,
  query: BrainSearchQuery,
  signal: AbortSignal,
): Promise<Result<BrainSearchResponse, AppError<'UNAVAILABLE'>>> => {
  const now = deps.now ?? Date.now;
  const started = now();
  const mode: SearchMode = query.mode === 'lexical' ? 'lexical_only' : 'hybrid';
  const took = () => Math.max(0, now() - started);

  const version = await deps.store.pinActiveVersion(signal);
  if (!version)
    return ok({
      status: 'not_indexed',
      versionId: null,
      results: [],
      corpus: 'incomplete',
      mode,
      tookMs: took(),
    });
  if (!version.gates) return unavailable('relevance gates are not calibrated for the active index');

  let queryVector: readonly number[] | null = null;
  if (mode === 'hybrid') {
    const embedded = await deps.embed(query.q, version.profileId, signal);
    if (!embedded.ok) return embedded;
    // The vector must come from exactly the pinned profile (ADR 0006), even at equal dimensions.
    if (
      embedded.value.profileId !== version.profileId ||
      embedded.value.digest !== version.profileDigest ||
      embedded.value.dimensions !== version.dimensions ||
      embedded.value.vector.length !== version.dimensions
    )
      return unavailable('the query embedding does not match the active index profile');
    queryVector = embedded.value.vector;
  }

  const sourceIds = query.source.length
    ? await deps.store.sourceIdsByName(query.source, signal)
    : [];
  // An unknown source name matches nothing rather than widening the search to every source.
  if (query.source.length && !sourceIds.length)
    return ok({
      status: 'no_match',
      versionId: version.versionId,
      results: [],
      corpus: (await deps.store.corpusComplete(version.versionId, signal))
        ? 'complete'
        : 'incomplete',
      mode,
      tookMs: took(),
    });

  const [candidates, complete] = await Promise.all([
    deps.store.searchCandidates(
      {
        versionId: version.versionId,
        queryVector,
        queryText: query.q,
        filters: {
          sourceIds,
          tags: query.tag,
          tagsAll: query.tagMode === 'all',
          pathPrefix: query.pathPrefix ?? null,
        },
        branchLimit: BRANCH_LIMIT,
        resultLimit: CANDIDATE_POOL,
      },
      signal,
    ),
    deps.store.corpusComplete(version.versionId, signal),
  ]);
  const corpus = complete ? 'complete' : 'incomplete';
  const gated = applyEvidenceGates(candidates, version.gates, mode);
  const details = new Map(
    (
      await deps.store.chunkDetails(
        gated.results.map((c) => c.chunkId),
        signal,
      )
    ).map((d) => [d.chunkId, d]),
  );

  const results: BrainSearchResult[] = [];
  for (const candidate of gated.results satisfies readonly Candidate[]) {
    if (results.length >= query.limit) break;
    const detail = details.get(candidate.chunkId);
    const citation = detail && citationFor(detail, version.versionId);
    if (!detail || !citation) continue;
    results.push({
      chunkId: candidate.chunkId,
      documentPath: detail.path,
      title: detail.title || null,
      headingPath: [...detail.headingPath],
      lineStart: citation.lineStart,
      lineEnd: citation.lineEnd,
      snippet: bounded(detail.content, BRAIN_SNIPPET_MAX_CHARS).text,
      fusedScore: candidate.fused,
      vectorRank: candidate.vectorRank,
      lexicalRank: candidate.lexicalRank,
      cosineSimilarity: candidate.cosine,
      lexicalScore: candidate.lexical,
      citation,
    });
  }
  return ok(
    results.length
      ? { status: 'ok', versionId: version.versionId, results, corpus, mode, tookMs: took() }
      : {
          status: 'no_match',
          versionId: version.versionId,
          results: [],
          corpus,
          mode,
          tookMs: took(),
        },
  );
};
