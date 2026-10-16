# AI orchestration: agents, graphs, tools, prompts

Status: implementation guide for Phases 1–3 and 7 ([#49](https://github.com/agthumoe/solid-lamp/issues/49)). Safety and evaluation rules: [AI engineering](ai.md). Contracts: [LlmGate](../specs/llm-gate.md), [routing](../workstreams/codex/routing-contract.md), [catalog](../workstreams/codex/catalog-contract.md), [scheduling](../workstreams/codex/scheduling-contract.md), [ADR 0004](../adr/0004-domain-model-routing.md). Templates: [tool definition](templates/tool-definition.ts), [LangGraph graph](templates/langgraph-graph.md), [agent.yaml](templates/agent-yaml.md).

## Layers

```text
Agent (config/agents/<slug>)        what: persona, tool allowlist, brain scope, triggers, limits
  └─ Graph (packages/agents/graphs)  how: LangGraph StateGraph of small nodes, checkpointed
       ├─ Nodes                      one step each: route, retrieve, reason, propose, await approval, execute, respond
       ├─ Tools (registry)           typed capabilities with sideEffect/risk; allowlisted per agent
       └─ Model calls                role + priority → LlmGate client → inference process → Ollama
```

- An **agent** is configuration plus a graph choice; it never names a model tag (roles only, resolved from `config/models.yaml`).
- A **graph** is orchestration only: it sequences nodes and routes on state. Business rules (approval transitions, ledger math, retrieval ranking) live in their feature/package code and are called from nodes.
- A **node** is a small async function `(state, deps) => Partial<State>` with one responsibility. It gets everything it needs through `deps`; it never constructs clients.
- A **tool** is a typed adapter. It doesn't decide whether it may run; the executor does (allowlist, schema, approval).

## Folder layout

```text
packages/agents/src/
├─ index.ts                     public API: createAgentRuntime, agent registry types
├─ registry/
│  ├─ agent-config.ts           zod schema for config/agents/<slug>/agent.yaml + loader
│  └─ agent-registry.ts         loads/validates all agents; hot reload swaps a validated snapshot
├─ graphs/
│  ├─ supervisor/               intent routing (owner selection > router proposal + deterministic policy)
│  │  ├─ state.ts               state annotation/schema
│  │  ├─ nodes/<node>.ts        one file per node (+ <node>.test.ts)
│  │  └─ graph.ts               buildSupervisorGraph(deps): wiring only
│  └─ answer-with-brain/        retrieve → reason → cite → respond (shared by most agents)
├─ tools/
│  ├─ tool.ts                   ToolDefinition type, executor, allowlist check
│  └─ <tool-name>/tool.ts       one tool per folder (+ test)
├─ prompts/
│  └─ <prompt-name>/
│     ├─ v1.md                  versioned template text
│     └─ prompt.ts              typed variables + render(); records name@version in the run
└─ memory/                      memory proposal/approval helpers
```

## Graph conventions (LangGraph.js)

1. **State** is a typed, serializable object: IDs, messages, retrieved chunk references with citations, tool proposals, approval decision, counters. No clients, functions, secrets, raw credentials or unbounded document text. Large content is stored by reference (chunk IDs), not copied into every checkpoint.
2. **Checkpointing:** `PostgresSaver` with `thread_id = runId`. Every node is safe to replay after a crash: nodes with external effects only run through the approval executor, which is idempotent by key.
3. **Edges are explicit.** Conditional edges route on typed state fields, never on free model text. A router node outputs a validated enum.
4. **Limits:** every graph has `maxSteps`, a token budget, a deadline and loop detection (same node + same input hash twice ends the run with `LOOP_DETECTED`). Limits come from agent config with safe defaults.
5. **Cancellation:** the run's `AbortSignal` is passed to every node and model call; cancellation stops at the next await and records a cancelled step.
6. **Streaming:** nodes emit typed events (`step.started`, `token`, `citation`, `tool.proposed`, `approval.requested`, `step.finished`) to a run event sink; `api` turns them into SSE with sequence numbers.
7. **Subgraphs** for specialists: the supervisor delegates with a typed input (question, scope, deadline) and receives a typed summary (claims, citations, uncertainty). Specialists can't add nodes or select new agents (max three specialist steps plus one synthesis).

## Approval interrupt and resume

```text
propose node ── validates args, computes payloadHash, builds ActionProposal
     │
executor ── sideEffect=false → run now (bounded, timed out) → result as data
     │      sideEffect=true  → interrupt({ approvalRequest }) → run pauses (checkpoint saved)
     ▼
api ── persists approvals + audit + outbox atomically, notifies owner
owner decision ── conditional single-use transition (owner, expiry, payloadHash)
     ▼
resume (Command) ── approved: dispatch once with idempotencyKey → record outcome
                 └─ rejected/expired: resume with a rejection result; nothing executes
```

Rules: the payload hash covers tool name and canonicalized arguments; a changed payload needs a new approval. Resuming twice can't dispatch twice (idempotency key in the dispatch record). A repaired text tool call goes through exactly the same path as a native one.

## Tools

Every tool is a `ToolDefinition` ([template](templates/tool-definition.ts)):

| Field                 | Purpose                                                                                     |
| --------------------- | ------------------------------------------------------------------------------------------- |
| `name`                | `domain.verb_object` (`brain.search`, `tasks.propose_create`); stable, used in allowlists   |
| `description`         | What the model sees. Describe when to use it, not how it works internally                   |
| `input` / `output`    | zod schemas; input is strict (unknown keys rejected); output is bounded                     |
| `sideEffect`, `risk`  | `false`/`true`; `low`/`medium`/`high`. Side-effect tools always require approval            |
| `timeoutMs`           | Hard limit per call                                                                         |
| `execute(input, ctx)` | Pure adapter call with `ctx.signal`, `ctx.runId`, scoped deps; returns data with provenance |

Tool output returned to the model is wrapped as delimited data with its source. It can't change which tools are available or trigger another tool by itself.

## Prompts

- Prompts live in `packages/agents/src/prompts/<name>/v<N>.md`. Changing behaviour means a new version file; never edit a version that evaluations reference.
- `prompt.ts` declares typed variables and a `render()` that places **trusted instructions** (persona, agent policy) and **untrusted data** (retrieved chunks, emails, files) in separate, clearly delimited sections. Untrusted text is never interpolated into the instruction section.
- Every run records `prompt name@version`, agent config hash, model role, resolved model and options. Prompt changes must be evaluated against the relevant fixtures before merging ([AI engineering](ai.md)).
- Prompt v2 of the domain protocol (agent policy + documents + question in one user turn) is the reference pattern for domain agents ([evaluation protocol](../workstreams/claude/evaluation-protocol.md#prompting)).

## Agent configuration (`config/agents/<slug>/`)

`persona.md` holds voice, goals, boundaries and examples. `agent.yaml` is validated by zod at startup and on hot reload ([template](templates/agent-yaml.md)):

| Field          | Type / allowed values                                                             |
| -------------- | --------------------------------------------------------------------------------- |
| `slug`         | kebab-case, equals the folder name                                                |
| `enabled`      | boolean                                                                           |
| `model_role`   | one of the roles in `config/models.yaml` (`chat`, `router`, `coder`, `vision`, …) |
| `graph`        | registered graph name (`answer-with-brain`, `planner`, …)                         |
| `tools`        | allowlist of tool names                                                           |
| `brain_scope`  | `{ sources: [...], tags: [...], path_prefixes: [...] }`                           |
| `memory_scope` | `agent` \| `global` \| `none`                                                     |
| `triggers`     | list of `{ cron, timezone }` or `{ event }`                                       |
| `notify`       | `whatsapp` \| `dashboard` \| `none`                                               |
| `autonomy`     | `read_only` \| `propose`                                                          |
| `limits`       | `{ max_steps, max_tokens, deadline_ms, rate_per_hour }`                           |
| `prompt`       | `<name>@<version>`                                                                |

Hot reload validates the whole set first and swaps atomically; an invalid file keeps the last valid snapshot and reports the error.

## LlmGate client interface (`packages/llm`)

```ts
type Priority = 'interactive' | 'background';

interface InferenceClient {
  generate(
    req: GenerateRequest,
    opts: CallOptions,
  ): Promise<Result<GenerateResult, InferenceError>>;
  stream(req: GenerateRequest, opts: CallOptions): AsyncIterable<StreamEvent>;
  embed(req: EmbedRequest, opts: CallOptions): Promise<Result<EmbedResult, InferenceError>>;
}

interface CallOptions {
  priority: Priority;
  signal: AbortSignal;
  deadline: Date; // absolute; covers queue wait + execution
  runId?: string; // correlation only
}

// GenerateRequest names a ROLE ('chat', 'coder', …), never a model tag.
// The gate resolves role → model/num_ctx/options from validated config at enqueue
// time and returns the actual identity used, so runs can record it.
```

`InferenceError` is a discriminated union: `QUEUE_FULL`, `DEADLINE_EXPIRED`, `CANCELLED`, `INFERENCE_UNAVAILABLE`, `MODEL_NOT_LOADED`, `INVALID_RESPONSE`. `generate` and `embed` return it in a `Result`; callers handle each code explicitly.

**Streaming failure contract** ([template + tests](templates/inference-stream.ts)): `stream()` never throws for an expected failure. It yields `started`, zero or more `token` events, then **exactly one terminal event**: `done` (finish reason, token counts) or `error` (`InferenceError` plus `partial`). `partial: true` means output was already emitted: the caller keeps or marks the partial text and **never retries** (this replaces a separate `OUTPUT_ALREADY_STARTED` code). A failure before output (`partial: false`, for example `QUEUE_FULL`) may be retried within the deadline. A stream that ends without a terminal event is `INVALID_RESPONSE`. A thrown error from the iterator is a programmer bug, not a handled case. `api` maps terminal events to the SSE `done`/`error` frames.

Every request sets `num_ctx` and **all sampling options explicitly** from the role config (temperature, top_p, top_k, repeat/presence penalty, seed when deterministic). Registry/Modelfile defaults are never relied on.

## Memory

Agents propose long-term memories (`memories` table, `approved = false`) with source, confidence and provenance. Only approved memories are retrieved. A memory can't contain instructions that change tools, routing or policy; it is data like any other retrieved text.

## Evaluation

- Fixtures live in `evals/` (synthetic only). Suites: routing (51 cases), domain (180 cases), plus per-agent suites added spec-first.
- `packages/evals` runs suites against a fake `InferenceClient` in CI (structure, scoring, tool safety) and against local Ollama only in explicit, serialized local runs.
- A change to a prompt, graph, tool description or model role includes before/after results for the affected suite. Scores and safety failures are reported separately from latency.

## Review checklist for AI code

- [ ] Role names only; no model tags or sampling defaults outside config.
- [ ] State serializable; no secrets/clients in state; large text stored by reference.
- [ ] Every node has one responsibility and takes `deps`; graph file is wiring only.
- [ ] Tools have strict input schemas, bounded output, `sideEffect`/`risk`, timeout; side effects go through approval.
- [ ] Untrusted text only in delimited data sections; it can't route or select tools.
- [ ] Limits, cancellation and deadlines wired; loop detection present.
- [ ] Prompt version recorded; affected eval suite re-run.
