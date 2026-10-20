# Parser integration handoff — #89

Branch `feat/89-brain-parsing`, worktree `/tmp/aetherion-workbenches/phase2-codex-89`, base 3304897. Publishing under the owner’s current review-and-merge authorization. Issue [#89](https://github.com/agthumoe/solid-lamp/issues/89) remains `agent:codex`, `status:in-progress` for review/integration.

Delivery update: PR #104 merged with passing current-main CI. #107 supplies public exports, exact dependency declarations and broad root brain-test wiring; combined tests pass 61/61. #89 remains in progress for configured synthetic fixture-source materialization/integration.

## Public contract to wire

The module entry `packages/brain/src/parsing/index.ts` exports `parseNote`, `resolveNoteLinks` and their types. Integration must expose them through the package root; no consumer should deep-import this directory. The package bootstrap owner must declare exact `yaml@2.8.4` and `zod@4.6.7` dependencies (already installed at the root here), update the lockfile, and reuse PR #102's proposed broad root brain-test/Makefile wiring after #86 and the source-reader fixes land. No shared bootstrap files were changed in this task.

`parseNote` validates an unknown input `{ sourceId, path, text }` and returns a typed note or generic failure code. `{ body, bodyStartLine }` can be passed directly to chunker #90; original source UTF-16 link spans also include the frontmatter offset. Invalid frontmatter yields warnings without quoting raw input. Ingestion must count/report warnings, including bounded/incomplete Markdown extraction; no warning is proof of full coverage.

`resolveNoteLinks` accepts a source-scoped document/attachment index supplied by ingestion and returns explicit resolved/unresolved/ambiguous states. It resolves document identity, not proof that a heading/block locator exists. Later citation retrieval must validate the requested revision and locator. The function does lexical path validation only; #88 must validate actual files and containment before reading them. No reader/file fallback or model/tool execution is provided.

## Fixtures and verification

Forty invented notes live under `evals/brain/parser/`, with virtual note paths and expected metadata/link outputs in the manifest. Their raw bytes use `.md.fixture` filenames so formatter tools cannot repair intentionally invalid YAML or normalize the CRLF case; tests map virtual `Note.md` to `Note.md.fixture`. Later ingestion tests may materialize these into their own temporary vault.

- Direct parser suite: `node --test 'packages/brain/src/parsing/*.test.ts'` — **25/25 pass**, none skipped.
- Full `pnpm check` passes with loopback access for the existing RPC tests. The new parser suite was run separately because current root test wiring has no brain suite yet.
- Documentation/format checks pass; authored paths stay within parsing, parser fixtures and this handoff directory. No root scripts, manifest/lockfile, CI, canonical handoffs, #90 files or Claude worktrees were changed.

Supported syntax is bounded Obsidian frontmatter/wikilinks/tags/code masking, not a full CommonMark AST. No semantic retrieval scores, live token calibration, real-vault reads, DB/host-service changes or acceptance/ADR approvals are implied.

## Claude review results

[PR #100](review-pr100.md): no actionable findings at 5bddaef; later 90ae909 changes only Claude's handoff. Review posted to the PR.

[PR #101](review-pr101.md): two findings at 8c014f1, reported to the PR: verify SQL/Docker instance identity before writes (P1), and prevent same-second backup overwrite (P2). Unit tests pass; synthetic reproductions use temporary files and a fake Docker executable, not real databases. Claude retains ownership of both fixes and source-boundary #88.
