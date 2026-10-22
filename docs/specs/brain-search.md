# Brain search and protected routes

Issue: [#95](https://github.com/agthumoe/solid-lamp/issues/95). Parent: [#4](https://github.com/agthumoe/solid-lamp/issues/4). Requirements: [brain](brain.md) → _Search contract_, _MCP and access_. Builds on [revisions schema](brain-revisions.md) (#91), [embedding profiles](inference-rpc.md#embedding-profiles-adr-0006-94) (#94), [access boundary](brain-access.md), [API contracts](brain-api-contracts.md), [retrieval core](brain-retrieval-core.md) and the citation codec (#118).

## Pipeline (`apps/api/src/features/brain`)

1. **Pin.** Read the active version, its profile (ID and digest) and its frozen evidence gates in one query. With no active version, the answer is `not_indexed`. A version without gates is **not searchable**: the request fails as 503 `UNAVAILABLE`, rather than returning ungated results.
2. **Embed (hybrid only).**
   - The query is embedded at interactive priority with the version's `profileId`.
   - The returned profile ID, digest and dimensions must equal the pinned version's, including when dimensions are equal. A mismatch or embedding failure is 503 `UNAVAILABLE`.
   - Lexical-only is used only when the caller requests it (`mode=lexical` → `lexical_only`), and then no embedding is made.
3. **Candidates (`brain_search_candidates`, SQL).**
   - Both branches read only the pinned version's selected chunk sets, on each live document's **current** revision. The vector branch additionally needs a vector whose `content_hash` matches the chunk.
   - Filters (enabled source names, tags any/all, component-aware path prefix with literal `%`/`_`) apply **before** each branch's bounded candidate list (100 per branch).
   - The merge is RRF with k = 60, in exactly the [reference order](brain-retrieval-core.md) (a test compares them). The function uses `security invoker` and `search_path ''`, and is executable only by `aetherion_brain_reader`.
4. **Gates.** `applyEvidenceGates` keeps fused order and drops weak evidence. Nothing left gives `no_match`.
5. **Cite.**
   - Each result is cited at the revision it was indexed from: path, heading path with its duplicate occurrence, and line range. Citations carry the display form plus the structured identity.
   - Backfilled Phase 1 chunks without line ranges, or with paths or headings the codec refuses, are dropped rather than cited inaccurately.
   - Snippets are at most 1,200 characters, cut on a code-point boundary.
6. **Label.** `corpus` is `complete` only when every live document's current revision is selected and fully embedded.

## Note excerpts (`GET /api/v1/brain/note`)

- **Lookup.** The cited chunk must exist in the named document and **enabled** source, in a set of the named version's chunker.
- **NOT_FOUND.** Its revision number and source-byte hash must match the citation; a forged or out-of-scope citation gets the same 404.
- **Stale.** If the note has since been deleted, edited (revision or content changed) or moved (`pathSha256` mismatch with the current path), the answer is `stale` with a reason and **no text**.
- **Excerpt.** Otherwise the excerpt is bounded by `maxChars` and cut on a code-point boundary.

## Stats (`GET /api/v1/brain/stats`)

- **Active version:** ID, `embedRole: embed`, dimensions, chunker and promotion time.
- **Counts:** live documents, selected chunks on current revisions, and those with matching vectors.
- **Corpus completeness:** `empty`, `complete` or `incomplete`.
- **Per enabled source:** document count, last ingest time, and last scan state from `source_sync_state`.

## Access

- All three routes sit inside the fail-closed service scope: key, loopback bind and peer, no browser origin, bounded in-flight requests (4), `no-store`.
- They are mounted only when a database is configured (readiness reports `not_configured` otherwise).
- Each request also has a 20 s deadline and aborts on client disconnect.

## Recovery gate (final schema)

The backup manifest gains `searchProbe`: the ordered chunk IDs from `brain_search_candidates` for a fixed vector and query text on the active version. Restore verification fails if the restored database answers differently. Older manifests without the field parse as an empty probe.

## Verification

- **Database (`packages/db/test/integration/brain-search.int.test.ts`):**
  - eligibility: deleted, superseded and unselected chunks are excluded, and a stale vector never ranks but its text still matches lexically;
  - filters before limits, including literal LIKE metacharacters and component-aware prefixes;
  - **exact ordering and fused scores against `fuseRankings`**;
  - lexical-only mode, a 768-dimension version, a dimension mismatch, and parameter bounds;
  - gate immutability and execute privileges.
- **Use cases:** `not_indexed`; uncalibrated fails closed; the pinned profile is used and a mismatched identity is refused (including the same dimensions with a different digest); lexical mode never embeds; gates decide the results; an unknown source never widens the search; uncitable chunks are dropped; note staleness and NOT_FOUND cases.
- **End to end (`apps/api/test/integration`), real Postgres plus a fake embedder:**
  - 401 without the key;
  - cited results, including a duplicate heading shown as `~2`;
  - injected text returned as lexical data;
  - an unrelated query gets `no_match`;
  - a forged or out-of-scope note gets 404;
  - after an edit, the old citation is `stale` and its chunks leave search;
  - stats;
  - uncalibrated → 503, no key → 503.
- **Recovery gate:** passes with the search probe.

## Not yet

- Reader leases on multi-step reads, which wait for the cleanup jobs that would need them.
- HNSW use with selective filters: the vector branch is an exact scan over eligible chunks, which is fine at personal-vault scale. Measure before adding iterative scans.
- Real calibration data (#98/#99).
