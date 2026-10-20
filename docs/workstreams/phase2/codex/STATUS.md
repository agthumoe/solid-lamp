# Codex workbench — Phase 2

Issue: [#90](https://github.com/agthumoe/solid-lamp/issues/90), claimed `agent:codex`, `status:in-progress`. Branch `feat/90-heading-aware-chunker`; worktree `/tmp/aetherion-workbenches/phase2-codex-90`.

## Now

Pure heading-aware chunker, token estimation/calibration helper and synthetic tests are implemented under [the task contract](chunker-spec.md). Final verification: 21/21 new tests pass (including 80 deterministic mixed-script coverage cases); full `pnpm check` passes in this isolated worktree with loopback access. The owner has authorized publication and merging clean PRs; publishing this implementation for review/integration; #90 stays in progress. [Results and shared-file requests are posted on the issue](https://github.com/agthumoe/solid-lamp/issues/90#issuecomment-6258534531). Claude's #86/#87, all other tasks, shared root files and canonical STATUS/PLAN are untouched. Scope is `packages/brain/src/chunking/**` and `docs/workstreams/phase2/codex/**` only.

## Next

Review the module and [integration instructions](INTEGRATION.md). Integration owner wires package exports/root test script and merges #86 before new package imports. Publish the implementation, review its exact head and merge only with passing required checks. The task remains reserved to Codex until integration/review completes.

## Blocked

Live token calibration requires a separately coordinated GPU run; this task provides the pure calibration helper and synthetic checks. No real-data approval is needed for the current scope. Shared package bootstrap/test wiring is an integration request, not an edit in Claude's worktree.

## Session log

| Date       | Agent | Summary                                                                                                                                                                                                                                       |
| ---------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-10-18 | Codex | Inspected GitHub claims, PRs and worktrees; confirmed Claude owns #86/#87. Claimed #90 and posted exclusive paths/worktree before edits. Created isolated worktree at 3304897 and wrote the implementation contract before application files. |

| 2026-10-18 | Codex | Implemented exact-slice heading/paragraph chunking, line locators, bounded overlap/Unicode handling and offline token calibration. New tests 21/21 and full pnpm check pass. Added the optimistic-estimate overlap regression and 80 mixed-script invariant cases. All authored paths remain in the claim allowlist; shared package/bootstrap/root files and Claude worktrees untouched. No live model calibration, service changes, commit/push/merge or real-data access. |

| 2026-10-19 | Codex | Owner authorized publishing, addressing reviews and merging clean PRs. Refreshed main and kept this task isolated from Claude. Real-data, proposed ADR and final phase gates are unchanged. |

Integration follow-up: [#107](https://github.com/agthumoe/solid-lamp/issues/107) wires package/public exports and all brain suites into root checks. Combined public-contract verification passes 61/61 tests and full `pnpm check`; no real-vault, model, DB or shared-service changes. PRs: parser #104, chunker #105, scorer #106 (merged). #89 fixture-source materialization, #90 measured embed-token calibration and #98 final safety gate remain pending.
