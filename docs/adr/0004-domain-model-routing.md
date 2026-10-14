# ADR 0004: Retain models and route bounded domain analysis

Date: 2026-10-13. Status: accepted direction; implementation phased. Tracking: [#17](https://github.com/agthumoe/solid-lamp/issues/17), evaluation [#15](https://github.com/agthumoe/solid-lamp/issues/15).

## Context

The owner wants legal research, finance/investment analysis, accounting and Qwen3.5-9B broad knowledge while retaining all existing planned models. The RTX 3060 has 12 GB VRAM; keeping every generator resident is infeasible. Specialist training and model-card labels alone do not establish current US/Texas competence, upstream licensing or improved task quality.

## Decision

Separate the retained model catalog, enabled semantic role bindings, and agent workflows. Preserve current mappings/artifacts. Use Qwen3.5-9B for broad knowledge and general synthesis; select Saul, Fin-R1 and CPA-Qwen as domain evaluation candidates, enabling each only after provenance/license, local compatibility and task-quality gates. Keep disabled/planned models in the catalog, including the existing deep-role proposal.

Route owner-selected intent first; constrain automatic routing with deterministic policy and validated enabled bindings. Specialists supply bounded read-only analysis rather than independent autonomous tool authority. Run all generation/embedding requests through the existing LlmGate, with sequential on-demand model swaps and explicit fallback provenance. Keep vector versions isolated under ADR 0002.

Ground answers in dated/jurisdiction-aware sources and cited books. Exact arithmetic/reconciliation belongs in deterministic domain code. No specialist or general model gains write authority from its role name. Full behavior, evaluation targets and phase dependencies are in the [domain-agent plan](../specs/domain-agent-plan.md).

## Consequences

Retained models can serve different validated needs without replacing the existing portfolio. Model swaps add cold-load/queue latency; measure and display them. Catalog/schema/routing work belongs in Phase 1, source ingestion in Phase 2, permissions/orchestration in Phase 3, and domain workflows in Phase 7. No active configuration, download or database change is made by adopting this ADR.

Fin-R1 licensing remains an adoption blocker and CPA-Qwen competence remains unproven. A failing specialist stays inactive; Qwen can serve the scoped workflow when its own evaluation passes and the fallback is disclosed. Reject keeping every model resident, silently substituting models, and treating domain fine-tuning as proof of legal/accounting/investment reliability.
