# GitHub delivery and progress

## Issue-first workflow

Do not write project files before a GitHub task exists. Read-only discovery/research is allowed. Before edits, create or select an open issue in `agthumoe/solid-lamp`; record the issue link in the spec/PR/session handoff. If GitHub is unavailable, continue read-only investigation and report the dependency; do not create untracked implementation work. An existing authorized issue can cover related fixes; avoid an issue per file.

Each task states problem/outcome, scope/non-goals, phase/dependencies, acceptance, relevant tests, risk/recovery, and evidence links. Use phase milestones and labels for task type, priority and status. Epics own phase checklists and link concrete work; task progress lives in GitHub, while STATUS/PLAN summarize current facts and next steps. Do not report a task complete merely because its spec exists.

Lifecycle: `status:ready` → `status:in-progress` → `status:blocked` when dependent on an owner/external decision → `status:done` after verified delivery. Keep exactly one current status label. An implementation issue stays blocked by the preceding phase gate until the owner explicitly approves advancing it.

## Branches, commits and PRs

Use `type/<issue>-short-name`, e.g. `docs/1-development-standards`. Future work uses PRs against main with `Refs #N` or `Closes #N` as appropriate. Small coherent commits explain behavior; include the issue number. No force-push/rebase of shared history without authorization. This initial empty-repo publication and its CI bootstrap cleanup (#1/#12) are the explicitly owner-authorized main-branch bootstrap; subsequent changes follow the PR workflow.

Before commit, inspect staged files for accidental secrets, raw source vault data, credentials and generated output. Keep `.env*`, sessions, dumps, credentials and private debug artifacts ignored. Existing hardware/benchmark documentation is intentional project material, not a place for secrets. Third-party vendored skill licenses/provenance must be present.

PR description: problem/result, issue/spec/ADR, relevant validation, migration/recovery impact and material limitations. Review dependency boundaries, component responsibility/size, state owner, hooks cleanup/dependencies, contracts, approval/idempotency, migration locks and redaction. Do not publish a blanket “tests pass” when a command does not exist or was skipped.

## Checks now and later

Current repository: `pnpm check` runs lint, strict typecheck, benchmark/compliance tests, docs/skill checks, source policies and formatting. Tests use stubbed inference and synthetic data. Live Ollama/GPU measurements are explicitly local and separately recorded.

Phase 1: extend the existing required quality commands to the application and add DB migration/schema parity checks. Phase 4 adds frontend component size/lint and Playwright/accessibility checks. Pin CI actions to reviewed full commits; use minimum permissions. Do not run untrusted PR code on a persistent GPU/home self-hosted runner. Public-hosted CI may test synthetic code without model calls; local-only inference remains a runtime constraint.

## Definition of done

Acceptance passes; spec/ADR/contracts are current; relevant regression/integration checks pass; manual checks and skipped checks are named; secrets/private artifacts are excluded; docs/STATUS/PLAN and issue progress match; PR/commit/push verified. For a phase, full available phase checks and owner go-ahead remain required. A migration/restore/external side effect needs its concrete approval and recovery evidence.

Use issue comments for decisions, progress, blockers and evidence. Do not include private notes/logs. Daily handoff names issue numbers, what changed, what was verified and the next dependent action.

Main branch protection enforces the GitHub Actions `compliance` check against an up-to-date base, requires a PR and resolved conversations, applies to administrators, and blocks force pushes/deletion. Single-user review count is zero; manual review evidence remains required. See compliance applicability for the distinction between automated gates and semantic review.
