# Local Supabase Postgres

Issue: [#75](https://github.com/agthumoe/solid-lamp/issues/75). Status: implemented. Parent: #3. Contracts: [database](../development/database.md) (one migration history, one operator), [security/recovery](security-recovery.md) (container ports on 127.0.0.1), [brain schema](brain-schema.md).

## Goal

Run Supabase's own Postgres locally on loopback only, and apply `supabase/migrations` with the pinned Supabase CLI as the single migration operator.

## Finding: `supabase start` exposes every interface

With Supabase CLI 2.119.0 on Docker Desktop 29.6.2, `supabase start` published Postgres (`54322`) and Kong (`54321`) on `0.0.0.0`/`::`. Kong started even with `[api] enabled = false`. The CLI has no bind-address setting, and Docker Desktop also forwards published ports on the Windows side. That violates AGENTS hard constraint 3, so it was stopped immediately and is not used. `supabase/config.toml` says so at the top. If someone runs it anyway, `pnpm doctor` reports the wildcard bind as a failure.

## Shape

- **`infra/docker-compose.yml` `postgres`:** `public.ecr.aws/supabase/postgres:17.11.0.002` pinned by digest (pgvector bundled), published `127.0.0.1:54322:5432`, a named volume and a `pg_isready` healthcheck. `POSTGRES_PASSWORD` comes from `AETHERION_POSTGRES_PASSWORD` in `.env`; compose refuses to start without it. The compose policy in `pnpm compliance:check` covers it.
- **`supabase/config.toml`:** from `supabase init`. Project `aetherion`; API, Studio, Auth, Realtime, Storage, Edge runtime, Analytics and the SMTP catcher disabled; seeding off until synthetic seeds exist.
- **`pnpm db:start` / `db:stop`:** `docker compose --env-file .env … up -d --wait` / `stop`. These need the compose plugin; doctor warns when WSL integration has not provided it.
- **`pnpm db:migrate` / `db:status`:** `scripts/db/supabase-cli.ts` runs `supabase migration up|list --db-url <url without password>`. The password goes in `PGPASSWORD`, never in process arguments, and `SUPABASE_TELEMETRY_DISABLED=1` and `DO_NOT_TRACK=1` are set on every call. Migrations are recorded in Supabase's own ledger (`supabase_migrations.schema_migrations`).
- **Supabase CLI 2.119.0:** exact-pinned dev dependency (published 2026-09-30).

## Verification (2026-10-18, local)

| Check                                                           | Result                                                                 |
| --------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Supabase Postgres from compose                                  | healthy, `127.0.0.1:54322` only                                        |
| `pnpm db:status` → `db:migrate` → `db:status`                   | `20261018120000` pending → applied → listed local = remote             |
| `pnpm test:int` against Supabase Postgres                       | 9/9 pass (replay, invariants, Drizzle parity, RLS)                     |
| `GET /api/v1/health/ready` (api + inference, real database URL) | 200 `ready`: database, inference and Ollama all `ok`                   |
| `pnpm doctor`                                                   | 22 ok, 0 warnings, 0 failures (with the secret set in the environment) |
| Logs                                                            | no database password in api/inference logs                             |

Verification used a throwaway compose project (`aetherion-verify`) with an ephemeral password that existed only in the session. It was removed afterwards, leaving the real `aetherion` Postgres volume uncreated for the owner's own password. The volume from the stopped `supabase start` attempt was deleted.

## Notes

- Telemetry: Supabase CLI telemetry was on (the CLI default) for the `init`, `start`, `stop` and early `--version`/`--help` calls in this session, before the opt-out was found. All scripted calls now disable it. `supabase telemetry disable` would also persist the opt-out in the user's home directory, which is an owner choice.
- Unrelated: a `literate-dollop_postgres_1` container from another project publishes `0.0.0.0:5432` on this host. It is not part of Aetherion and was left alone.

## Acceptance

`supabase migration up` applies the history on Supabase Postgres; the integration tests pass there; no Aetherion port listens on a wildcard address; doctor is green; unit tests cover the CLI wrapper (password moved out of arguments, telemetry off, URL refusal) and the compose-plugin doctor check. `pnpm check` passes.
