# Inference RPC and `InferenceClient`

Issue: [#60](https://github.com/agthumoe/solid-lamp/issues/60). Status: implemented; version-bound embedding profiles added by [#94](https://github.com/agthumoe/solid-lamp/issues/94) ([ADR 0006](../adr/0006-brain-version-bound-retrieval.md)). Parent: #3. Contracts: [ADR 0005](../adr/0005-phase1-stack-and-topology.md) (separate `inference` process, loopback 4100, shared secret), [LlmGate](llm-gate.md), [Ollama adapter](inference-ollama-adapter.md), [AI orchestration](../development/ai-orchestration.md#llmgate-client-interface-packagesllm).

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

| Route                    | Body                                                                   | Success                                                                                                    |
| ------------------------ | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `POST /v1/generate`      | role, messages (≤256), tools (≤64), think, call fields                 | `{ text, model, done }`                                                                                    |
| `POST /v1/stream`        | same                                                                   | NDJSON `StreamEvent`s: `started`, `token`…, exactly one `done` or `error`                                  |
| `POST /v1/embed`         | texts (≤256), `query` or `document`, optional `profileId`, call fields | `{ vectors, profile, model: { model, numCtx, dimensions }, tokensIn, totalMs }`                            |
| `GET /v1/embed-profiles` | —                                                                      | `{ defaultProfileId, profiles: [{ id, model, digest, dimensions, numCtx, queryPrefix, documentPrefix }] }` |
| `GET /readyz`            | —                                                                      | 200 ready / 503 not ready; Ollama state, gate and residency counters                                       |
| `GET /livez`             | —                                                                      | `{ status: 'ok' }`                                                                                         |

Errors use `{ error: { code, message } }`: `QUEUE_FULL` 429, `DEADLINE_EXPIRED` 504, `CANCELLED` 499, `INFERENCE_UNAVAILABLE`/`MODEL_NOT_LOADED` 503, `INVALID_RESPONSE` 502, `PROFILE_UNAVAILABLE` 409, `VALIDATION_FAILED` 400 (field paths only), `UNAUTHENTICATED` 401, `NOT_FOUND` 404 and `INTERNAL` 500 (no stack). On `/v1/stream`, failures (including `QUEUE_FULL`) are the terminal `error` event inside a 200 response, matching the in-process streaming contract.

## Gate wiring (`gate/inference-service.ts`)

- Generation goes through `scheduleGeneration`, so the role snapshot is taken at enqueue. `started` carries the resolved model and the queue wait.
- Tokens are forwarded as they arrive. The terminal event is emitted only after the gate settles, so it always agrees with the gate: a deadline that passes at settlement turns `done` into `DEADLINE_EXPIRED`.
- `partial` is true once any token was sent.
- Each job observes `/api/ps` before and after it runs and records the residency change.
- A client disconnect aborts the request's signal. Queued work is removed; active work is aborted and torn down before the slot is released.
- Embedding snapshots a **profile** at enqueue, so neither a config reload nor a re-pulled model can change the vector space of queued work (see below).

## Embedding profiles (ADR 0006, #94)

- **Registry (`gate/profile-registry.ts`).** Approved profiles come only from operator-controlled `models.yaml` (the `embed` role, then each `fallback_embedding_options` entry) combined with the artifact digests Ollama reports in `/api/tags`. A configured model that is not installed is not approved; an installed model that is not configured never becomes a profile. Callers cannot register profiles or send model tags or prefixes.
- **Identity.** `profileId = "ep-" + first 24 hex of SHA-256([model, digest, dimensions, num_ctx, query prefix, document prefix])`. The same artifact and settings always give the same ID, and a re-pulled artifact or any setting change gives a new one. The `embed` role's profile is the default.
- **Pinned embedding.**
  - `/v1/embed` accepts an optional `profileId`. It is resolved and snapshotted when the call arrives; the config is read before any await.
  - Inside the gate job, the profile's digest is re-checked against `/api/tags` immediately before embedding. A profile that is unknown, not installed or replaced fails as `PROFILE_UNAVAILABLE` (409) and never embeds.
  - The response returns the `profile` actually used, so the worker and search can compare it with their stored version (`embedding_profiles`, #91) before storing or comparing vectors, including for same-dimension changes.
- **Listing.** `GET /v1/embed-profiles` (behind the key) lets the worker mirror approved profiles into `embedding_profiles`. `InferenceClient.embedProfiles(signal)` calls it, and the fake client supports scripted profiles.
- One GPU gate still serves every embedding. Fallback profiles are explicit version builds, never query-time failover.

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
