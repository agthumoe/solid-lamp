# Round 2: domain diagnostics and model readiness

Coordination [#33](https://github.com/agthumoe/solid-lamp/issues/33). Previous round is merged and audited (#29/PR #32). These assignments replace round 1 for new work; old worktrees/hand-offs are historical. Workbench means a dedicated Git worktree on its own branch. The user launches Claude; no Claude session has been started by this setup.

## Assignments

| Owner / task                                                                                  | Branch                              | Worktree                                   | Writable tracked paths                                                                                                                                                |
| --------------------------------------------------------------------------------------------- | ----------------------------------- | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Codex [#30](https://github.com/agthumoe/solid-lamp/issues/30): domain fixture diagnostics     | `chore/30-codex-domain-integrity`   | `/tmp/aetherion-workbenches/round2-codex`  | `scripts/domain-evals/**`, `docs/specs/domain-fixture-integrity.md`, `docs/workstreams/round2/codex/**`, `package.json` scripts only, `Makefile` command mirrors only |
| Claude [#34](https://github.com/agthumoe/solid-lamp/issues/34): artifact/evaluation readiness | `docs/34-claude-artifact-readiness` | `/tmp/aetherion-workbenches/round2-claude` | `docs/workstreams/round2/claude/**`, `evals/artifact-readiness/**`                                                                                                    |

Both start from the merged #33 setup commit. Task #30 owns root command integration, so Claude cannot modify root scripts even to add a check. Do not share writable node_modules; install existing pinned dependencies per worktree with frozen lockfile (offline if cached). Temporary checkouts are not backups; push commits to the assigned branch and do not remove the directories while work is active.

## Codex deliverable

Write the owned spec before implementation. Add strict schema-v2 domain suite/manifest validation, reference and policy consistency, optional/required claim structure, exact journal balances/account references and negative regression tests. Never execute formula text or claim that integrity checks prove substantive domain truth. Wire diagnostic/test commands into pnpm check and Makefile. Read fixtures unchanged: baseline has 180 cases, 82 calculation cases, 32 entry cases and 28 abstentions. Keep count expectations tied to the versioned manifest and approved baseline; don't silently regenerate golden answers. Existing 51 routing cases/34 regression groups must continue to pass.

No dependency/version/lockfile changes, production runtime code, fixture edits, model calls or phase advancement. Shared canonical STATUS/PLAN updates happen only during integration, not inside #30. Its own scoped spec is the only exception to shared spec read-only rules.

## Claude deliverable

Prepare a source-linked readiness dossier for Saul, CPA-Qwen, Fin-R1 and the Qwen baseline. Identify immutable upstream revisions, license/provenance status, GGUF/convert/import candidates and hashes when verifiable, template/prompt-v2 compatibility, token-budget requirements, production-profile residency/swap test requirements and per-candidate blocker/acceptance matrix. Unknown values stay null/pending; distinguish publisher license declaration from complete accepted chain, and available artifact from locally validated artifact.

Use primary-source metadata/document reads; no publisher contact, credentials, weight download, conversion, install or live Ollama/GPU calls. Preserve all installed/planned models. Claude's work is a readiness child under #31/#15, not execution of the blocked live comparison. Do not claim adoption merely because this dossier is complete. Open follow-up requests in #34 when shared changes are needed.

## Isolation and handoffs

Before edits/commits check pwd, branch and status. Stop if they don't match your assignment. Read AGENTS, canonical STATUS/PLAN, the handbook/AI/delivery guides, [boundary v1](CONTRACT.md) and your own STATUS/PLAN. Write only in the table's allowlist; each agent formats only owned files. Shared `config/**`, fixtures under `evals/domain/**` and `evals/routing/**`, dependency declarations/lockfile, existing scripts, existing specs/ADRs, AGENTS and canonical handoffs are read-only. Neither task edits the other agent's path or round-1 handoffs.

Update `docs/workstreams/round2/<agent>/STATUS.md` and PLAN.md every session. This satisfies the parallel handoff rule; the integration owner updates canonical progress in a separate tracked PR. Keep evidence and blockers in your issue. Mark your issue in progress only when work starts. Before commit inspect both unstaged/staged changed paths, exclude credentials/private/generated model data, run owned checks and pnpm check, then push only the assigned branch and open a PR. Do not merge your PR or the other agent's PR, force-push, switch the other worktree's branch or write directly to main.

Both initial tasks are CPU/read-only metadata work. Neither calls Ollama, unloads models or occupies the shared GPU. Future live work under #31 still needs scoped acceptance and a whole-operation host lease, idle checks and coordination (flock is advisory and doesn't isolate uncooperative clients). It uses the active embedding version and separate measured production-profile evidence. No host RAM/ports/system changes are implied.

## Review and integration

Both PRs can be reviewed independently: Codex reviews Claude's dossier, Claude reviews Codex's validator using corrupted synthetic copies. Corrections stay in their owned branches. After both are ready, create/select an integration issue and a new isolated integration branch. Merge only reviewed PRs with required checks, update/retest the second branch if main advances, and reconcile canonical handoffs/tracking and any shared-change requests in that integration PR. No cherry-picks from the other task. The frozen contract changes only through coordinated integration with both workstreams acknowledging it.

Acceptance for this setup: assignments/tasks exist, two clean branches/worktrees are prepared from the same merged base, boundary/handoffs/prompt are committed and current docs/quality gates pass. Setup does not count as either task's implementation or Phase 0 completion.

## Claude prompt (copy/paste)

```text
Work on Aetherion OS task #34 only:
https://github.com/agthumoe/solid-lamp/issues/34

cd /tmp/aetherion-workbenches/round2-claude
Verify branch: docs/34-claude-artifact-readiness
Check git status before writing. Don't use the old Claude worktree,
the original checkout, or Codex's worktree.

Read AGENTS.md, docs/STATUS.md, docs/PLAN.md, the development handbook,
AI/delivery guides, docs/workstreams/round2/README.md and CONTRACT.md,
and your round2/claude STATUS/PLAN. Read the merged specialist evidence,
prompt-v2 protocol and domain-agent plan.

Prepare the pinned specialist artifact/template/license readiness dossier
and evaluation blocker matrix described by #34. Use primary-source
metadata reads. Write ONLY docs/workstreams/round2/claude/** and
evals/artifact-readiness/**. Keep unknown hashes/permissions pending;
never invent local compatibility or benchmark results. Retain all models.

No weight downloads, conversion/install, Ollama/GPU calls, credentials,
publisher contact, config, source-fixture, dependency or root-file edits.
Codex owns #30 diagnostic implementation and root command integration.
Update only your own handoffs, and request shared changes in #34.

Mark #34 in progress, install existing pinned dependencies if needed,
format only owned files, run pnpm check and owned JSON/reference checks,
inspect ownership, commit/push your branch and open a PR. Record evidence
and blockers in #34. Do not merge. Actual live #31 evaluation remains gated.
```
