# Codex evaluation workbench

Issue [#98](https://github.com/agthumoe/solid-lamp/issues/98), `agent:codex`, `status:in-progress`. Branch `feat/98-brain-eval-scoring`; worktree `/tmp/aetherion-workbenches/phase2-codex-98`, base 3304897.

## Now

Implementation PR #106 is merged with passing required CI on an up-to-date head. The owner authorized review fixes, publication and clean merges. Public package/quality-gate integration is tracked in [#107](https://github.com/agthumoe/solid-lamp/issues/107); 61 combined brain tests and full `pnpm check` pass. #98 remains in progress for its actual search runner and complete safety gates; fake scores never establish readiness. No real data, model, DB or shared-service changes. Claude retains source, recovery and worker ownership.

## Next

#98 remains in progress for its actual search runner and complete safety gates; fake scores never establish readiness. Use #107 public exports and root brain tests after integration delivery. Keep the GitHub claim and coordinate any fixture/GPU/runner work before touching shared resources.

## Blocked

End-to-end retrieval/live-model/latency/race/restart/Redis-loss and final-schema restore gates depend on the corresponding implementation tasks and approvals. Fake scoring cannot replace them. No real-vault or host-service work is authorized by this slice; publication and clean-PR merges are authorized by the current owner request.

## Session log

| Date       | Agent | Summary                                                                                                                                                 |
| ---------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-10-18 | Codex | Confirmed #98 was unclaimed; marked in progress and published scoring-only scope before edits. Created isolated worktree and wrote this contract first. |

| 2026-10-18 | Codex | Implemented and verified scoring slice: 14/14 direct tests and full pnpm check pass; private destination is git-ignored. Reviewed newly completed source PR #102: posted root-swap, excluded-alias and silent depth-truncation findings after synthetic reproductions; existing reader/config tests pass 16/16. No Claude files/services/data were changed. |

| 2026-10-19 | Codex | Owner authorized publishing, addressing reviews and merging clean PRs. Refreshed main and kept this task isolated from Claude. Real-data, proposed ADR and final phase gates are unchanged. |

Integration follow-up: [#107](https://github.com/agthumoe/solid-lamp/issues/107) wires package/public exports and all brain suites into root checks. Combined public-contract verification passes 61/61 tests and full `pnpm check`; no real-vault, model, DB or shared-service changes. PRs: parser #104, chunker #105, scorer #106 (merged). #89 fixture-source materialization, #90 measured embed-token calibration and #98 final safety gate remain pending.
