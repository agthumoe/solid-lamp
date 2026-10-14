# Claude and Codex workbenches

**Active work: [Round 2 assignments and Claude prompt](round2/README.md).** Round 1 below is complete and retained as history; do not start new tasks in its old branches/worktrees.

Coordination: [#19](https://github.com/agthumoe/solid-lamp/issues/19). Parent design: [domain-agent plan](../specs/domain-agent-plan.md). A workbench here means an isolated Git worktree, checked out on its own branch; it does not claim to switch an editor's UI mode. The user launches Claude; no Claude session has been started automatically.

## Two independent deliverables

| Owner / task                                                                                                | Branch                             | Worktree                            | Exclusive authored paths                        |
| ----------------------------------------------------------------------------------------------------------- | ---------------------------------- | ----------------------------------- | ----------------------------------------------- |
| Claude: [#20](https://github.com/agthumoe/solid-lamp/issues/20), specialist evidence and domain eval design | `docs/20-claude-domain-evaluation` | `/tmp/aetherion-workbenches/claude` | `docs/workstreams/claude/**`, `evals/domain/**` |
| Codex: [#21](https://github.com/agthumoe/solid-lamp/issues/21), catalog/routing/scheduling contract design  | `docs/21-codex-routing-design`     | `/tmp/aetherion-workbenches/codex`  | `docs/workstreams/codex/**`, `evals/routing/**` |

Both begin from the merged coordination commit. Temporary worktree paths are local checkouts, not backups; committed/pushed branches are durable. Do not clean `/tmp/aetherion-workbenches` while either task is active. Worktree isolation separates files/indexes, but branches still share Git objects/refs and both agents still share host services.

Claude owns source/license evidence, domain-case answers, citation/effective-date rules and review rubrics. Codex owns catalog status/binding definitions, deterministic intent selection, scheduler/fallback contracts and cross-domain decision cases. Neither task depends on the other being merged first; both consume the frozen [boundary contract](CONTRACT.md). These are Phase 0 design/evaluation-preparation tasks. Runtime packages, downloads and real-data evaluation are later tracked work, behind existing phase/adoption gates.

## Isolation rules

1. Before every edit/commit, check `pwd`, `git branch --show-current` and `git status --short`. Stop if the worktree/branch is not the assigned one. Do not use the original checkout for either task; do not switch the other worktree's branch.
2. Write only inside the owned paths above. Both read all canonical instructions and specs. Shared files are read-only: `AGENTS.md`, `docs/STATUS.md`, `docs/PLAN.md`, `docs/TRACKING.md`, `docs/workstreams/README.md`, `docs/workstreams/CONTRACT.md`, existing specs/ADRs, `config/**`, `scripts/**`, `package.json`, lockfile, Makefile and CI. Request shared changes in an issue comment; the integration owner applies them separately.
3. Each agent updates its own [STATUS](claude/STATUS.md)/[PLAN](claude/PLAN.md) or [STATUS](codex/STATUS.md)/[PLAN](codex/PLAN.md), including Now/Next/Blocked/session log. This is the parallel-session handoff required by AGENTS. The integration owner updates canonical STATUS/PLAN after merges. No conflicting edits to shared handoffs.
4. Dependencies install per worktree with `pnpm install --frozen-lockfile` (offline if cached); do not share a writable `node_modules` symlink or change the lockfile. Run `pnpm check` in that worktree, and validate new fixture syntax/counts and manual rubric/contract coverage separately. Existing CI does not yet score new domain/routing fixtures or domain competence.
5. Format only owned files (`pnpm exec prettier --write` with explicit paths). Before commit inspect `git diff --name-only` and `git diff --cached --name-only`; any path outside ownership must be removed from this task or raised for integration. Do not run blanket repository format fixes on unrelated files.
6. Push only your assigned branch; open a PR with the task, owned scope, evidence and checks. No direct main pushes, shared-branch edits, other-task cherry-picks, force pushes or automatic merging of the other agent's PR. Finish one coherent task; keep later production implementation separately tracked.
7. No live Ollama/model pull/unload/bench in these initial tasks. Future live tasks must hold an exclusive host-wide lease before any GPU mutation: use `flock -n /tmp/aetherion-ollama-workbench.lock` around the full command, post start/finish in #15, check for existing benchmark processes and coordinate other clients. Advisory flock protects only cooperating callers; an idle check and user/other-client coordination are still required. Branches cannot isolate the GPU, Docker, ports or model store. Preserve all models.

## Integration owner and sequence

Codex is the integration owner after both task PRs are ready. It performs shared-file updates only on a separate `docs/<integration-issue>-workbench-integration` branch/worktree after creating/selecting that issue. Task #21 does not authorize shared-file changes in its workbench.

Review PR path ownership and boundary compatibility, then merge independently with required CI (Claude then Codex is the preferred order, but either order works). If main advances, merge `origin/main` into the task branch in its own worktree, inspect the diff and rerun checks; never resolve conflicts in the other checkout. Branch protection may require an up-to-date base even when authored paths do not overlap. Update canonical progress, adoption blockers and subsequent child tasks in the integration PR. Contract changes need an integration task and both workstream acknowledgments before dependent work uses the new version.

## Claude handoff (copy/paste)

```text
Work on Aetherion OS GitHub task #20 only:
https://github.com/agthumoe/solid-lamp/issues/20

Use the existing isolated Git worktree:
cd /tmp/aetherion-workbenches/claude
git branch --show-current
Expected branch: docs/20-claude-domain-evaluation
Do not work in /home/agthumoe/projects/solid-lamp or the Codex worktree.

Read AGENTS.md, docs/STATUS.md, docs/PLAN.md, docs/development/README.md,
docs/development/ai.md, docs/workstreams/README.md,
docs/workstreams/CONTRACT.md, and your own STATUS/PLAN.
Read docs/specs/domain-agent-plan.md and domain-model-research.md.

Deliver specialist license/provenance research and US/Texas legal,
financial/investment and accounting evaluation design under #20.
Write only docs/workstreams/claude/** and evals/domain/**.
Use synthetic cases, at least 40 answerable and 20 adversarial/unanswerable
per domain, with expected evidence/calculations and manual review rubrics.
Keep unresolved licensing/quality explicit. Retain every existing model.
No active config, dependencies, runtime packages, shared docs, downloads,
GPU calls or phase advancement. Update only your own STATUS/PLAN handoff.
Install pinned dependencies in your worktree, run pnpm check and validate
fixtures/counts, commit/push your branch and open a PR. Do not merge it.
Record checks and blockers in #20; request shared changes through the issue.
```
