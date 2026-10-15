# Round 3: Phase 0 owner decision packets

Coordination: [#40](https://github.com/agthumoe/solid-lamp/issues/40). The round-two outputs are integrated in [PR #39](https://github.com/agthumoe/solid-lamp/pull/39). Phase 0 remains open; #31 remains blocked on owner adoption choices and candidate-specific evidence.

## Assignments

| Owner  | Task                                                                                                 | Branch                                  | Worktree                                   | Authored paths                      |
| ------ | ---------------------------------------------------------------------------------------------------- | --------------------------------------- | ------------------------------------------ | ----------------------------------- |
| Codex  | [#41 role and hardware decision packet](https://github.com/agthumoe/solid-lamp/issues/41)            | `chore/41-codex-phase0-decision-packet` | `/tmp/aetherion-workbenches/round3-codex`  | `docs/workstreams/round3/codex/**`  |
| Claude | [#42 domain candidate and adoption gate checklist](https://github.com/agthumoe/solid-lamp/issues/42) | `docs/42-claude-domain-gate-checklist`  | `/tmp/aetherion-workbenches/round3-claude` | `docs/workstreams/round3/claude/**` |

Both task branches start from merged main `e7f3bd0b5d8d3a8239ca232a5e93e7e4ad3d786f`. Worktrees are isolated and already prepared. Shared docs, config, source fixtures, scripts, dependencies and the other agent's path are read-only.

## Why these tasks

The next stage needs owner decisions on enabled bindings, accepted license residuals, evaluation scope and personal/business accounting. The two packets organize existing evidence into explicit choices. They do not perform live evaluations or advance the phase. #31 stays blocked until the owner accepts its candidate-specific gates; Phase 1 #3 remains behind Phase 0 acceptance.

## Shared rules

Read root `AGENTS.md`, `docs/STATUS.md`, `docs/PLAN.md`, handbook delivery/AI guides, the round-two merged artifacts and your task issue before editing. Verify worktree, branch and clean status. Keep work to your allowlist and own `STATUS.md`/`PLAN.md`. Do not download, convert or install models; call Ollama/GPU; contact publishers; change host services; or enable models. No new benchmarks. Commit/push only your assigned branch, open an unmerged PR linked to the task, and record evidence in its issue. Do not merge.

Each task runs `pnpm docs:check` and `pnpm format:check`. Cross-review both packets after delivery. Shared/canonical progress is reconciled only on a separately tracked integration branch after review.

## Claude handoff (copy/paste)

```text
Work only on task #42:
https://github.com/agthumoe/solid-lamp/issues/42

Use the assigned isolated worktree:
cd /tmp/aetherion-workbenches/round3-claude
git branch --show-current
Expected: docs/42-claude-domain-gate-checklist
Confirm git status is clean before editing. Do not use the original checkout or Codex's worktree.

Read AGENTS.md, docs/STATUS.md, docs/PLAN.md, docs/development/README.md,
docs/development/ai.md, docs/development/delivery.md,
docs/workstreams/round3/README.md and CONTRACT.md, and your own STATUS/PLAN.
Read the merged artifact dossier and candidate records, domain-agent plan,
ADR 0004, and issues #15, #31 and #40.

Prepare a decision-ready checklist for Saul, CPA-Qwen, Fin-R1 and Qwen3.5-9B.
Separate what existing evidence establishes from what remains unverified:
license chain, GGUF derivation, local artifact/template behavior, domain
quality and runtime profile. Separate evidence from owner choices, including
license-residual acceptance, Fin-R1's unresolved license, personal/business
accounting scope, source/data scope, qualified review, and the gates for
starting #31. State the minimum evidence required before acquisition, live
comparison, adoption and activation. Do not provide legal advice or imply
planning status is approval. Link claims to existing primary-source records;
flag stale or missing citations instead of inventing facts.

Write only docs/workstreams/round3/claude/**. Keep canonical docs, artifact
records, fixtures, config, scripts, dependencies and Codex files read-only.
No model/GPU calls, downloads, conversion, installation, publisher contact,
host changes or phase advancement. Update your own STATUS.md and PLAN.md.
Run pnpm docs:check and pnpm format:check, inspect ownership, commit and push
only this branch, open an unmerged PR, and record evidence in #42.
Do not merge. Request any shared change in #42.
```
