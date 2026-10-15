# ADR 0005: Phase 1 library stack and process topology

Date: 2026-10-15. Status: **proposed** (review on [#49](https://github.com/agthumoe/solid-lamp/issues/49); becomes accepted when the Phase 1 scaffold installs these pins under [#3](https://github.com/agthumoe/solid-lamp/issues/3)).

## Context

Phase 1 scaffolds the monorepo, database, inference gateway and API. BUILD_PROMPT §3 names the stack families; ADR 0003 fixes a modular monolith with explicit boundaries; the [LlmGate spec](../specs/llm-gate.md) and [scheduling contract](../workstreams/codex/scheduling-contract.md) require one scheduling authority for a GPU that runs one generation at a time. Both interactive (`api`) and background (`worker`) work need that GPU.

## Decision

### Process topology

Six process entry points (`web`, `api`, `inference`, `worker`, `channels`, `mcp`), loopback ports 3000/4000/4100/4400/4300/4200, as described in [ARCHITECTURE §2](../ARCHITECTURE.md#2-processes). **`apps/inference` is a separate process and the only LlmGate**; `api` and `worker` call it over internal loopback HTTP with a shared-secret header. Agents run in-process inside `api` (interactive) and `worker` (scheduled).

### Libraries (candidate versions, checked with `npm view` on 2026-10-15)

| Concern      | Library                                                            | Candidate version                      |
| ------------ | ------------------------------------------------------------------ | -------------------------------------- |
| HTTP API     | `fastify`, `fastify-type-provider-zod`, `@fastify/sse`             | 5.12.7, 7.0.0, 0.6.1                   |
| Validation   | `zod` (already installed)                                          | 4.6.7                                  |
| Logging      | `pino` (already installed)                                         | 10.4.0                                 |
| DB access    | `drizzle-orm`, `drizzle-kit` (diff/introspect only), `postgres`    | 0.45.4, 0.31.11, 3.4.9                 |
| Queues       | `bullmq`, `ioredis`                                                | 6.3.15, 6.0.0                          |
| Agent graphs | `@langchain/langgraph`, `@langchain/langgraph-checkpoint-postgres` | 1.5.0, 1.1.0                           |
| MCP          | `@modelcontextprotocol/sdk`                                        | 1.32.1                                 |
| Frontend     | `next`, `react`, `tailwindcss`, `@tanstack/react-query`, `zustand` | 16.4.1, 19.3.1, 4.3.3, 5.104.2, 5.0.15 |
| Tests        | `vitest`, `@playwright/test`                                       | 5.0.4, 1.64.1                          |

Rules: install exact versions (no ranges) in the PR that first uses each library; run `pnpm check` and that package's tests; record any version change in this ADR's table. Each library is added in the phase that needs it (frontend in Phase 4, MCP in Phase 2), not all at once.

## Alternatives considered

- **Gate inside `api` only, worker calls `api`:** couples background ingestion to the public API's lifecycle and auth surface; restarts of `api` would stall ingestion. Rejected.
- **Redis-based distributed lock instead of a gate process:** a lock gives exclusion but not priority ordering, residency decisions or queue metrics. Rejected.
- **tRPC instead of Fastify + zod contracts:** couples web and api builds and weakens the plain HTTP/SSE contract used by channels and MCP. Rejected.
- **Prisma instead of Drizzle:** BUILD_PROMPT names Drizzle; Drizzle's SQL-first model fits the Supabase migration ledger ([database](../development/database.md)).
- **Jest instead of Vitest:** Vitest runs native ESM TypeScript without a transform config; Phase 0 scripts keep `node:test`.

## Consequences

- **Good:** one GPU queue with interactive priority across processes; clear ownership; each library has a documented home.
- **Bad:** one more process to supervise and an internal RPC contract to version; if `inference` is down, all model work fails fast (by design, no second scheduler).
- **Revisit if:** the GPU changes to allow parallel generation, or LangGraph's checkpointer can't meet the replay requirements in [AI orchestration](../development/ai-orchestration.md).
