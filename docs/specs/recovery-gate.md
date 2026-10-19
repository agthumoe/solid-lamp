# Recovery gate: backup and isolated restore

Issue: [#87](https://github.com/agthumoe/solid-lamp/issues/87) (P2-1). Status: implemented (current-schema gate). Parent: [#4](https://github.com/agthumoe/solid-lamp/issues/4). Contracts: [security/recovery](security-recovery.md) Phase 2, [database](../development/database.md) (backup before persistent changes; restore into an isolated database), [operations](../development/operations.md) (admin processes are explicit one-off commands). Plan: `docs/specs/brain.md` task 1 and review finding F7 ([PR #85](https://github.com/agthumoe/solid-lamp/pull/85)).

## Goal

Before any real note is ingested, prove that a backup of the database can be restored into a separate database and still answers the same questions. A restore never touches the primary database.

## Non-goals

Scheduled backups, off-machine copies and encryption at rest (Phase 8). The final-schema/hybrid-query restore check (P2-9/P2-12), which re-runs this gate once `search_brain` exists. Splitting runtime and maintenance database roles in SQL (privilege work with the schema task #91); this tool already requires a separate maintenance credential.

## Commands

| Command                                      | Does                                                                                                                                                                |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm run db:backup`                         | `pg_dump --format=custom` of the primary database into `backups/`, plus a SHA-256 checksum and a manifest; prunes to the newest `AETHERION_BACKUP_KEEP` (default 7) |
| `pnpm run db:restore-verify [dump] [--keep]` | Verifies the checksum, restores into a **new** `aetherion_restore_<UTC stamp>` database, compares it with the manifest, then drops it unless `--keep`               |

Both run `pg_dump`/`pg_restore`/`psql` inside the Postgres container (`AETHERION_PG_CONTAINER`, default `aetherion-postgres-1`) with `docker exec`. The tools match the server version, the host needs no Postgres client, and the dump streams to the host over stdout/stdin. The password travels as `PGPASSWORD` in the exec environment, never in arguments or logs.

## Configuration (`.env`)

- `AETHERION_MAINTENANCE_DATABASE_URL` (required): a `postgres://` URL on a private host for a role that may create and drop databases. It is deliberately separate from `AETHERION_DATABASE_URL`; runtime processes never read it. Until the runtime role is narrowed (#91), both may name the same role.
- `AETHERION_PG_CONTAINER`, `AETHERION_BACKUP_DIR` (default `backups`, git-ignored), `AETHERION_BACKUP_KEEP` (default 7, range 1–90).

## Safety rules

1. **Private files.** `backups/` is created `0700`; dumps, checksums and manifests are `0600`. `backups/` is git-ignored. A dump contains private data once real notes exist; it never goes to CI artifacts or issues.
2. **Integrity first.** `restore-verify` refuses a dump whose SHA-256 does not match its `.sha256` file, before any database work.
3. **Never the primary.** The target name must match `^aetherion_restore_\d{8}t\d{6}z$`. It must differ from the primary and maintenance database names and **must not exist**. All three checks run before `create database`. An existing target is refused, never reused or overwritten.
4. **Manifest, not data.** The manifest holds only counts, IDs and versions:
   - row counts for documents, chunks, links, embedding versions, and both embedding tables;
   - the active embedding version and search-config pointer;
   - applied migration versions;
   - two deterministic probe results (chunk IDs from a full-text query and from a fixed-vector nearest-neighbour query on the active version).

   No note text is stored.

5. **Comparison.** The restored database must match every manifest field. The search config must point at an `active` version, and every probe must return the same chunk IDs in the same order. Any difference fails, with the field named.
6. **What is dumped and restored.** Only the application schemas (`public`, `supabase_migrations`). Supabase-owned schemas belong to the image. The new target gets the `vector` extension, and its empty `public` is replaced by the dump's. Default-privilege entries (`DEFAULT ACL`, which Supabase's `supabase_admin` sets on its own databases) are skipped at restore time, because the maintenance role cannot recreate them and the application does not depend on them. Table grants and RLS policies are restored. The filtered restore list is copied into the container with `docker cp`.
7. **Cleanup.** The restored database is dropped after verification, pass or fail, unless `--keep` is given for inspection.

## Verification (2026-10-18)

- **Integration tests (5/5, twice)** on a throwaway `pgvector/pgvector:0.8.7-pg17`, then again on the Supabase image. No leftover databases.
- **CLI flow on a throwaway Supabase `postgres:17.11.0.002` primary**, with the migration applied by `pnpm run db:migrate` and seeded synthetic rows: `db:backup` → `db:restore-verify` verified and dropped the target.
- **Bug found and fixed:** Supabase's own `postgres` database carries `supabase_admin` default privileges. Those blocked the first restore; fresh test databases cannot reproduce it. A unit test covers the list filter.
- **Note:** the Supabase CLI treats ports other than 54322 as remote and requires TLS. The project's `54322` works as is; other ports need `?sslmode=disable` on loopback.

## Runbook

**Take a backup:** `pnpm run db:backup`. Note the printed path and checksum.

**Prove a backup restores (do this before real-vault ingest, and after schema changes):** `pnpm run db:restore-verify` checks the newest backup; pass a path to check a specific one.

**Recover after data loss or a bad change:**

1. Stop the writers (`apps/worker`, ingestion).
2. Run `pnpm run db:restore-verify <dump> --keep` and inspect the restored `aetherion_restore_*` database.
3. Only after that, with explicit owner approval, point `AETHERION_DATABASE_URL` at the verified database, or rename it during a maintenance window.
4. Restart the processes and run `pnpm run doctor`.

The primary is never overwritten in place. The vault and repos stay the source of truth, so a full re-ingest is always an alternative.

**Retention:** the newest seven dumps by default. Older dumps and their checksums/manifests are deleted after a successful backup. Off-machine copies and schedules come in Phase 8.

## Acceptance tests

- Unit:
  - target-name rules (prefix, primary or maintenance name, injection-shaped names);
  - checksum mismatch;
  - manifest comparison naming each differing field;
  - retention selection;
  - URL parsing that keeps the password out of the arguments.
- Integration (`pnpm test:int`, CI pgvector service; locally a throwaway container), on a migrated synthetic database with documents, chunks, links, an active 1024 version and vectors:
  - backup → restore-verify passes and drops the restored database;
  - a tampered dump is refused before any database is created;
  - an existing target and the primary name are refused with zero writes;
  - a restored database that drifts from the manifest fails with the field named;
  - files have private permissions.
