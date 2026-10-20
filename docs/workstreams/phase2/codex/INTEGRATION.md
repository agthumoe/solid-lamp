# Integration handoff for #90

Task: [#90](https://github.com/agthumoe/solid-lamp/issues/90). Branch `feat/90-heading-aware-chunker`; worktree `/tmp/aetherion-workbenches/phase2-codex-90`; base `3304897` (the reviewed plan branch). Publishing this independently verified implementation under the owner’s review-and-merge authorization. The task stays `agent:codex`, `status:in-progress` for review/integration.

## Owned deliverable

`packages/brain/src/chunking/index.ts` exposes `chunkMarkdown`, `CHUNKER_VERSION`, `estimateTokens`, `utf8Bytes`, `calibrateTokenEstimator` and their types. No dependencies, filesystem, DB or model calls are introduced. See [contract](chunker-spec.md) for inputs, source offset semantics and supported Markdown heading forms.

Parser #89 supplies `{ body, bodyStartLine }`: frontmatter is removed by that parser and `bodyStartLine` is the original 1-based line where the body starts. The chunker preserves the exact body slices and line endings. The ingestion use case must pass context/reserve from its pinned embedding profile; defaults are not role bindings. It must reserve query/document-prefix and special-token overhead and keep adapter `truncate: false` enabled. Calibration consumes measured text/count pairs supplied by integration; no empirical model-calibration claim is made here.

## Shared-file requests (not edited in this task)

1. Merge prerequisite #86 before new brain package imports. This branch does not copy or cherry-pick Claude's lint work.
2. Package bootstrap owner adds the brain manifest/public root entry and exports the chosen chunker API through `@aetherion/brain`; consumers must not deep-import this directory. This module needs no new external dependency.
3. Add `test:brain` to the root test sequence and Makefile mirror (or extend the agreed brain-suite script) so the suite runs in CI. Until then, the existing `pnpm check` does not execute new brain tests, though typecheck/lint include them.
4. Review source-parser offset compatibility and run real token calibration later under exclusive GPU coordination. The calibration sample set must match the pinned profile/prefix accounting; no role/context binding changes are part of this task.
5. Integrate canonical STATUS/PLAN only in the integration owner's branch. No file in another agent's worktree needs modification to consume this handoff.

## Evidence

- `node --test 'packages/brain/src/chunking/*.test.ts'`: 21 tests pass, none skipped. Includes 80 deterministic mixed-script property cases within one test, plus an overlap-growth regression for optimistic token estimates.
- `pnpm check`: full existing repository gates pass in this isolated worktree with loopback access. The direct new suite above was run separately.
- No root/lockfile/CI changes; all authored files are under `packages/brain/src/chunking/**` or `docs/workstreams/phase2/codex/**`.
- Supported headings: ATX and single-line setext; fenced/four-space-indented code is excluded from heading detection. This is not a full CommonMark parser. Unicode scalar boundaries and CRLF pairs are preserved; grapheme clusters may cross chunks but exact source offsets remain intact.
- Live GPU calibration, real-vault acceptance and profile/revision schema work remain outside this deliverable. No host service or source data was changed.
