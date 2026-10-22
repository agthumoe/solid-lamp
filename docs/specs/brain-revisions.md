# Brain revisions schema (ADR 0006)

Issue: [#91](https://github.com/agthumoe/solid-lamp/issues/91). Parent: [#4](https://github.com/agthumoe/solid-lamp/issues/4). Decision: [ADR 0006](../adr/0006-brain-version-bound-retrieval.md) (accepted 2026-10-21). Requirements: [brain](brain.md) → _Schema additions_, _Embedding lifecycle_, _Ingestion rules_; review findings F2/F5 ([review](../reviews/phase2-plan-pr85.md)). Builds on the [Phase 1 schema](brain-schema.md).

Migration: `supabase/migrations/20261021120000_brain_revisions.sql` (one forward migration; Phase 1 rows are preserved by a backfill). Typed mirror: `packages/db/src/schema/brain.ts`.

## Goal

A rebuild with a new chunker or embedding profile must never invalidate the active index or its citations. A delayed ingestion job must never overwrite a newer edit or delete, and a lost Redis queue must be recoverable from Postgres. Promotion must prove complete coverage of the corpus as it stands at that moment.

## Tables

| Table                          | Holds                                                                                                                                                       | Key invariants                                                                                                                                                           |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `embedding_profiles`           | Opaque embedding-space identity: model, artifact digest, dimensions, prefixes, `num_ctx`                                                                    | Immutable (update trigger). `embedding_versions.profile_id` is required; the composite FK `(profile_id, dimensions, model_digest)` ties a version to exactly its profile |
| `document_revisions`           | Every published state of a document, including `tombstone` revisions: path, title, tags, frontmatter, exact source-byte hash                                | Immutable; unique `(document_id, revision)`; a tombstone has no hash. `documents.current_revision_id` must reference the document's own revision (deferred composite FK) |
| `chunk_sets`                   | The chunks one chunker produced for one revision                                                                                                            | Immutable; unique `(document_revision_id, chunker_version)`; composite FK to its revision and document                                                                   |
| `chunks` (changed)             | Adds `chunk_set_id` and `line_start`/`line_end`                                                                                                             | Immutable. Unique `(chunk_set_id, ordinal)` replaces `(document_id, ordinal)`; composite FKs make a chunk's document and chunker its set's; a valid line range           |
| `embedding_version_selections` | Which chunk set each version uses for each document                                                                                                         | Composite FKs: the set must be for that document and have the version's chunker                                                                                          |
| `ingest_events`                | The durable record behind queue jobs: kind (`changed`, `deleted`, `resync`), document reference, path hash, base revision, status, attempts, lease, backoff | `id` is the monotonic ingestion sequence (watermark). A resync has no document or path hash. A lease needs an owner and expiry; `done`/`superseded` need `processed_at`  |
| `source_sync_state`            | Per-source last scan times, completeness, counters, last error code                                                                                         | Only a complete scan may tombstone missing files                                                                                                                         |
| `embedding_builds`             | Resumable (re)build progress: totals, cursor, watermark, error code                                                                                         | One running/paused build per version; progress never exceeds the total                                                                                                   |
| `embedding_version_leases`     | Bounded reader leases (at most 15 minutes) for multi-step reads                                                                                             | Cleanup of retired versions' chunk sets waits for every lease to expire                                                                                                  |

Deletion stays possible everywhere (retention and cascades); only updates of immutable identities are refused.

## Publication: `brain_publish_revision(document, expected_revision, new_revision)`

The worker inserts the new immutable revision, its chunk sets and chunks, then calls the function in the same transaction. The function:

1. Takes the publication advisory lock in **shared** mode, so publications run concurrently with each other.
2. Locks the document row. If its current revision is not `expected_revision`, it returns `false` and changes nothing. A job planned against an older state is stale (F5).
3. Requires the new revision to belong to the document and have a higher number than the current one.
4. Moves `current_revision_id` and copies the revision's path, title, tags and frontmatter to `documents`. A tombstone sets `deleted_at`; a content revision clears it.
5. Repoints selections. Every `building`/`ready`/`active` version whose chunker has a set for the new revision now selects it. A tombstone drops the document's selections. Retired versions are not updated, so rolling back to one requires rebuilding its coverage first.

A delete therefore wins over a late edit: the tombstone advances the revision, and the late job's compare-and-set fails. Recreating a file is a new revision on top of the tombstone.

## Promotion: `brain_promote_version(version)`

Promotion is an approved administrative action. Only the owner/maintenance role may execute it; the writer role cannot. The function:

1. Takes the publication lock in **exclusive** mode. It waits for in-flight publications to commit, and no new publication can start until promotion commits. Coverage is checked against a corpus that cannot move (F2).
2. Requires `ready`, `retired` (rollback) or `active` status.
3. Counts two things and raises with both counts if either is non-zero:
   - live documents without a selection on their **current** revision;
   - selected chunks without a vector in the version's dimension table whose `content_hash` matches the chunk.
4. Retires the previous active version, activates this one and repoints `search_config`, all in one transaction.

Search (#95) must use the same eligibility as promotion: the pinned version's selection, the selected set on the document's current revision, a live document, and a matching vector hash for the vector branch.

## Privileges

- **RLS** is on for every table. The only policies are for the two brain group roles, so RLS stays closed for every other role, including Supabase API roles. (`BYPASSRLS` is not inherited through role membership.)
- **`aetherion_brain_reader`** (NOLOGIN, no CREATEDB): reads the corpus and takes reader leases. It cannot write anything else or publish.
- **`aetherion_brain_writer`** (NOLOGIN, no CREATEDB): inserts revisions, sets, chunks, vectors and links. It updates documents, events, sync state and builds, executes `brain_publish_revision`, and cannot promote, change profiles or touch `search_config`.
- **Functions:** both use `security invoker` and `set search_path = ''`, with schema-qualified objects. Execution is revoked from `public`.
- **Logins:** the operator creates login roles as members of these group roles. Credentials never live in tables.

## Upgrade and backfill

- Revision 1 is created per Phase 1 document, plus a tombstone revision 2 for an already deleted one.
- One chunk set is created per `(document, chunker)` on revision 1. Chunk IDs, text and hashes are unchanged; backfilled chunks have null line ranges.
- Selections are created for every existing version whose chunker matches a live document's set.
- A `legacy-v<id>` profile is created per version, with null `num_ctx` because Phase 1 never recorded it. New profiles set it.
- A Phase 1 active version that covered its corpus still passes the promotion coverage check after the upgrade.

## Locks and operations

- `ALTER TABLE` on `chunks`, `documents` and `embedding_versions` takes `ACCESS EXCLUSIVE` locks. The migration runs before real ingestion, as one transaction, with `lock_timeout` 10 s and `statement_timeout` 5 min.
- Rollback before real ingestion is a restore from the pre-migration backup; afterwards, a forward fix.
- The recovery gate's manifest now counts the new tables. Reader leases are transient and are not compared.

## Verification

`pnpm test:int` covers all of the following. The suites ran against the local Supabase Postgres image as well as the CI pgvector service.

- **Empty replay:** the table set and Drizzle parity for all 16 tables.
- **Upgrade fixture:** Phase 1 rows seeded under the old schema, then migrated and checked row for row.
- **Constraints:** immutability triggers, and every composite key.
- **Publication:** compare-and-set, increasing numbers, foreign revisions, delete-over-late-edit with no resurrection, and selection repointing by status and chunker (a failed rechunk leaves a stale selection that promotion rejects).
- **Promotion:** status, missing selections, missing and stale vectors, deleted documents exempt, the atomic switch, and stale rollback rejected.
- **Concurrency:** promotion times out while a publication holds the lock, then sees the committed edit.
- **Durable work:** event, build and lease state rules.
- **Privileges:** function security, role attributes, and reader/writer allowed and denied commands.
- **Recovery gate:** passes on the new schema, including roles and policies.
