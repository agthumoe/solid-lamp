# `packages/llm` core

Issue: [#57](https://github.com/agthumoe/solid-lamp/issues/57). Status: implemented (pure core). Parent: #3. Contracts: [LlmGate](llm-gate.md), [AI orchestration](../development/ai-orchestration.md#llmgate-client-interface-packagesllm), [config loader](config-loader.md).

## Goal

Provide the I/O-free parts of inference scheduling that `apps/inference` wires to Ollama: role resolution, the gate, embedding batch scheduling and tool-call validation/repair.

## Contracts

- **Roles.** `resolveGenerationRole(config, role)` returns a frozen snapshot (model, `num_ctx`, `think`, explicit sampling options from config). An unbound role (for example `deep`) is `INFERENCE_UNAVAILABLE`. `resolveEmbedRole` snapshots model, context, dimensions and prefixes.
- **Gate.** `LlmGate.run(job, { priority, signal, deadline, label })` returns `Result<T, InferenceError>`. One active job; 32 interactive / 128 background queued by default, overflow is `QUEUE_FULL`; FIFO within priority; interactive first, but one waiting background job runs after eight consecutive interactive completions. Cancellation or deadline expiry of queued work resolves without calling the job; the deadline is also checked against the clock at dispatch and when a job settles, so a lagging timer never lets expired work run or succeed. For an active job the gate aborts the job's signal (reason `CANCELLED`/`DEADLINE_EXPIRED`), waits for it to settle, discards its output and only then dispatches the next job. A job returning an error releases the slot; a thrown job releases the slot and rejects (programmer bug). An invalid deadline or one beyond the timer range (~24 days) throws `RangeError`. `metrics()` reports active label, queue depths, oldest queue age, completed and rejected counts.
- **Scheduling.** `scheduleGeneration(deps, role, options, execute)` resolves the role when called (enqueue time) and returns `{ value, snapshot }` (the executor's value is wrapped, never spread), so a config reload never changes queued work. `embedInBatches` admits each batch separately as its own gate job so interactive work interleaves; a vector-count mismatch is `INVALID_RESPONSE`.
- **Tool calls.** `validateToolCall(call, allowlist, repaired)` is the single path for native and repaired calls: allowlisted name plus strict zod arguments (validated arguments, with defaults, replace raw ones). `repairToolCalls(text, allowlist)` accepts only explicit calls occupying the whole response (bare JSON, `<tool_call>` or fenced blocks); prose around a call is `NO_EXPLICIT_CALL`. Non-object or malformed arguments are `MALFORMED_CALL`; any invalid candidate rejects the whole response. Limits: 32 KiB text, 8 calls. Repaired calls are returned marked `repaired`, never executed here.

## Deferred to `apps/inference` (needs Ollama)

Observed eviction and loaded-model checks, shared-model context reload accounting, normal-pair restore, bounded transient retries before output, streaming events, token/latency metrics.

## Acceptance

Unit tests cover queue limits, FIFO/priority and the starvation bound, queued and active cancellation with teardown ordering, deadline expiry (queued, active, already past, and past due before the timer fires at dispatch or settlement), primitive/array generation results preserved, release after error and throw, single execution, metrics, enqueue-time role snapshots, unbound roles, batch interleave and count mismatch, and the REVIEW #2 negative repair cases (JSON in prose, scalar/invalid args, tools outside the allowlist). `pnpm check` passes.
