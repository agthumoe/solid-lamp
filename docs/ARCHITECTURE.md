# Aetherion OS — system architecture

Status: **design baseline for Phase 1** ([#49](https://github.com/agthumoe/solid-lamp/issues/49)); nothing here is implemented yet. Decisions: [ADR 0001](adr/0001-ollama-location.md) (Ollama in WSL), [0002](adr/0002-embedding-versions.md) (versioned embeddings), [0003](adr/0003-development-architecture.md) (modular monolith, boundaries), [0004](adr/0004-domain-model-routing.md) (retained models, bounded domain routing), [0005](adr/0005-phase1-stack-and-topology.md) (Phase 1 stack and process topology). Requirements: [BUILD_PROMPT](BUILD_PROMPT.md). Code layout: [structure](development/structure.md). AI layer: [AI orchestration](development/ai-orchestration.md).

This document describes the target shape and the rules that keep it coherent. When code and this document disagree, fix one of them in the same PR.

## 1. Context

One owner, one home machine (AETHERION: Windows + WSL2 "Pengwin", RTX 3060 12 GB). Everything runs locally; the only remote access is the owner's own devices over Tailscale.

```text
                 Owner (browser / phone, via Tailscale)          Owner's WhatsApp
                              │                                         │
                              ▼                                         ▼
 ┌───────────────────────────────── AETHERION (WSL2) ──────────────────────────────────┐
 │  web ──REST/SSE──► api ──► agents (in-process) ──RPC──► inference ──► Ollama (GPU)    │
 │                     │  ▲                                   ▲                          │
 │                     │  └──── Redis (queues, pub/sub) ◄──── worker ◄── schedules/events │
 │                     ▼                                       │                          │
 │                Postgres (Supabase local: state, vectors, checkpoints, audit)           │
 │  channels (WhatsApp adapter) ──► api        mcp (brain/tasks/... read tools) ──► api   │
 │  Read-only sources: Obsidian vault, code repos, CSV drop folder, Gmail (read-only)    │
 └──────────────────────────────────────────────────────────────────────────────────────┘
```

Hard constraints (from AGENTS): local-only inference, read-only by default with approvals for side effects, private network binding, TypeScript everywhere, untrusted content is data.

## 2. Processes

A **modular monolith with several process entry points** (ADR 0003). Features live in one codebase; each process wires only the features it serves. Processes communicate through Postgres, Redis and two narrow HTTP contracts (public API, internal inference RPC). They never import each other's source.

| Process (`apps/*`) | Responsibility                                                                                      | Listens on (loopback)            | Talks to                                 |
| ------------------ | --------------------------------------------------------------------------------------------------- | -------------------------------- | ---------------------------------------- |
| `web`              | Next.js dashboard: chat, approvals, brain, graph, runs, settings                                    | `127.0.0.1:3000`                 | `api` only (REST + SSE)                  |
| `api`              | Public `/api/v1` contract, auth, SSE, run orchestration (agents run in-process), approval decisions | `127.0.0.1:4000`                 | Postgres, Redis, `inference`             |
| `inference`        | **The single LlmGate scheduling authority**: queues, priorities, residency, Ollama calls            | `127.0.0.1:4100` (internal only) | Ollama `127.0.0.1:11434`                 |
| `worker`           | BullMQ consumers: ingestion, scheduled agent runs, outbox dispatch, notifications, backups          | health only `127.0.0.1:4400`     | Postgres, Redis, `inference`, filesystem |
| `channels`         | WhatsApp adapter(s); allowlisted owner number only                                                  | health only `127.0.0.1:4300`     | `api` (as a client), Redis               |
| `mcp`              | MCP servers (brain, tasks, finance, repos, email); stdio and streamable HTTP; read tools only       | `127.0.0.1:4200` (HTTP)          | `api` (as an authenticated client)       |

Backing services: Postgres via Supabase local (`127.0.0.1:54322`, API `54321`), Redis (`127.0.0.1:6379`, Docker), Ollama (`127.0.0.1:11434`, systemd). Remote access is `tailscale serve` in front of `web` and `api` only. `inference`, Postgres, Redis and Ollama are never exposed.

**Why a separate `inference` process.** The GPU allows one generation at a time, and both `api` (interactive) and `worker` (background) need it. A per-process mutex can't order requests across processes, so one process owns the queue ([LlmGate spec](specs/llm-gate.md), [scheduling contract](workstreams/codex/scheduling-contract.md)). If `inference` is down, inference fails fast with `EMBEDDING_UNAVAILABLE`/unavailable errors; nothing falls back to a second scheduler.

## 3. Package dependency graph

```text
apps/web ───────────────► packages/shared (contracts only; browser-safe subset)
apps/api ─┬─► packages/agents ─┬─► packages/llm (client side of inference RPC)
          │                    ├─► packages/brain ─► packages/db
          │                    └─► packages/shared
          ├─► packages/db ─────────► packages/shared
          └─► packages/shared
apps/inference ─► packages/llm (gate + Ollama adapter) ─► packages/shared
apps/worker ─► packages/brain, packages/agents, packages/llm, packages/db, packages/shared
apps/channels, apps/mcp ─► packages/shared (+ typed api client)
packages/evals ─► packages/agents, packages/llm, packages/shared (dev only)
```

Rules: arrows point toward more stable code. `packages/shared` depends on nothing internal. No package imports an app. No cycles. `web` never imports server packages (`db`, `llm`, `agents`, `brain`). Enforced by package `exports` maps plus the existing AST boundary checks; details in [structure](development/structure.md#import-rules).

## 4. Data stores and ownership

| Store                  | Owns                                                                                                                                                                                         | Notes                                                                                 |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Postgres               | Sources, documents, chunks, versioned embeddings (ADR 0002), links, threads/messages, runs/steps, approvals, audit, outbox, memories, tasks, finance, email summaries, LangGraph checkpoints | One migration history in `supabase/migrations/` ([database](development/database.md)) |
| Redis                  | BullMQ queues, delayed jobs, SSE fan-out pub/sub, rate-limit counters                                                                                                                        | Disposable: anything durable is in Postgres first (outbox)                            |
| Filesystem (read-only) | Obsidian vault, repos, CSV drop folder                                                                                                                                                       | Writes only to vault `AI-Inbox/` after approval                                       |
| Filesystem (app-owned) | Backups, logs (rotated externally), local debug traces (opt-in)                                                                                                                              | Never committed                                                                       |
| `config/`              | Model roles, agent definitions, schedules                                                                                                                                                    | Validated at startup; secrets only in `.env`                                          |

## 5. Core flows

### 5.1 Interactive chat (streamed, cited)

1. `web` POSTs `/api/v1/runs` `{ threadId, agent?, message }`; `api` authenticates, validates, persists the user message and a `runs` row, returns `{ runId }`.
2. `web` opens `GET /api/v1/runs/:runId/events` (SSE).
3. `api` resolves the agent: an explicit owner selection wins; otherwise the router proposes and deterministic policy validates ([routing contract](workstreams/codex/routing-contract.md)).
4. The agent graph runs in `api` with a PostgresSaver checkpoint (`thread_id` = run ID). Retrieval nodes query `brain` with a pinned vector version; generation nodes call `inference` with `priority: interactive`, the role and a deadline.
5. `inference` streams tokens; `api` forwards typed SSE events (`token`, `step`, `citation`, `done`, `error`) with sequence numbers, persisting `run_steps` as it goes.
6. On completion the run and assistant message are committed. `web` reconciles TanStack Query state from the REST resource.

### 5.2 Side effect with approval

1. A graph node proposes a side-effect tool call. The tool executor validates arguments (zod, allowlist), computes a payload hash and calls LangGraph `interrupt()`.
2. In one transaction: `approvals` row (pending, expiry, payload hash, run/checkpoint reference) + `audit_log` + `outbox` row (`notify.approval_requested`).
3. `worker` dispatches the outbox row: dashboard SSE and WhatsApp notification to the owner.
4. Owner approves or rejects (dashboard or `/approve <id>`). `api` performs a conditional single-use transition (pending → approved/rejected), verifying owner, expiry and payload hash.
5. Approved: the graph resumes from its checkpoint; the executor dispatches once with the idempotency key and records the outcome. Rejected or expired: the graph resumes with a rejection result; nothing executes.

### 5.3 Ingestion

Watcher or resync command → `events` row → BullMQ `ingest.document` job → parse, chunk (heading-aware, content hash) → `inference` embed (`priority: background`, bounded batches) → write into the **building** embedding version → catch-up → evals → atomic promotion (ADR 0002). Searches never mix versions.

### 5.4 Scheduled and event-driven agents

Cron (`config/schedules.yaml`, America/Chicago) or an event → `events` row → BullMQ job → `worker` runs the agent graph with `priority: background` → result stored → notification policy (quiet hours, digest, dedup, daily cap) decides whether to message the owner.

### 5.5 Retrieval

Embed the query with the **active** version's model and query prefix → hybrid search (pgvector cosine + Postgres FTS, merged with reciprocal rank fusion) filtered by source/tags/path → chunks with document, heading path and citation locator → relevance threshold → "don't know" if nothing passes.

## 6. Trust boundaries

| Boundary                   | Control                                                                                                  |
| -------------------------- | -------------------------------------------------------------------------------------------------------- |
| Network                    | Loopback binds; Tailscale serve for `web`/`api` only; no `0.0.0.0` (enforced by source policy)           |
| Owner identity             | Session auth (passkey or password + TOTP) on every API route including SSE; CSRF for cookie mutations    |
| Internal RPC (`inference`) | Loopback + shared secret header from `.env`; not reachable via Tailscale                                 |
| Untrusted content          | Retrieved text, emails, files, tool output are delimited data; they can't select agents, tools or models |
| Side effects               | Approval queue with payload hash, single-use decision, idempotent dispatch, audit                        |
| Secrets                    | `.env` only; never in config YAML, logs, browser bundles, URLs or checkpoints                            |

## 7. Failure and recovery

- Process crash: durable state is in Postgres; BullMQ retries with backoff; graphs resume from checkpoints; `inference` restart marks in-flight work interrupted and reconciles loaded models before admitting new work.
- Ollama or GPU unavailable: requests fail with typed unavailable errors; accepted fallbacks only where configured, disclosed and before output starts.
- Redis loss: queues rebuild from the outbox and `events` tables.
- Database: nightly `pg_dump` with rotation; restore is verified in an isolated database before use; the vault and repos remain the source of truth for re-ingestion.

## 8. Observability

Pino JSON logs with correlation IDs (`requestId`, `runId`, `jobId`, `stepId`, `approvalId`); no private content in logs ([operations](development/operations.md)). Run and step records in Postgres power the dashboard's run replay. `inference` exposes queue depth/age, wait time, load/prefill/decode timings and residency, cross-checked with `nvidia-smi`.

## 9. Phase mapping

| Phase | Builds                                                                                                                              |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------- |
| 1     | Monorepo, `packages/shared`/`db`/`llm`, `apps/inference` (LlmGate), `apps/api` skeleton with `/health`, migrations, Redis, `doctor` |
| 2     | `packages/brain`, ingestion jobs in `worker`, retrieval, `mcp` brain server, backup/restore                                         |
| 3     | `packages/agents`, supervisor, approvals, SSE runs                                                                                  |
| 4–5   | `apps/web` dashboard, graph and workflow views                                                                                      |
| 6     | Scheduler/events in `worker`, `apps/channels`, notification policy                                                                  |
| 7     | Domain agents                                                                                                                       |
| 8     | Hardening, service units, final review of this document                                                                             |
