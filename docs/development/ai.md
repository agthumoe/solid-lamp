# AI engineering and evaluation

## Runtime architecture

All chat, routing, code, vision and embeddings run locally through Ollama. Resolve model roles/options from validated config; snapshot model digest, context, prompt/agent version and limits in each run. Production calls enter [LlmGate](../specs/llm-gate.md); batch embedding requests are bounded. Benchmark harnesses are explicit isolated diagnostics, never production alternatives.

Separate persona instructions, tool metadata, user requests and retrieved data. Version prompt templates and evaluation fixtures. Retrieved content is delimited data; enforce allowlists/schema/approval checks in code even if a model follows instructions. Delimiters alone do not prevent injection. Never execute a tool because a source document names it.

Graphs orchestrate application use cases. Tools are thin adapters with declared sideEffect/risk, validated arguments, timeout/cancellation and scoped permissions. Keep state serializable; do not checkpoint credentials or process handles. Narrow tool outputs to relevant data with source provenance and bounded size.

## Safe tool lifecycle

Native and text-repaired calls follow the same validation, allowlist and approval path. Repair accepts explicit responses only; explanatory examples are not executable calls. A failed parse never silently becomes an approved action. For side effects: propose immutable action → persist approval/checkpoint/audit → pause → verify authorized owner decision, expiry and payload hash → dispatch once with idempotency/reconciliation → persist outcome. Test approve/reject/expiry/replay/concurrency and every restart boundary.

Owner notifications remain allowed by the project policy; other recipients do not exist in the messaging code path. Retries cannot send duplicates. Agent memory is proposed then approved, with provenance/confidence; facts do not silently become instructions.

## Retrieval and quality

Return verifiable citations with note path/heading or repository/file/line range. Search filters and source boundaries are enforced server-side. Relevance thresholds and answerable/unanswerable fixtures are calibrated; a keyword match alone does not establish grounded quality. Distinguish exact-format adherence from semantic refusal quality, and report both rather than scoring punctuation as hallucination.

Evaluate retrieval recall, grounding/citation accuracy, abstention, tool selection/schema validity, unauthorized/extra tools, injection resilience, coding quality, context limits, latency and memory residency separately. Record sample counts/config/hardware/versions and preserve raw failures. A completed run is not acceptance: required missing targets, malformed vectors and required residency failures must be visible and gate success. Eviction observations are not failures of a required residency pair.

Unit tests use deterministic fake ports; integration tests use local Ollama and synthetic data; live measurements use a single idle benchmark at a time. Real vault examples need privacy review and remain local. Avoid raw private prompts/content in CI artifacts. Disable cloud tracing/telemetry and hosted eval integrations unless the owner explicitly authorizes that data flow; runtime inference still stays local.

Per-run budgets: max steps/tokens, time/deadline, per-agent concurrency/rate limit, loop detection and cancellation. Preserve partial output/error provenance without inventing success. Debug queue waits, model reload time, prefill/decode, tool latency and retrieval before changing prompts/models.

Reference inspiration: [LangGraph.js](https://github.com/langchain-ai/langgraphjs) for explicit graph/checkpoint/HITL structure; adapt it to local Ollama and local observability. Existing benchmark follow-ups are tracked separately from the handbook delivery task.
