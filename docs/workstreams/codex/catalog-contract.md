# Retained catalog and binding contract v1

Design deliverable for [#21](https://github.com/agthumoe/solid-lamp/issues/21), subordinate to [boundary v1](../CONTRACT.md) and [ADR 0004](../../adr/0004-domain-model-routing.md). This is a future validated-config contract, not an active config/schema implementation. No existing mapping or artifact is changed.

## Ownership and dependencies

The config layer owns catalog records and role bindings; the adoption policy owns evidence review; LlmGate owns observed availability/residency. An agent owns source/tool scope and workflow. No model record grants tool permission. Consume Claude's eventual evidence by immutable candidate ID; missing information remains unknown. Do not depend on unmerged Claude files or change the frozen boundary contract.

## Catalog record

Future config parsing uses strict Zod objects, positive integer limits, enum states, unique IDs, private Ollama endpoints, resolved references and explicit option shapes. Reject extra keys and arbitrary model overrides in external requests. The illustrative interfaces below specify semantics, not compiled application code.

| Field            | Contract                                                                                                                                     |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `modelId`        | Stable catalog ID independent of mutable Ollama tag; unique nonempty string                                                                  |
| `upstreamId`     | Publisher/model ID or existing Ollama family reference; never inferred from a request                                                        |
| `state`          | `candidate`, `evaluating`, `enabled`, `disabled`; retention independent of state                                                             |
| `retained`       | Always true for the owner-approved portfolio; unloading is not deletion                                                                      |
| `artifact`       | Null while unresolved; otherwise reviewed local tag, immutable digest, quantization, template hash and Ollama compatibility evidence         |
| `capabilities`   | Explicit text/vision/embedding support; architecture label does not establish task competence                                                |
| `profiles`       | Named context/options profiles with role scope and GPU evidence references; embedding profiles include dimension and prefix/version identity |
| `evidence`       | References described below; missing/expired/revoked entries fail closed for adoption                                                         |
| `disabledReason` | Required for disabled records; structured reason, no secrets/private document text                                                           |
| `revision`       | Immutable catalog revision; snapshots retain old revisions for audit                                                                         |

Separate retention from selection. Candidate → evaluating means a tracked evaluation started, not permission for production inference. Evaluating → enabled requires license/provenance, local artifact/template compatibility, GPU/context and relevant domain-quality evidence, plus accepted review. Enabled → disabled is allowed for revocation/failed evidence; any reactivation rechecks all gates. Do not silently downgrade disabled to candidate then route to it. Retain failed candidates for comparison with failure recorded. Evaluation-mode inference, when separately authorized, uses an isolated diagnostic task and does not treat evaluating as production-enabled.

## Evidence is scoped and reviewable

Evidence records identify kind, status (`pending`, `passed`, `failed`, `revoked`), reviewed scope, immutable artifact/profile/fixture version, reviewer, review time, source references and applicability limits. License detail remains Claude's evidence responsibility. Reference identifiers alone do not count as passed; resolve evidence from a trusted local reviewed registry. Source documents cannot mark themselves trusted or alter evidence. Domain quality approval for finance is not accounting approval. Modified digest/template/context invalidates the matching compatibility/quality evidence; unrelated profiles remain independently reviewed.

Specialist activation needs: verified upstream license chain, artifact provenance/hash, supported Ollama/template, accepted GPU/context profile and reviewed agent-specific quality. Existing installed/benchmarked models remain retained and active config untouched; migration must explicitly import reviewed legacy evidence and mark unresolved domain scopes pending. Do not retroactively assert every specialist-quality gate passed for the current general model. Qwen as a domain fallback needs its own scoped acceptance; existing chat acceptance alone is insufficient.

## Complete portfolio mapping

Stable IDs below are design identifiers only; local existing tags are preserved as facts from current config. Null specialist tags are deliberately unresolved.

| ID                  | Existing tag / upstream candidate            | Intended roles                                            | Current design adoption status                                        |
| ------------------- | -------------------------------------------- | --------------------------------------------------------- | --------------------------------------------------------------------- |
| `qwen-general`      | `qwen3.5:9b`                                 | chat, vision, planned knowledge; possible scoped baseline | Existing mappings retained; knowledge/domain scope acceptance pending |
| `qwen-router`       | `qwen3.5:4b`                                 | router                                                    | Existing mapping retained                                             |
| `qwen-coder`        | `qwen2.5-coder:14b`                          | coder                                                     | Existing swap mapping retained                                        |
| `qwen-embed`        | `qwen3-embedding:0.6b`                       | embed, 1024 dimensions                                    | Current vector version retained                                       |
| `qwen-alternative`  | `qwen3:8b`                                   | chat alternative/comparison                               | Existing fallback retained                                            |
| `gemma-alternative` | `gemma4:12b`                                 | chat alternative/comparison                               | Existing fallback retained; allocation reporting caveat retained      |
| `nomic-embed`       | `nomic-embed-text`                           | versioned embedding rebuild, 768 dimensions               | Explicit rebuild/promotion only; never query fallback                 |
| `qwen-deep`         | planned `qwen3.6:35b-a3b`                    | deep/batch                                                | Disabled; RAM approval and feasibility evidence still needed          |
| `saul-legal`        | `Equall/Saul-7B-Instruct-v1`; local tag null | planned legal-research                                    | Candidate; not installed or accepted                                  |
| `fin-r1`            | `SUFE-AIFLM-Lab/Fin-R1`; local tag null      | planned financial-analysis                                | Candidate; upstream licensing unresolved                              |
| `cpa-qwen`          | `AudCor/cpa-qwen3-8b-v0`; local tag null     | planned accounting                                        | Candidate; accounting competence not established                      |

Do not copy fixture enabled states into production: every successful specialist fixture is explicitly hypothetical. All seven installed models plus the existing disabled deep proposal must survive migration, as must existing chat/embed fallbacks and their restrictions.

## Role binding and activation

A binding has role, enabled flag, primary modelId/profileId, accepted agent scopes, configured fallback modelId/profileId list, fallback-enabled flag, and revision. Existing roles remain chat/router/coder/embed/vision; planned roles are knowledge/legal-research/financial-analysis/accounting. Router proposes an allowed agent ID; it cannot select modelId/profileId or change options.

A valid production binding requires enabled model state, matching capability, resolvable artifact/profile and scoped evidence. Loader rejects malformed/contradictory enabled bindings atomically, retaining the last known valid revision. Candidate or disabled specialist primaries belong only in non-active planning records. To serve a domain with Qwen before a specialist passes, bind accepted Qwen directly in a separately reviewed config change; do not enable an invalid specialist primary and rely on fallback to bypass adoption.

Fallback handles transient availability failure of a valid, accepted primary only. Fallback order must be explicit and scope-accepted. Existing alternative chat models remain available for later policy integration, not automatically eligible for legal/accounting fallback. Embed never uses generation fallback rules. Invalid config/evidence is a configuration/adoption error, not transient unavailability.

## Version changes and runs

Enqueue snapshots config/role/artifact/profile/agent/tool/source versions and an absolute monotonic deadline. Before dispatch recheck revocation/disable and current capability/availability; revocation cancels queued work. Ordinary non-revoking config updates do not silently mutate an already queued request. A disabled artifact aborts active transport and reports cancellation; output already shown remains a marked partial result. Resume after restart revalidates evidence/artifact/source policy rather than replaying stale acceptance.

Schema integration and migration tests belong in separately tracked Phase 1 work. Validate retained inventory, references/options/private endpoints, unknown states, duplicate IDs, mismatched capabilities, null artifacts for enabled roles, failed/revoked evidence and vector-version consistency before changing active config.
