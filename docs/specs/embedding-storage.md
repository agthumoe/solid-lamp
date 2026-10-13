# Embedding storage and migration

Goal: support configured 1024-dimensional primary and 768-dimensional fallback without mixing vector spaces or serving a partially rebuilt index.

Inputs: embed role config, model digest, prefixes, chunker version, chunk text/hash. Outputs: versioned embeddings, index status, pinned hybrid search results with citations.

Schema: see ADR 0002. `chunks` contains text and lexical search metadata, not a fixed embedding column. Each dimension table holds `chunk_id`, `embedding_version_id`, `content_hash`, embedding, and timestamps. Versions declare dimensions and model identity; foreign keys and application validation ensure rows match their version's dimension table. The active version lives in a transactional singleton record.

Search: snapshot active version; use that version's model and query prefix; select only matching-version embeddings whose stored hash matches the current chunk; combine with lexical results using RRF. Never substitute another model implicitly. Return the pinned version in diagnostics. Permit an explicit lexical-only degraded mode.

Rebuild: create a building version, embed all eligible chunks in bounded batches through LlmGate, reconcile changes/deletes, run coverage/quality checks, and atomically promote after catch-up. Restartable jobs track progress. Promotion serializes against ingestion writes or verifies a watermark within the same transaction. Existing searches retain their pinned version until completion. On failure preserve the active version; expose failure and retry controls. Rollback atomically selects a validated prior version, whose content coverage must be checked again.

Approval: switching the active model/index through a write API follows the approval queue. Background ingestion into app-owned tables follows configured ingestion policy; it never edits the source vault.

Acceptance tests (Phase 1 schema / Phase 2 behavior):
- Store 1024 and 768 vectors in their own tables; reject wrong dimensions and nonfinite values.
- Same-dimension model versions never appear in one vector result set.
- Interrupted/failed rebuild leaves active searches unchanged and resumes without duplicate rows.
- Query during promotion uses one model/version throughout.
- Edits/deletions during rebuild are reconciled; stale hashes are never returned.
- Model unavailable produces an explicit error or requested lexical-only results.
- Promotion requires complete coverage and eval thresholds; rollback preserves citations.
