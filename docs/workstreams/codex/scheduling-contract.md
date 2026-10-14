# Local inference scheduling and recovery contract v1

Design only for [#21](https://github.com/agthumoe/solid-lamp/issues/21). Extend the existing [LlmGate contract](../../specs/llm-gate.md); no second scheduler or live GPU run is introduced. Candidate configuration/evidence is described in [catalog contract](catalog-contract.md).

## Resource model

One active inference request globally includes generation, router classification, embeddings, load/unload and context transitions. The production gate must have a single scheduling authority across API/worker processes (initial design: one local gateway; other processes submit bounded RPC requests). An in-process mutex per service is insufficient. Gateway failure closes dispatch until recovered/reconciled; don't create a split-brain local fallback scheduler. Cross-process transport/auth selection is a Phase 1 implementation decision requiring its own spec/ADR review.

Normal resident preference is chat+embed only when measured feasible. Retention is disk inventory, not a GPU guarantee. On-demand coder/domain roles may unload incompatible generators; no model-file deletion. Keep deep disabled under current RAM/feasibility gates. Caller requests a role, never a model tag or GPU override.

Capacity: 32 queued interactive and 128 queued background requests (active slot excluded). FIFO within priority. Interactive first, but when background waits admit one background after eight completed interactive requests; reset the streak after a background completes or the background queue empties. Embed batches are bounded requests, not a monopolizing loop. Load/context time is part of the active operation and deadline. A running generation is not preempted merely because interactive work arrives.

## State machine and teardown

States: queued → preparing → running → tearing-down → completed/failed/cancelled. Deadline covers every state using monotonic time; do not serialize monotonic timestamps across restart as meaningful clock values. Durable user-facing expiry uses wall-clock policy, converted to a fresh remaining monotonic budget on resume. Queued cancellation removes the item without Ollama I/O. Active cancellation/expiry aborts transport, waits for verified teardown, reconciles observed model/server state, then releases the slot. If teardown cannot be established, mark gate degraded and reject new dispatch until recovery; never overlap a second request because the client disconnected.

Release is exactly once for success/error/cancellation. Snapshot request options once; recheck safety revocation before dispatch. Any post-stream failure retains partial output with the actual attempt identity. No invisible retry. Retry/fallback before output must fit the same deadline and attempt limit from routing contract. Gateway restart loses in-flight transport: mark interrupted, reconcile loaded state before admitting new work, and don't replay a generation or side effect as if it never ran.

## Shared model/context profiles

Cache identity includes artifact digest, template/runtime revision, context and reload-sensitive load options; response options such as temperature are per request. Cache hits require an observed compatible loaded profile, not just matching tag. Chat currently uses 16K while vision uses 8K; retain that configuration and account for measured reload cost. A planned knowledge profile can share accepted chat context; changes require task-quality/VRAM evidence rather than silently normalizing context. Never reduce embedding context without the existing long-chunk evaluation.

Preparing checks private endpoint, loaded state, configured digest, free-memory budget including desktop, context headroom and accepted generation+embed pairing. Ollama model allocation is checked against measured hardware observation; the existing Gemma reporting discrepancy forbids relying on its API value alone. Unknown or changed profile invalidates cache and requires reconciliation. OOM/unexpected CPU offload fails the intended GPU policy; no silent host-config change or bigger context retry. Quality is evaluated separately from speed.

## Swap lifecycle

Acquire the global gate slot → reconcile residency → evict incompatible generator if needed → prepare accepted profile → infer → teardown/reconcile → release slot. Normal chat restoration is demand-driven by the next scheduled request; no eager background reload ahead of interactive work. If an embedding batch is next, dispatch its accepted active vector-version profile, not a configured alternative dimension. Bound each generation/batch by its budget so long background work cannot prevent eventual scheduling indefinitely.

Specialist Q4/4K starts are evaluation profiles only; no production guarantee is asserted. Record cold/warm load, queue wait, prefill/decode, observed VRAM, context reloads and fallback latency with model/profile/config identity. Safe telemetry excludes prompts/documents/credentials. Future interactive latency targets come from measurements rather than an arbitrary claim.

## Embedding failure and version ownership

Search/retrieval pins the active vector version, model digest, dimensions and prefixes from ADR 0002. If embed is unavailable or incompatible, fail/degrade retrieval explicitly; do not embed the query with Nomic against Qwen vectors. Even matching dimensions do not establish a shared embedding space. Rebuild/catch-up/validated atomic promotion is a separate approved workflow; old data/index remains readable according to the explicit version plan. Generation may explain unavailable retrieval only within permitted scope, without fabricating citations.

## Acceptance matrix for future LlmGate implementation

| Group     | Required scenarios                                                                                                                |
| --------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Queue     | Exact 32/128 capacity, FIFO, eight-interactive starvation bound, empty-queue reset, bounded embed interleave                      |
| Lifecycle | Queued/active cancellation, preparation deadline, release once on each path, teardown failure closes gate, restart reconciliation |
| Versions  | Enqueue snapshots vs ordinary config update, disable/revoke before dispatch, digest/template/context mismatch                     |
| Residency | Warm compatible hit, cold swap, chat/vision reload, failed memory/residency, desktop VRAM accounting, demand-driven restoration   |
| Recovery  | Before-output accepted fallback ≤1, failed fallback stops, no post-stream restart, no parallel API/worker dispatch                |
| Embedding | Active vector version preserved, no cross-dimension or same-dimension cross-space fallback, explicit rebuild promotion only       |

Routing fixtures cover related policy outcomes; they do not measure the GPU or test scheduler execution. Add fake-clock/fake-port scheduler integration tests under a separately tracked implementation task. Exclusive benchmark/GPU host coordination remains required even in separate worktrees.
