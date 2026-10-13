# Database, ORM and migrations

Decision: [ADR 0003](../adr/0003-development-architecture.md); vectors: [ADR 0002](../adr/0002-embedding-versions.md).

## Ownership and Drizzle

Postgres is the durable source of application state; Obsidian/repos remain the source of original documents. Drizzle handles typed parameterized queries in `packages/db` adapters, not UI or route handlers. Pure domain models and public DTOs are separate from database row types. Select explicit columns; avoid leaking internal tables/credentials into DTOs. Pass transaction-scoped executors explicitly; an adapter must not accidentally query the global client inside a transaction.

SQL invariants back application invariants: foreign keys, unique constraints, checks, explicit nullability, timestamps and decision/version indexes. Use text/discriminated states when appropriate; avoid opaque JSON for relational invariants. Account for deletion/retention and source hashes. Money is integer minor units or decimal with currency; never floating-point totals. Store timestamps with timezone; serialize UTC and schedule with America/Chicago/DST-aware rules. Use deterministic ordering and bounded queries; profile N+1 and indexes with realistic fixtures.

Use least-privilege service roles and pooled connections. Browser code has no database service credentials. Server authorization is explicit; RLS protects exposed Supabase access where enabled. Maintenance roles are separate from runtime roles. Raw SQL is permitted for vector/FTS/RRF and operations needing SQL fidelity; parameterize values and allowlist dynamic identifiers.

## One migration history

`supabase/migrations/<timestamp>_<name>.sql` is the sole ordered schema history. Drizzle schema mirrors it. Never run both Supabase and Drizzle migrators against the same database. `drizzle-kit generate` may create candidate SQL in a scratch location; review/adapt it into one canonical migration and update the typed schema. `drizzle-kit push` is forbidden on persistent databases. Do not edit applied migrations; ship a forward fix. Seeds are separate, repeatable and synthetic.

Migration workflow:

1. Create/link a GitHub issue; state the invariant, compatibility impact, lock/data volume and recovery strategy.
2. Update spec/ADR as needed; write SQL and Drizzle definitions together. Include indexes, constraints, privilege/RLS/function search_path changes explicitly.
3. Rebuild an empty isolated DB from the entire history; upgrade a representative old fixture. Test data preservation and schema/Drizzle parity, including custom functions/indexes not expressible in Drizzle.
4. Inspect DDL lock behavior; bound lock/statement timeout. For large changes use expand → resumable backfill → validate → contract in separate releases. `CREATE INDEX CONCURRENTLY` needs an explicit nontransactional step; do not put it inside a transaction blindly.
5. Before applying to persistent data, take/verify a backup and approve the concrete change. Apply via one explicit migration operator, never every app/worker startup. Record migration version and readiness expectations.
6. Verify constraints, queries, search/citations and restore plan. Destructive contract steps require a distinct approval and evidence that old code/data is no longer needed.

Production rollback is usually a forward repair; never label an irreversible down migration safe. Restore into an isolated DB and verify before switching. Backfill checkpoints/idempotency and version coverage must survive restart.

## Transactions and reliable work

Keep transactions short; no Ollama/HTTP/email calls while holding DB locks. Approval decision and audit/outbox rows commit atomically. Dispatch after commit with a durable idempotency key. Use conditional updates/version checks or locks to prevent approve/reject races. Bound retries for serialization/deadlock failures; retry the whole transaction only when safe. No generic retry of external side effects.

Embedding tables isolate dimensions and model versions; active-index promotion is atomic after coverage/catch-up/evals. Never pad/truncate vectors or use fallback embeddings against the primary index. Treat source edits/deletions and chunk hashes as part of eligibility.

Review checklist: history replays, upgrade works, typed schema matches, locks/timeouts reviewed, least privilege, parameterization, correct transaction scope, realistic query plans, and recovery verified. References: [Drizzle migrations](https://orm.drizzle.team/docs/migrations), [Supabase skill](../../.agents/skills/supabase-postgres-best-practices/SKILL.md), [Supabase migrations](https://supabase.com/docs/guides/deployment/database-migrations).
