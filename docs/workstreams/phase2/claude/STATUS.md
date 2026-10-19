# Claude workbench — Phase 2

Read [workbench rules](../../README.md), the brain plan `docs/specs/brain.md` and its review `docs/reviews/phase2-plan-pr85.md` ([PR #85](https://github.com/agthumoe/solid-lamp/pull/85), not yet merged). Board: epic [#4](https://github.com/agthumoe/solid-lamp/issues/4). This file is Claude's handoff; canonical STATUS/PLAN are updated by the integrating session after merges.

## Claim protocol

One agent per issue. Claim by adding `agent:claude` (or `agent:codex`) and switching `status:ready` → `status:in-progress`, with a comment naming the branch and worktree. Each issue gets its own worktree under `/tmp/aetherion-workbenches/phase2-claude-<issue>`. PRs are opened for review and are not merged by the authoring agent unless the owner says so.

## Now

| Issue                                                   | Task                                           | Branch                                    | Worktree                                      | State        |
| ------------------------------------------------------- | ---------------------------------------------- | ----------------------------------------- | --------------------------------------------- | ------------ |
| [#86](https://github.com/agthumoe/solid-lamp/issues/86) | P2-0 template-literal relative-import lint fix | `fix/86-template-literal-relative-import` | `/tmp/aetherion-workbenches/phase2-claude-86` | PR open      |
| [#87](https://github.com/agthumoe/solid-lamp/issues/87) | P2-1 recovery gate                             | `feat/87-recovery-gate`                   | `/tmp/aetherion-workbenches/phase2-claude-87` | PR #101 open |

## Next

Codex holds #89 (parsing) and #90 (chunker). Next for whoever is free: #93 watcher (after #88/#92 merge). #95–#98 wait on #91/#94 (ADR 0006). Follow-up after #89/#90/#91: wire the worker handler bodies (currently `NOT_WIRED`). Blocked: #91 and #94 on ADR 0006 acceptance; #99 on owner D1/D2.

## Blocked

| Blocker                                       | Route                             |
| --------------------------------------------- | --------------------------------- |
| ADR 0006 is proposed, not accepted (#91, #94) | Owner/reviewer decision on PR #85 |
| Real-vault access (D2) not approved (#99)     | Owner                             |

## Session log

| Date       | Session     | Summary                                                                                                                                                                                                                                                                             |
| ---------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-10-18 | Claude Code | Committed Codex's plan review/ADR 0006 to PR #85. Opened #86–#99 from the revised breakdown with blocked states; created `agent:*` labels; claimed #86 and #87. #86: `cross-workspace-relative` now uses `staticSpecifier()`, with a regression that fails on the old rule.         |
| 2026-10-18 | Claude Code | #87 recovery gate: `db:backup`/`db:restore-verify` with checksum, target safety, manifest compare and retention; integration tests on pgvector and the Supabase image; found and fixed the Supabase default-ACL restore failure. PR #101.                                           |
| 2026-10-18 | Claude Code | Mistakenly labelled #89 while Codex held it (a chained command didn't stop on the existing claim); reverted within a minute (label removed, comment deleted). Claims are now checked in a separate step. #88: sources config + fail-closed verified reader with race test; PR #102. |
| 2026-10-18 | Claude Code | #92 worker skeleton: BullMQ runtime, contracts, processor, outbox relay port, health, drain; Redis integration tests + CI Redis service; bullmq pinned 6.3.10 (release age), msgpackr-extract build disallowed. PR #103.                                                            |
