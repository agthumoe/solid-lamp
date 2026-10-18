# `apps/inference` Ollama adapter

Issue: [#59](https://github.com/agthumoe/solid-lamp/issues/59). Status: implemented. Parent: #3. Contracts: [LlmGate](llm-gate.md), [scheduling contract](../workstreams/codex/scheduling-contract.md), [AI orchestration](../development/ai-orchestration.md#llmgate-client-interface-packagesllm), [`packages/llm` core](llm-package.md).

## Goal

Ollama's native HTTP API is used by exactly one module. It runs gate jobs from a role snapshot and the gate's job signal, and reports typed failures, token/latency timings and observed residency.

## Non-goals

RPC server, auth, process entry and gate wiring ([#60](https://github.com/agthumoe/solid-lamp/issues/60)); fallbacks; GPU memory cross-checks with `nvidia-smi` (doctor); model pulls or deletion.

## Contracts

- `createOllamaAdapter({ baseUrl, fetch?, retry?, sleep? })` refuses a non-private URL (`RangeError`). `fetch` and `sleep` are injected so tests have no network or timers.
- **Requests** state `num_ctx`, every configured sampling option and `think` (role default, per-request override) explicitly; Modelfile defaults are never relied on. `keep_alive` is left to the server (`OLLAMA_KEEP_ALIVE`); residency is a policy, not a request flag.
- **`stream(snapshot, request, signal)`** yields `token` events and exactly one terminal `done` (finish reason, tokens in/out, native tool calls, load/prompt/eval/total ms) or `error` with `partial`. The gate wiring adds `started` with queue time. Thinking text is not emitted. Native tool calls are returned raw; callers validate them with `validateToolCall`.
- **`generate`** collects the same stream into `Result<StreamOutcome, InferenceError>`.
- **`embed(snapshot, texts, 'query' | 'document', signal)`** applies the matching prefix (queries only get the query prefix), sends `truncate: false` so an over-long input fails instead of silently shortening, and rejects count, dimension and non-finite mismatches as `INVALID_RESPONSE`. More than 256 texts is a programmer error; batching is `embedInBatches`.
- **`loaded(signal)`** reads `/api/ps` into canonical `name:tag` entries with context length. `classifyLoad` predicts `warm`, `cold` or `context_reload` (same weights, different `num_ctx`, or unknown loaded context); `compareResidency(before, after, target)` reports observed evictions and whether the target is resident with its context afterwards; `createResidencyMetrics` counts them. There is no residency cache: callers observe before and after each job, so a config change can never leave a stale cache behind.

## Errors and retries

| Condition                                  | Code                    | Retried                             |
| ------------------------------------------ | ----------------------- | ----------------------------------- |
| Network failure, HTTP 5xx, dropped stream  | `INFERENCE_UNAVAILABLE` | Once, only before the first token   |
| In-stream `error` line                     | `INFERENCE_UNAVAILABLE` | Only if no token was emitted        |
| HTTP 404                                   | `MODEL_NOT_LOADED`      | No                                  |
| Other HTTP 4xx, malformed/oversized NDJSON | `INVALID_RESPONSE`      | No                                  |
| Schema violation, stream without `done`    | `INVALID_RESPONSE`      | No                                  |
| Gate abort                                 | the gate's reason       | No (`DEADLINE_EXPIRED`/`CANCELLED`) |

Backoff is 250 ms and the sleep stops early on abort. The gate's deadline signal bounds every attempt, so retries never extend a deadline. Ollama response bodies are never echoed in error messages because they can quote prompts.

## Observations (2026-10-18, local smoke run, not CI)

Against Ollama 0.32.4 with the committed roles, embedding returned 1024-dimension vectors and a streamed chat returned one `done` event. A native `get_weather` tool call parsed. The chat request was a cold load (about 19.6 s load). After embedding and then chat, `/api/ps` listed only `qwen3.5:9b`, which shows why residency must be observed around each job rather than assumed for the normal pair.

## Acceptance

Unit tests with a fake fetch cover request shape, the stream terminal-event contract (tool calls, length finish, timings), retry before output only and the attempt limit, partial failure without retry, connection drop before output, 404, malformed and oversized NDJSON, schema violations and a missing `done`, in-stream errors without echo, abort mapping, the private-URL guard, embed prefixes, `truncate: false`, count/dimension/non-finite checks, empty and oversized batches, `/api/ps` parsing, load classification, eviction comparison and metrics. `pnpm check` passes.
