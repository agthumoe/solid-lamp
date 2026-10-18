# `apps/api` skeleton and health

Issue: [#61](https://github.com/agthumoe/solid-lamp/issues/61). Status: implemented. Parent: #3. Contracts: [architecture and API](../development/architecture-api.md) (error envelope, liveness vs readiness), [operations](../development/operations.md), [ADR 0005](../adr/0005-phase1-stack-and-topology.md), [inference RPC](inference-rpc.md).

## Goal

A public API process on `127.0.0.1:4000` that later phases extend feature by feature. For now it only answers liveness and readiness, which report the database, the inference process and Ollama.

## Non-goals

Owner auth, CSRF/CORS, SSE, runs and approvals (Phase 3); migrations or ingestion at startup; Drizzle (`packages/db`, which waits on Docker/Supabase).

## Shape

`main.ts` (config, logger, listen, SIGTERM drain) → `composition.ts` (postgres client and inference client constructed once) → `server.ts` `buildServer(deps)` (no I/O at import) → `plugins/error-envelope.ts` → `features/health/{application,infrastructure,transport}`.

- **Config:** shared keys, plus:
  - `AETHERION_API_HOST`: loopback or Tailscale; default `127.0.0.1`.
  - `AETHERION_API_PORT`: default 4000.
  - `AETHERION_DATABASE_URL`: optional, `postgres(ql)://` on a private host.
  - `AETHERION_INFERENCE_URL`: private; default `http://127.0.0.1:4100`.
  - `AETHERION_INFERENCE_SECRET`: required.

  Errors name keys, never values, because the database URL and secret are credentials.

- **Errors:** every failure uses the shared `{ error: { code, message, requestId } }` envelope.
  - Schema failures are `VALIDATION_FAILED` with field paths only.
  - Unknown routes are `NOT_FOUND`.
  - Unexpected errors are a generic `UNAVAILABLE` 503, with no stack or internal message.
  - Request IDs are server-generated (inbound `x-request-id` is ignored) and returned in the `x-request-id` response header.
- **Logs:** Fastify's request logger is off. `http.request` (status, duration, request ID) and `http.unhandled` go through the safe shared logger.

## Routes

| Route                      | Behaviour                                                                                                                                                                          |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/v1/health`       | Liveness: `{ status: 'ok' }`; touches no dependency                                                                                                                                |
| `GET /api/v1/health/ready` | 200 `ready` / 503 `not_ready` with `checks.database`, `checks.inference`, `checks.ollama` each `ok`, `unavailable` or `not_configured`. Probes run in parallel under a 2 s cut-off |

The database probe runs `select 1`. Without a URL it reports `not_configured`, so the API starts while Supabase is not running. The inference probe calls the inference process's `/readyz` with the shared key; Ollama is never reached directly. Responses carry statuses only: no versions, URLs, counters or error text. Readiness becomes owner-authenticated when the Phase 3 auth plugin exists.

## Acceptance

Unit and contract tests cover:

- Readiness aggregation: all-ok, each degraded combination, and a hung probe cut off by the timeout.
- Inference probe mapping, and a real `postgres` driver against a refused loopback port (`unavailable`), without Docker.
- Liveness without probes, readiness at 200 and 503, a 404 envelope with a server request ID that ignores the inbound header, a 400 for a malformed body, and a generic 503 for a thrown error with no internals in the body or logs.
- Config defaults, Postgres URL rules and rejected hosts.

A local run (2026-10-18, not CI) reported `not_configured`, then `unavailable` with Docker stopped, then all `unavailable` after stopping inference. `pnpm check` passes.
