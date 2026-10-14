# GitHub plan and progress

Repository: https://github.com/agthumoe/solid-lamp. Task tracking uses issues/phase milestones; STATUS and PLAN summarize facts and handoffs. See [delivery standards](development/delivery.md).

| Phase / work                                     | GitHub task                                             | Status / dependency                                                                                                   |
| ------------------------------------------------ | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Handbook, project skills and initial publication | [#1](https://github.com/agthumoe/solid-lamp/issues/1)   | Delivered; pushed baseline and green CI, final evidence in the issue                                                  |
| 0 — Models and acceptance                        | [#2](https://github.com/agthumoe/solid-lamp/issues/2)   | Owner model decision and benchmark follow-up                                                                          |
| 1 — Scaffold/foundations                         | [#3](https://github.com/agthumoe/solid-lamp/issues/3)   | Blocked by Phase 0/go-ahead                                                                                           |
| 2 — Brain/recovery                               | [#4](https://github.com/agthumoe/solid-lamp/issues/4)   | Phase 1                                                                                                               |
| 3 — Agents/API/approvals                         | [#5](https://github.com/agthumoe/solid-lamp/issues/5)   | Phase 2                                                                                                               |
| 4 — Dashboard/frontend                           | [#6](https://github.com/agthumoe/solid-lamp/issues/6)   | Phase 3                                                                                                               |
| 5 — Graph/workflows                              | [#7](https://github.com/agthumoe/solid-lamp/issues/7)   | Phase 4                                                                                                               |
| 6 — Background/WhatsApp                          | [#8](https://github.com/agthumoe/solid-lamp/issues/8)   | Phase 5                                                                                                               |
| 7 — Domain agents                                | [#9](https://github.com/agthumoe/solid-lamp/issues/9)   | Phase 6; one agent spec/task at a time                                                                                |
| 8 — Operational hardening                        | [#10](https://github.com/agthumoe/solid-lamp/issues/10) | Phase 7                                                                                                               |
| Handbook compliance enforcement                  | [#13](https://github.com/agthumoe/solid-lamp/issues/13) | PR #14; current quality gates pass (19 regression groups); main protection verified; final merge/CI evidence in issue |
| CI bootstrap refresh                             | [#12](https://github.com/agthumoe/solid-lamp/issues/12) | Official Node 24 action revisions and Ubuntu 24.04 pinned; CI evidence in issue                                       |
| Remaining benchmark acceptance/CLI findings      | [#11](https://github.com/agthumoe/solid-lamp/issues/11) | Fixed by #13; regression tests and required CI verify acceptance                                                      |

Each phase has its own GitHub milestone. Split an epic into bounded implementation tasks before starting its phase; each child needs acceptance and tests. These tasks are plans, not claims that the application features are implemented. Changing task status or resolving owner decisions must also update the local handoff.

## Retained portfolio and domain workflow tasks

- [#17](https://github.com/agthumoe/solid-lamp/issues/17): deliver [domain-agent plan](specs/domain-agent-plan.md) and ADR 0004; planning only.
- [#15](https://github.com/agthumoe/solid-lamp/issues/15): license/provenance, local compatibility and comparative domain evaluation; remains open until evidence passes.
- Foundation/source/orchestration implementation attaches to #3/#4/#5; domain-agent child tasks attach to #9 after preceding phase gates. All existing model artifacts/roles are retained; activation is separately gated.

## Parallel workbenches

- [#19](https://github.com/agthumoe/solid-lamp/issues/19): coordination/setup only; [ownership and Claude handoff](workstreams/README.md).
- [#20](https://github.com/agthumoe/solid-lamp/issues/20): Claude specialist research/domain evaluation design; delivered in merged PR #26, review resolved.
- [#21](https://github.com/agthumoe/solid-lamp/issues/21): Codex catalog/routing/scheduler design; delivered in merged PR #23, reviews resolved.
- Runtime implementation/live evaluation remain separately tracked and phase-gated. Shared-file integration requires its own issue/branch.

- [#24](https://github.com/agthumoe/solid-lamp/issues/24): Phase 0 routing fixture integrity diagnostics; merged PR #25, reviews resolved; 51 routing cases and 15 diagnostic groups.

## Combined-main audit and remaining evaluation tasks

- [#29](https://github.com/agthumoe/solid-lamp/issues/29): merged-main audit and shared handoff reconciliation; no runtime/config/model changes.
- [#30](https://github.com/agthumoe/solid-lamp/issues/30): domain schema-v2 fixture diagnostics; ready, no model run required.
- [#31](https://github.com/agthumoe/solid-lamp/issues/31): artifact pinning and local comparison; gated by per-candidate provenance/license/scope and qualified review. #15 remains open.
- Review #27/PR #28 is merged; all reviewed PRs #23/#25/#26/#28 are integrated. Historical task-local handoffs retain their delivery-time snapshots.

## Active round 2

[Assignments/ownership and Claude prompt](workstreams/round2/README.md), [boundary v1](workstreams/round2/CONTRACT.md). Setup #33; Codex #30 implements domain fixture diagnostics; Claude #34 prepares artifact readiness under #31. Both ready, own worktrees; root scripts belong to Codex only. Live #31 stays gated. Cross-review before separate tracked integration.
