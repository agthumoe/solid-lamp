# Benchmark integrity

Goal: collect reproducible evidence without executing model-selected tools or accepting malformed calls as successes.

Inputs: role config, fixed tool schemas/cases, synthetic retrieval fixture, Ollama responses. Outputs: versioned JSON artifacts with config snapshots, stage progress, explicit completion/failure, strict tool metrics and residency checks.

Contracts:

- A call case passes only for exactly one allowlisted, schema-valid call with matching expected values. Native calls, recovered calls, abstentions, and failures are separate metrics.
- Text repair accepts only an entire bare JSON call or a response consisting entirely of tool_call blocks/JSON fences. Prose examples are data. Argument objects must be plain records; string-encoded argument objects may be decoded once. Repair never executes tools or bypasses approval.
- Residency requires all requested models at their expected contexts and full reported GPU allocation. Empty/missing/invalid allocations fail. Eviction probes are observational, not phase acceptance checks.
- Every HTTP path is bounded and checks status. Failed unloads stop benchmarking. Stream parsing handles a final line without a newline.
- Save an atomic artifact at start and after each completed measurement stage. Preserve partial results and record errors. Never overwrite an existing label. --only limits generation targets; embed remains required for RAG. --no-coresidency skips residency probes.

Validation: Node test runner with synthetic calls, malformed arguments, extra calls, unknown tools, empty/evicted/context-mismatched models, stubbed HTTP errors/timeouts/streams, and artifact persistence. No live inference required for regression tests. Existing benchmark artifacts remain historical; revised harness results carry a new version.

Validation follow-up contracts:

- Validate each embedding batch before using or timing it: exact input/output count, configured primary dimensions, stable dimensions across a model's batches, finite numeric components, and finite nonzero vector norms. Cosine rejects invalid vectors and unequal dimensions.
- Required generation targets that cannot be inspected are persisted as skipped; the finished run is `incomplete` with exit code 1. Optional fallback failures are persisted with reasons and produce `complete_with_skips` (exit 0 if required targets finish). Never perform residency probes when required generation targets are unavailable. Transport/malformed-primary errors remain `failed`.
