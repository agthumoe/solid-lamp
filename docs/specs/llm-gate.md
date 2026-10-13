# LlmGate contract

Goal: serialize local GPU inference, protect interactive latency, and bound background work.

Inputs: role, interactive/background priority, validated request, abort signal, deadline. Outputs: streamed/final Ollama response, structured failure, queue metrics. All application generation and embedding calls use this gate; the Phase 0 standalone benchmark is exempt and requires an idle server.

Defaults: one active inference request, at most 32 queued interactive and 128 queued background requests; reject overflow explicitly. FIFO within priority. Dispatch interactive first, but admit one waiting background request after eight interactive completions. Background embedding batches are bounded so interactive work can run between batches. A running generation is not forcibly preempted; cancellation aborts its HTTP request and releases the slot only after teardown.

Resolve roles from validated config at enqueue time and snapshot model identity, num_ctx, prefixes, and options. Deadline covers waiting plus execution; cancelled/expired queued work never reaches Ollama. Never retry streamed output silently. Bound transient retries for idempotent requests before output begins.

Residency is a policy, not a guarantee: reserve chat+embed as the normal pair, serialize swap roles, and check actual loaded model/context state. Shared-model roles with different contexts require explicit context reload accounting. A settings/config change invalidates the resident-state cache. Report cold loads, evictions, queue age, active role, and tokens/latency. Restore the normal pair on demand after a swap; do not run background reloads ahead of interactive work.

Acceptance tests in Phase 1: queue limits, FIFO/priority/starvation bound, queued and active cancellation, deadline expiry, release after errors, no double execution, embedding batch interleave, role/context snapshots, shared-model context switching, and observed eviction. Production repaired tool calls are validated with zod and agent allowlists, and enter the same approval path as native calls.
