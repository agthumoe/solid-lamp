# Project review — 2026-10-12

Scope: Phase 0 source, baseline artifact, configuration, and phase plan. No live hardware re-audit or new inference benchmark was run. Application code and lint/typecheck/test scripts do not exist yet.

## Findings

1. **High — tool scoring can accept unsafe extra calls.** `scripts/bench/models.ts:255–269` checks only the first call, ignores additional calls, coerces argument types, and never validates the full tool schema. The two correct no-tool cases count as structured calls, so chat/router's “20 structured” means 18 calls plus two correct abstentions. Require exactly one call when expected, schema-valid arguments, and separate abstention/native/recovered metrics before confirming roles.
2. **High — text repair is not a production execution boundary.** `scripts/bench/ollama.ts:141–170` accepts arbitrary argument shapes and extracts JSON from explanatory text. Local probes confirmed scalar arguments and a quoted “do not execute” example are accepted. No tools are executed by this harness; production must validate repaired output against the allowlist, schema, and approval policy. Add negative cases before porting this helper into `packages/llm`.
3. **Medium — co-residency GPU success can hide eviction.** The baseline coder+embed result has `allResident:false` but `all100Gpu:true`: only embed remains. Require presence, expected contexts, and GPU residency together; an empty model list must fail. The tuned max-loaded setting is two, while the harness also requests three: label that case as an eviction-policy test rather than a required residency set.
4. **Medium — benchmark evidence is fragile.** Results are written only after the whole run; request timeouts are absent and `unloadAll()` silently proceeds after its polling limit. Persist progress per target, bound requests, and fail on unsuccessful eviction. `--only` still loads embed and runs all residency cases; document or fix its scope.
5. **Medium — embedding fallback conflicts with the planned schema.** `vector(1024)` cannot directly store the configured 768-dimensional fallback. Decide a dimension-aware migration/re-index strategy before Phase 1 migrations. Switching between same-dimensional models also requires isolated embedding versions; do not search mixed vector spaces during re-indexing.
6. **Medium — security and recovery acceptance criteria arrive too late.** Add API/MCP access checks before remote exposure, approval expiry/replay/concurrent-decision and restart tests in Phase 3, and a restore smoke test before ingesting the real vault. Keep final reboot hardening in Phase 8.
7. **Low — handoff and tooling inconsistencies.** STATUS still asks to install settings already recorded as installed and says a tuned run is running without a result artifact. Node 24 in AGENTS conflicts with Node 22 in BUILD_PROMPT and the package engine range. Phase acceptance lines beginning with a green check are goals, not completed work; label them explicitly.

## Recommended sequence

1. Fix benchmark scoring, validation, residency checks, and progress persistence.
2. Obtain a tuned artifact. Compare coder at 8K against chat reused for coder, including real coding tasks; current fixtures measure tool selection and simple retrieval, not coding quality. Compare embed at 2K using representative long chunks before reducing context.
3. Confirm model roles with the owner, record ADR 0001, and close Phase 0.
4. Start Phase 1 only after the phase gate. Specify LlmGate queue limits, cancellation, interactive priority, starvation prevention, model/context switching, and eviction behavior before implementation.

Architecture recommendation: retain the current local-first structure. Prefer fewer model switches on this GPU; using chat for coder is a candidate, not yet a measured coding-quality conclusion. Move baseline security and restore verification earlier without adding new domain agents or services.


## Resolution — 2026-10-12

Findings 1–4 are addressed in the harness: strict allowlisted schema scoring, separate abstentions, whole-response text repair with object arguments, unrounded residency validation, atomic stage artifacts, explicit error/interruption status, protected labels, and timeouts/status checks on every HTTP path. `pnpm test:bench` passes seven regression groups, including stubbed full-harness success/failure runs. Syntax and CLI rejection checks pass. No live inference was started by this fix session because a v2 benchmark is recorded as active; new measurements require a fresh v3 label when idle. Existing artifacts retain their original scoring semantics.

Finding 5 is resolved architecturally by accepted ADR 0002 and the embedding storage spec; migrations and runtime behavior are scheduled explicitly for Phases 1–2. Finding 6 is incorporated as required early gates in PLAN and the security/recovery spec; tests execute when those services exist. Finding 7 is addressed by handoff updates, clear acceptance labels, Node 24 engine alignment, and command mirrors. LlmGate is specified before implementation. Model-role changes remain evidence-dependent and owner-confirmed.
