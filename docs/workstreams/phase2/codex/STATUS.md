# Codex workbench — Phase 2

Issue: [#90](https://github.com/agthumoe/solid-lamp/issues/90), claimed `agent:codex`, `status:in-progress`. Branch `feat/90-heading-aware-chunker`; worktree `/tmp/aetherion-workbenches/phase2-codex-90`.

## Now

Implementation PR #105 is merged with passing required CI on an up-to-date head. The owner authorized review fixes, publication and clean merges. Public package/quality-gate integration is tracked in [#107](https://github.com/agthumoe/solid-lamp/issues/107); 61 combined brain tests and full `pnpm check` pass. #90 remains in progress for empirical token calibration against measured embedding counts. No real data, model, DB or shared-service changes. Claude retains source, recovery and worker ownership.

## Next

#90 remains in progress for empirical token calibration against measured embedding counts. Use #107 public exports and root brain tests after integration delivery. Keep the GitHub claim and coordinate any fixture/GPU/runner work before touching shared resources.

## Blocked

Live token calibration requires a separately coordinated GPU run; this task provides the pure calibration helper and synthetic checks. No real-data approval is needed for the current scope. Shared package bootstrap/test wiring is an integration request, not an edit in Claude's worktree.

## Session log

| Date       | Agent | Summary                                                                                                                                                                                                                                       |
| ---------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-10-18 | Codex | Inspected GitHub claims, PRs and worktrees; confirmed Claude owns #86/#87. Claimed #90 and posted exclusive paths/worktree before edits. Created isolated worktree at 3304897 and wrote the implementation contract before application files. |

| 2026-10-18 | Codex | Implemented exact-slice heading/paragraph chunking, line locators, bounded overlap/Unicode handling and offline token calibration. New tests 21/21 and full pnpm check pass. Added the optimistic-estimate overlap regression and 80 mixed-script invariant cases. All authored paths remain in the claim allowlist; shared package/bootstrap/root files and Claude worktrees untouched. No live model calibration, service changes, commit/push/merge or real-data access. |

| 2026-10-19 | Codex | Owner authorized publishing, addressing reviews and merging clean PRs. Refreshed main and kept this task isolated from Claude. Real-data, proposed ADR and final phase gates are unchanged. |

Integration follow-up: [#107](https://github.com/agthumoe/solid-lamp/issues/107) wires package/public exports and all brain suites into root checks. Combined public-contract verification passes 61/61 tests and full `pnpm check`; no real-vault, model, DB or shared-service changes. PRs: parser #104, chunker #105, scorer #106 (merged). #89 fixture-source materialization, #90 measured embed-token calibration and #98 final safety gate remain pending.
