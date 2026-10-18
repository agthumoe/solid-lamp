# Inference RPC and `InferenceClient`

Issue: [#60](https://github.com/agthumoe/solid-lamp/issues/60). Status: implemented. Parent: #3. Contracts: [ADR 0005](../adr/0005-phase1-stack-and-topology.md) (separate `inference` process, loopback 4100, shared secret), [LlmGate](llm-gate.md), [Ollama adapter](inference-ollama-adapter.md), [AI orchestration](../development/ai-orchestration.md#llmgate-client-interface-packagesllm).

## Goal

`api` and `worker` reach the GPU only through `apps/inference`. That process owns the single `LlmGate` and the Ollama adapter, and it exposes a small authenticated loopback RPC. `packages/llm` provides the matching `InferenceClient` and a fake for tests.

## Non-goals

Public API, owner auth, SSE to the browser (`apps/api`), fallbacks, residency restore policy, service units (Phase 8).

## Process and configuration

`pnpm dev:inference` runs `apps/inference/src/main.ts`, which:

1. Validates the environment once: the shared keys, plus `AETHERION_INFERENCE_SECRET` (32–256 characters), `AETHERION_INFERENCE_HOST` (loopback or Tailscale; default `127.0.0.1`) and `AETHERION_INFERENCE_PORT` (1024–65535; default 4100). Errors name keys, never values.
2. Loads `models.yaml` and composes one gate, one adapter and residency metrics (`composition.ts`).
3. Binds the configured private host.

On SIGTERM it stops intake and drains in-flight requests, bounded at 10 s. Fastify's request logger is off; the safe shared logger records `http.request` (status, duration, request ID) and `inference.job` (role, queue wait, duration, error code) without content.

## Routes (`packages/llm` `rpc/contract.ts`)

All routes except `/livez` require `x-aetherion-inference-key`. The key is compared in constant time through SHA-256 digests. Bodies are strict zod objects; callers name a **role**, never a model tag. `deadline` is an absolute ISO time at most 15 minutes ahead; `priority` is `interactive` or `background`.

| Route               | Body                                                   | Success                                                                   |
| ------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------- |
| `POST /v1/generate` | role, messages (≤256), tools (≤64), think, call fields | `{ text, model, done }`                                                   |
| `POST /v1/stream`   | same                                                   | NDJSON `StreamEvent`s: `started`, `token`…, exactly one `done` or `error` |
| `POST /v1/embed`    | texts (≤256), `query` or `document`, call fields       | `{ vectors, model: { model, numCtx, dimensions }, tokensIn, totalMs }`    |
| `GET /readyz`       | —                                                      | 200 ready / 503 not ready; Ollama state, gate and residency counters      |
| `GET /livez`        | —                                                      | `{ status: 'ok' }`                                                        |

Errors use `{ error: { code, message } }`: `QUEUE_FULL` 429, `DEADLINE_EXPIRED` 504, `CANCELLED` 499, `INFERENCE_UNAVAILABLE`/`MODEL_NOT_LOADED` 503, `INVALID_RESPONSE` 502, `VALIDATION_FAILED` 400 (field paths only), `UNAUTHENTICATED` 401, `NOT_FOUND` 404 and `INTERNAL` 500 (no stack). On `/v1/stream`, failures (including `QUEUE_FULL`) are the terminal `error` event inside a 200 response, matching the in-process streaming contract.

## Gate wiring (`gate/inference-service.ts`)

- Generation goes through `scheduleGeneration`, so the role snapshot is taken at enqueue. `started` carries the resolved model and the queue wait.
- Tokens are forwarded as they arrive. The terminal event is emitted only after the gate settles, so it always agrees with the gate: a deadline that passes at settlement turns `done` into `DEADLINE_EXPIRED`.
- `partial` is true once any token was sent.
- Each job observes `/api/ps` before and after it runs and records the residency change.
- A client disconnect aborts the request's signal. Queued work is removed; active work is aborted and torn down before the slot is released.
- Embedding snapshots the embed role at enqueue, so a config reload cannot change the vector space of queued work.

## Client (`packages/llm` `createInferenceClient`)

- Refuses non-private URLs.
- Sends the key, priority, ISO deadline and optional `runId`.
- Stops waiting 2 s after the deadline.
- Maps envelopes to `InferenceError`. A `VALIDATION_FAILED` response throws, because it is a caller bug. Auth, not-found and internal errors become `INFERENCE_UNAVAILABLE`.
- Streams validate every event, stop at the first invalid one, and always end with exactly one terminal event; a stream without one is `INVALID_RESPONSE`.
- `@aetherion/llm/testing` exports `createFakeInferenceClient`. It honours cancellation, expired deadlines, scripted errors and dimensions, and never calls a model.

## Decisions

The internal stream uses NDJSON rather than SSE: it is a process-to-process stream with no browser reconnect semantics. `@fastify/sse` remains the plan for `apps/api` → `web`.

## Acceptance

- **Contract tests (`server.inject`):** liveness without a key, readiness behind the key and 503 when Ollama is down, 401 without reaching the gate, generate shape and `think` pass-through, 400s that echo no values (unknown role, model tag, empty messages, bad deadline, malformed JSON), a deadline beyond the limit, 503/504 mappings, 429 while admitted work completes, NDJSON framing, embed shape and kind validation, 404 envelope, content-free logs.
- **Service tests:** event order and residency recording, unbound role, `QUEUE_FULL`, partial failure, a deadline at settlement, cancellation, a failed observation, embed snapshot across a config reload, embed failures.
- **Client:** request shape, private URL guard, no request when expired or aborted, envelope mapping, contract-breaking bodies, invalid or unterminated streams. Fake client behaviour.
- **Loopback round trip:** real client against the real server for generate, stream and embed; wrong secret; rejected shape; mid-stream cancellation that frees the gate; unreachable service.
- **Manual:** a local run against Ollama (not CI) streamed a real chat answer and an embedding through the server on 127.0.0.1.

`pnpm check` passes.
