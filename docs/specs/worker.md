# `apps/worker` skeleton

Issue: [#92](https://github.com/agthumoe/solid-lamp/issues/92) (P2-6). Status: implemented (skeleton). Parent: [#4](https://github.com/agthumoe/solid-lamp/issues/4). Contracts: [ARCHITECTURE §2 and §5.3](../ARCHITECTURE.md), [ADR 0005](../adr/0005-phase1-stack-and-topology.md), [operations](../development/operations.md), the [BullMQ job template](../development/templates/bullmq-job.md). Plan: `docs/specs/brain.md` task 6 and review finding F5 ([PR #85](https://github.com/agthumoe/solid-lamp/pull/85)).

## Goal

A background process that runs ingestion jobs reliably: typed, reference-only payloads; deterministic job IDs; bounded retries; a clean drain on SIGTERM; and a relay that moves durable pending events from Postgres into the queue. Redis stays disposable.

## Non-goals (follow-ups)

- Real handler bodies (read → parse → chunk → publish with expected-revision checks). They need parsing/chunking (#89, #90) and the schema (#91, blocked on ADR 0006). Until then, handlers report `NOT_WIRED`, a permanent failure, and nothing enqueues jobs.
- The Postgres pending-event store, which arrives with #91's `ingest_events` table.
- The watcher (#93), embedding jobs (#94) and backups scheduling (Phase 8).

## Shape

`main.ts` → `composition.ts` → `runtime.ts` (BullMQ worker and queue, drain) and `health.ts` (`node:http` on `127.0.0.1:4400`).

- **`jobs/contracts.ts`:** queue `ingest`; jobs `ingest.document` `{ sourceId, path, revision }` and `ingest.resync` `{ sourceId, scanId }`. Payloads are strict zod objects holding IDs, a normalized source-relative path and a SHA-256 revision, never note text. `path` is source-relative, so a pending job can always be reconstructed from Postgres after a Redis loss (F5).
- **`jobs/job-id.ts`:** deterministic, colon-free job IDs, from the tested template. A document job's identity is source + path + revision, so a newer revision is a new job and the same revision is deduplicated.
- **`jobs/processor.ts`:** validates the payload (an invalid one is permanent and never retried) and maps a handler `Result` to BullMQ. `RETRYABLE` throws for a retry with exponential backoff (5 attempts, 1 s base). `PERMANENT` and `NOT_WIRED` throw `UnrecoverableError`. Completed jobs are kept for 1 hour or 1,000 jobs, failed jobs for 7 days.
- **`dispatch/pending-events.ts`:** `relayPendingEvents(store, enqueue)` claims pending events, enqueues each with its deterministic ID, and marks only the enqueued ones dispatched. A crash between enqueue and mark re-sends the same job ID, which BullMQ deduplicates while the job exists and handlers tolerate (idempotent by revision). An in-memory store implements the port contract for tests; the Postgres store comes with #91.
- **Drain:** on SIGTERM the health server stops, the worker stops taking jobs and waits for active jobs (bounded by a grace period), then Redis closes.

## Configuration

Shared env keys, plus:

- `AETHERION_REDIS_URL` (default `redis://127.0.0.1:6379`; a private host only, credentials allowed but never logged);
- `AETHERION_WORKER_HOST` (default `127.0.0.1`; loopback or Tailscale);
- `AETHERION_WORKER_PORT` (default 4400);
- `AETHERION_WORKER_CONCURRENCY` (default 1, maximum 8). GPU work is serialized by the inference gate anyway.

## Health

`GET /livez` returns `{ status: 'ok' }`. `GET /readyz` returns 200 or 503 with Redis `ok`/`unavailable` and queue counts (waiting, active, delayed, failed). Responses carry no payloads, paths or URLs.

## Acceptance tests

- **Unit:** config (defaults, private Redis host, ports, concurrency); payload contracts reject absolute paths, `..`, NUL, non-hex revisions and unknown keys; job IDs are deterministic and colon-free, change with revision and are equal for equivalent paths; the processor maps invalid, retryable, permanent, not-wired and ok outcomes; the relay marks only enqueued events, survives an enqueue failure and is idempotent on re-run; health with fake probes.
- **Integration** (`pnpm test:int`, real Redis; a CI service and a local throwaway container):
  - a job reaches its handler;
  - a retryable failure retries, then succeeds;
  - a permanent failure is not retried;
  - a duplicate deterministic ID is not processed twice;
  - `close()` waits for an active job to finish.
