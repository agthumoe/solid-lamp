# Evaluation scoring handoff — #98

Branch `feat/98-brain-eval-scoring`; worktree `/tmp/aetherion-workbenches/phase2-codex-98`; base 3304897. Issue [#98](https://github.com/agthumoe/solid-lamp/issues/98) stays `agent:codex`, `status:in-progress`. Publishing this independent scoring slice under the owner’s review-and-merge authorization; the complete pre-vault gate remains pending.

Delivery update: PR #106 merged with passing current-main CI. #107 supplies public exports, exact dependency declarations and broad root brain-test wiring; combined tests pass 61/61. #98 remains in progress for its actual search runner and complete safety gates; fake scores never establish readiness.

## Implemented

`packages/brain/src/evaluation/index.ts` exports `scoreBrainEvaluation`, `validateEvaluationRun` and their types. Inputs are strict schema-validated runs with frozen identity labels and separated calibration/held-out questions. Metrics use distinct chunk IDs and verified exact source/path/heading matches. Errors/incomplete states never become correct abstentions; duplicate/missing observations cannot silently change denominators. Aggregate output omits private question/citation data. Undefined metrics stay null. Fake/degraded evidence cannot certify semantic recall, and no score establishes Phase 2 acceptance.

`evals/brain/evaluation/known-run.json` has hand-calculated fake scores. The private-question template is synthetic and must be copied only to an owner-private, existing git-ignored location (`backups/brain-evals/questions.json`) after real-data approval and the complete gates. The template is question data, not an executable run. No source was read for it.

## Integration requests and pending gates

Package bootstrap declares the existing exact `zod@4.6.7` dependency and exports this module via `@aetherion/brain`; no consumer deep-imports this directory. Reuse PR #102's proposed broad `test:brain` root/Makefile wiring once its reader findings are fixed; do not create duplicate root-script edits. Until integration, run the new suite directly.

The future search runner must establish provenance, bind frozen profiles/thresholds, supply actual ordered observations and independently verify citations. This helper trusts input labels/verification flags; it cannot independently prove that they came from a real model. Semantic retrieval/latency and the full pre-vault gate remain pending: #95 search; #91/#94 version/revision work (ADR 0006 blocked); #87 recovery fixes/final-schema restore; race, restart, Redis loss and coordinated live synthetic model/long-chunk runs. D1/D2 remain required before any real-vault data. No gate is bypassed by the scorer.

## Checks

- `node --test 'packages/brain/src/evaluation/*.test.ts'`: **14/14 pass**, none skipped.
- Full `pnpm check` passes in this worktree with loopback access for existing tests. The new evaluation tests were run separately because the base root script has no brain suite.
- `git check-ignore backups/brain-evals/questions.json` confirms the private destination is already ignored.
- Authored paths are limited to evaluation module/fixtures and this handoff directory. Root scripts/lockfile/CI/canonical handoffs, parser/chunker/source-reader paths, Claude worktrees, DBs/GPU/host services and real data were unchanged.

## Review work completed alongside this slice

[PR #102 findings](review-pr102.md) were independently reproduced and posted. Earlier parser handoff records PR #100's clean review and PR #101's two findings. Claude owns recovery/source fixes; Codex has not edited them.
