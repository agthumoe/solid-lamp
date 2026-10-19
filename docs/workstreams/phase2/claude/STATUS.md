# Claude workbench — Phase 2

Read [workbench rules](../../README.md), the brain plan `docs/specs/brain.md` and its review `docs/reviews/phase2-plan-pr85.md` ([PR #85](https://github.com/agthumoe/solid-lamp/pull/85), not yet merged). Board: epic [#4](https://github.com/agthumoe/solid-lamp/issues/4). This file is Claude's handoff; canonical STATUS/PLAN are updated by the integrating session after merges.

## Claim protocol

One agent per issue. Claim by adding `agent:claude` (or `agent:codex`) and switching `status:ready` → `status:in-progress`, with a comment naming the branch and worktree. Each issue gets its own worktree under `/tmp/aetherion-workbenches/phase2-claude-<issue>`. PRs are opened for review and are not merged by the authoring agent unless the owner says so.

## Now

| Issue                                                   | Task                                           | Branch                                    | Worktree                                      | State       |
| ------------------------------------------------------- | ---------------------------------------------- | ----------------------------------------- | --------------------------------------------- | ----------- |
| [#86](https://github.com/agthumoe/solid-lamp/issues/86) | P2-0 template-literal relative-import lint fix | `fix/86-template-literal-relative-import` | `/tmp/aetherion-workbenches/phase2-claude-86` | PR open     |
| [#87](https://github.com/agthumoe/solid-lamp/issues/87) | P2-1 recovery gate                             | `feat/87-recovery-gate`                   | `/tmp/aetherion-workbenches/phase2-claude-87` | in progress |

## Next

Unclaimed and unblocked: #88 path boundary, #89 parsing, #90 chunker, #92 worker. Blocked: #91 and #94 on ADR 0006 acceptance; #99 on owner D1/D2.

## Blocked

| Blocker                                       | Route                             |
| --------------------------------------------- | --------------------------------- |
| ADR 0006 is proposed, not accepted (#91, #94) | Owner/reviewer decision on PR #85 |
| Real-vault access (D2) not approved (#99)     | Owner                             |

## Session log

| Date       | Session     | Summary                                                                                                                                                                                                                                                                     |
| ---------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-10-18 | Claude Code | Committed Codex's plan review/ADR 0006 to PR #85. Opened #86–#99 from the revised breakdown with blocked states; created `agent:*` labels; claimed #86 and #87. #86: `cross-workspace-relative` now uses `staticSpecifier()`, with a regression that fails on the old rule. |
