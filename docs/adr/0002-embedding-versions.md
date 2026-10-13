# ADR 0002 — Isolate embeddings by version and dimension

Status: Accepted, 2026-10-12. Implementation begins in Phase 1 migrations.

## Decision

Keep chunks independent of embeddings. Store embeddings in separate fixed-dimension tables, `chunk_embeddings_1024` and `chunk_embeddings_768`, each referencing `(chunk_id, embedding_version_id)` with a unique constraint and its own vector index. Add `embedding_versions` with model digest, dimensions, query/document prefixes, chunker version, and lifecycle status. A singleton search configuration references the active version. Register supported dimensions explicitly; reject unsupported dimensions rather than padding or truncating vectors.

The fallback is an explicit index migration, not an automatic query-time substitution. If the active embedding model is unavailable, vector search fails clearly (or the caller explicitly requests lexical-only search). Never embed a query with the fallback and search the primary index.

Re-index into a building version without modifying the active version. Validate dimensions and finite values for every vector. Track document content hashes, reconcile updates/deletions, and verify complete coverage and retrieval acceptance before an atomic active-version switch. Pin each search to one version, including query embedding and vector lookup; retain the prior version for in-flight queries and rollback. Failed builds leave the active version intact. Delete old versions only after their retention window and in-flight readers finish.

## Consequences

1024- and 768-dimensional models have distinct indexes. Same-dimensional models are still isolated by version; queries must filter the pinned version before ranking. Chunk mutations invalidate stale embeddings by content hash. Re-indexing temporarily costs extra storage. Adding another dimension requires a migration and an explicit config update.

Phase 1 migrations establish this schema; Phase 2 implements build/catch-up/switch and validates it using the acceptance cases in `docs/specs/embedding-storage.md`.
