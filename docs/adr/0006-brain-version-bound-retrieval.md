# ADR 0006 — Version-bound embedding profiles and immutable chunk sets

Date: 2026-10-18. Status: **proposed for review**, not accepted. Task: [#84](https://github.com/agthumoe/solid-lamp/issues/84), PR [#85](https://github.com/agthumoe/solid-lamp/pull/85). Related: [brain spec](../specs/brain.md), [review](../reviews/phase2-plan-pr85.md), [ADR 0002](0002-embedding-versions.md).

## Context

ADR 0002 requires a search to use one embedding version from query embedding to retrieval and to remain usable across a rebuild. The current internal embed RPC resolves only the current `embed` role. Its response reports model/context/dimensions, but not profile/digest/prefix identity. The current chunks table also has unique `(document_id, ordinal)` rows shared by every vector version. These interfaces cannot by themselves support simultaneous old/new profiles and chunker layouts.

## Proposed decision

### Embedding profile identity

Introduce an immutable embedding-profile ID covering model artifact digest, dimensions, query/document prefixes and `num_ctx`. An embedding version references a profile plus chunker identity. Profile changes create new versions; never silently mutate the identity of an active version.

The authenticated inference process accepts an opaque profile ID and resolves it through an injected trusted registry. Provision that registry from operator-controlled local configuration; ingestion/read tools cannot register arbitrary profiles. Validate profiles against accepted catalog records and installed artifact digests. Keep the runtime `embed` role as the default profile binding; explicit version-bound requests remain constrained to approved profiles serving that role. Raw model tags and prefix overrides are not RPC inputs.

Snapshot the resolved profile at enqueue and return its identity with the vectors. Brain callers verify it before a vector is stored or compared, including same-dimensional models. Keep approved profiles available for active/building versions and bounded in-flight readers. Missing or replaced artifacts fail explicitly. Profile configuration changes and model/index promotion retain the existing owner-approval boundary.

The existing inference process remains the only GPU gate. The worker submits separately bounded background batches over RPC; query embeddings have interactive priority. This proposal adds no direct Ollama path, cloud inference or second scheduler.

### Chunk and source revision identity

Introduce immutable document revisions and chunk sets keyed by document revision plus chunker identity. Give each embedding version a per-document selection of its chunk set. Use new migrations to replace the current ordinal uniqueness with a chunk-set-aware key and preserve existing rows through a tested backfill. Keep display metadata and citation locators tied to the indexed revision, even when embedding text is reused.

Both vector and lexical retrieval use the pinned version's chunk-set selection. Current source revision/tombstone checks exclude stale or deleted content; retaining old chunks is not permission to serve old private content after a deletion. Late work publishes only when its expected source revision still matches.

### Promotion and readers

Coverage verification and active-version switch must serialize against ingestion publication or validate a durable ingestion watermark within the promotion transaction. SQL foreign keys prove version/status consistency, not semantic coverage. Failed builds leave active selections unchanged. Retain immutable selection state under bounded reader leases; cleanup waits for readers and the retention window. Rollback must pass current-coverage checks again.

### Schema and privilege boundaries

Enforce revision/chunk-set/version relationships with composite uniqueness and foreign keys, and index lookup/pending-work columns. Preserve RLS and explicit grants. Retrieval functions use invoker privileges, qualified objects and a fixed safe search path. Runtime reader/writer roles cannot restore or drop databases; maintenance tools use separate privileges.

## Alternatives considered

- **Use whichever model the current role resolves:** breaks a query pinned to an older embedding space during promotion, including equal-dimensional changes.
- **Allow arbitrary model/prefix fields in RPC:** lets callers bypass the role/catalog contract. Rejected in favor of approved opaque profiles.
- **Overwrite shared chunks during rebuild:** invalidates active vectors and citations before the new index is complete.
- **Block all search/ingestion during every rebuild:** simpler but conflicts with background rebuild and in-flight search continuity; would need an explicit scope change.

## Consequences and acceptance

Extra storage, registry provisioning and reader retention add complexity. The schema/RPC implementation must update the brain and inference specs together and test upgrade/backfill, stale jobs, source deletion, failed rechunk, paused query during promotion, identical dimensions/different profiles, restart with a prior active profile, watermark races and stale rollback rejection. No implementation is authorized by this proposed ADR; accept or amend it with the plan before task execution.
