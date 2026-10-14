# Codex workbench status

Task: [#21](https://github.com/agthumoe/solid-lamp/issues/21). Date: 2026-10-14. Branch: `docs/21-codex-routing-design`; worktree: `/tmp/aetherion-workbenches/codex`. Status: design delivered for integration in [PR #23](https://github.com/agthumoe/solid-lamp/pull/23); local validation passed. Required CI/publication evidence is recorded in #21.

## Now

- Added [catalog/status/binding contract](catalog-contract.md), [routing/fallback contract](routing-contract.md) and [scheduler/recovery contract](scheduling-contract.md).
- Added [51 synthetic golden cases](../../../evals/routing/cases.json) and [coverage/validation design](evaluation-design.md). Hypothetical accepted states are explicitly separate from actual inactive specialist adoption.
- Changes remain exclusively in owned paths; no active config, shared handoff, dependencies/lockfile, runtime package or Claude files changed. Existing locked dependencies installed offline into this worktree (156 cached packages, zero downloads).

## Next

Review/merge PR #23 under the separately tracked integration workflow after required CI passes and Claude work is ready. Local `pnpm check` passed all gates (19 regression groups, 44 authored Markdown files before fixture README). Fixture integrity checked 51 unique cases, 53 coverage tags, fresh patch expansion and expected identity/fallback/no-write invariants; no policy/model execution. Leave PR integration and canonical handoff updates to the separately tracked integration workstream.

## Blocked / deferred

Task design does not depend on Claude's unmerged work. Runtime implementation, candidate activation and live evaluation require separate tasks/phase acceptance and scoped evidence. Single-gateway cross-process transport needs an implementation spec/ADR decision. No GPU or model calls in this task.

## Session log

- 2026-10-13: Coordination bootstrap; worktree prepared, not started.
- 2026-10-14: Owner requested execution; #21 marked in progress, isolated branch verified. Designed candidate/enabled separation, scope-specific evidence, bounded explicit fallback, global gate recovery and embedding-space isolation; authored 51 decision fixtures. Validation/publication evidence recorded in #21.

- 2026-10-14: Published PR #23; local unified gates and 51-case fixture integrity checks pass. PR intentionally unmerged; own handoff updated, shared files untouched. Final CI evidence lives in #21.

- 2026-10-14: Addressed Claude review on PR #23: retained three omitted installed models, specified dual-unavailability/fallback gate/self-fallback semantics, distinguished required rejection from optional disclosed retrieval degradation; expanded fixtures to 51. Checks and review response recorded in #21.

- 2026-10-14: Claude re-review confirms prior findings resolved. Corrected residual portfolio-table omission with explicit rows for the three pre-existing unused models; no model bindings changed. Two diagnostic gaps are addressed separately under #24.
