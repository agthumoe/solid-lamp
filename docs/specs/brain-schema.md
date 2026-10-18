# Brain core schema and `packages/db`

Issue: [#73](https://github.com/agthumoe/solid-lamp/issues/73). Status: implemented (Phase 1 schema; Phase 2 behaviour pending). Parent: #3. Decisions: [ADR 0002](../adr/0002-embedding-versions.md); contracts: [embedding storage](embedding-storage.md), [database](../development/database.md), BUILD_PROMPT §7.

## Goal

The first migration gives the brain its durable core and the ADR 0002 versioned embedding storage. Database constraints enforce the invariants, so an application bug cannot mix vector spaces. `packages/db` mirrors the schema for typed queries.

## Non-goals

- The Supabase CLI project (`supabase/config.toml`): it needs Docker and a review of how Supabase publishes its ports (loopback only).
- `search_brain` with RRF, and the rebuild, catch-up and promotion jobs (Phase 2).
- Run, approval, audit, outbox, memory, task and finance tables (their own phases).

## Schema (`supabase/migrations/20261018120000_brain_core.sql`)

- **Extensions:** `extensions` schema with `vector`; every vector type and operator class is schema-qualified.
- **`sources`:** kind enum check, unique name, `config` object (paths and filters only, no credentials), `enabled`, `last_synced_at`.
- **`documents`:** unique `(source_id, uri)`, SHA-256 `content_hash`, a `deleted_at` tombstone for reconciliation, GIN on `tags`.
- **`chunks`:** unique `(document_id, ordinal)`, `heading_path text[]`, `content_hash`, `token_count`, `chunker_version`, `tsv` generated from `to_tsvector('english', content)` with a GIN index. There is no embedding column.
- **`links`:** wikilink, tag, mention or import; a resolved target or an unresolved title is required.
- **`embedding_versions`:** model, digest, `dimensions` in (768, 1024), prefixes, chunker version, and `status` (`building | ready | active | retired | failed`). At most one active version (partial unique index), and an active version must have `promoted_at`.
- **`chunk_embeddings_1024` / `_768`:**
  - Primary key `(embedding_version_id, chunk_id)` and a fixed `dimensions` column with a check.
  - A composite FK `(embedding_version_id, dimensions)` to the version, so a 768 version can never write to the 1024 table and vice versa.
  - A `content_hash` for staleness, a cascade from chunks, and an HNSW `vector_cosine_ops` index.
  - pgvector rejects wrong lengths and non-finite values.
- **`search_config`:** a singleton (`id boolean` check). `(active_embedding_version_id, active_status = 'active')` is a deferrable FK to `(id, status)`. Promotion therefore retires the old version, activates the new one and repoints the config in one transaction; a dangling pointer cannot commit.
- **RLS:** enabled on every table, with no policies, so accidental Supabase API exposure fails closed. Server roles bypass RLS.

## `packages/db`

`schema/brain.ts` mirrors the columns, types, nullability, defaults and foreign keys, using `customType` for `tsvector` and Drizzle `vector` for the embeddings. SQL-only details (checks, generated expression, partial/HNSW indexes, deferrable FK, RLS) stay in the migration and are covered by integration tests. `createDatabaseClient({ url })` is a factory, never a module-level singleton, and accepts only `postgres://` URLs on private hosts.

## Verification

`pnpm test:int` (`packages/db/test/integration`) creates a throwaway database, replays every migration in order (one transaction per file, as the Supabase CLI does) and checks:

- the table set and the extension's schema;
- Drizzle/catalog parity (column, type, nullability);
- dimension/version mismatches, wrong lengths, NaN, duplicate `(version, chunk)` and unregistered dimensions;
- one active version, and promotion required for active;
- the search config singleton, its active-only pointer, an atomic promotion and a rejected dangling pointer;
- the generated tsvector search and cascades through Drizzle inserts;
- link and hash checks, and RLS on every table.

CI runs it in the required `compliance` job against a digest-pinned `pgvector/pgvector:0.8.7-pg17` service on `127.0.0.1`. Locally it skips with a stated reason until `AETHERION_TEST_DATABASE_URL` points at Postgres with pgvector. Supabase's own Postgres image adds roles and schemas that this replay does not cover; re-verify with `supabase db reset` once Docker runs.

## Open questions

HNSW with a version filter post-filters candidates. In Phase 2, measure recall with several versions present and consider per-version partial indexes or pgvector iterative scans.
