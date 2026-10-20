# Claude workbench — Phase 2

Read [workbench rules](../../README.md), the brain plan `docs/specs/brain.md` and its review `docs/reviews/phase2-plan-pr85.md` ([PR #85](https://github.com/agthumoe/solid-lamp/pull/85), not yet merged). Board: epic [#4](https://github.com/agthumoe/solid-lamp/issues/4). This file is Claude's handoff; canonical STATUS/PLAN are updated by the integrating session after merges.

## Claim protocol

One agent per issue. Claim by adding `agent:claude` (or `agent:codex`) and switching `status:ready` → `status:in-progress`, with a comment naming the branch and worktree. Each issue gets its own worktree under `/tmp/aetherion-workbenches/phase2-claude-<issue>`. PRs are opened for review and are not merged by the authoring agent unless the owner says so.

## Now

All PRs below are open for review; none is merged by the authoring agent. Worktrees: `/tmp/aetherion-workbenches/phase2-claude-<issue>`.

| Issue                                                     | Task                                                                 | Branch                           | PR   | State                                                   |
| --------------------------------------------------------- | -------------------------------------------------------------------- | -------------------------------- | ---- | ------------------------------------------------------- |
| [#93](https://github.com/agthumoe/solid-lamp/issues/93)   | P2-7 vault watcher and change planning                               | `feat/93-vault-watcher`          | #109 | `Refs #93`; end-to-end latency and worker wiring remain |
| [#110](https://github.com/agthumoe/solid-lamp/issues/110) | doctor Phase 2 checks (worker, sources.yaml, backups)                | `feat/110-doctor-phase2`         | #111 | Review; conflicts with #113 in a `sources.yaml` comment |
| [#112](https://github.com/agthumoe/solid-lamp/issues/112) | Materialized fixture vault; reader → parser → chunker test           | `feat/112-fixture-vault`         | #113 | Review                                                  |
| [#114](https://github.com/agthumoe/solid-lamp/issues/114) | Book (EPUB/PDF) and dated official-source spec and fixtures          | `feat/114-book-official-sources` | #115 | Review                                                  |
| [#116](https://github.com/agthumoe/solid-lamp/issues/116) | Advisory dependency audit workflow (`deps:audit`)                    | `chore/116-deps-audit`           | #117 | Review                                                  |
| [#118](https://github.com/agthumoe/solid-lamp/issues/118) | Brain citation codec (display form, parse, staleness)                | `feat/118-citations`             | #119 | Review                                                  |
| [#120](https://github.com/agthumoe/solid-lamp/issues/120) | api fail-closed service-key scope for brain routes                   | `feat/120-service-scope`         | #121 | Review                                                  |
| [#122](https://github.com/agthumoe/solid-lamp/issues/122) | source-reader tests leaked reader handles (DEP0137)                  | `fix/122-reader-handle-leak`     | #123 | Review                                                  |
| [#124](https://github.com/agthumoe/solid-lamp/issues/124) | `@aetherion/shared/contracts` with brain search/note/stats contracts | `feat/124-brain-contracts`       | #125 | Review                                                  |

Merged: #86 (PR #100), #87 (PR #101), #88 (PR #102), #92 (PR #103).

## Next

- #95 (routes) can now be assembled from #119 (citations), #121 (service scope) and #125 (contracts) once #91 lands; #96 CLI and #97 MCP consume #125.
- #93 remainder after #91/#95: end-to-end write → searchable latency; wire watcher plans into the worker's pending-event store.
- Worker handler bodies (`NOT_WIRED`) after #91.
- Parser/adapters for books and official sources after #115 is accepted (needs a library ADR).

## Blocked

| Blocker                                       | Route                             |
| --------------------------------------------- | --------------------------------- |
| ADR 0006 is proposed, not accepted (#91, #94) | Owner/reviewer decision on PR #85 |
| Real-vault access (D2) not approved (#99)     | Owner                             |

## Session log

| Date       | Session     | Summary                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ---------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-10-18 | Claude Code | Committed Codex's plan review/ADR 0006 to PR #85. Opened #86–#99 from the revised breakdown with blocked states; created `agent:*` labels; claimed #86 and #87. #86: `cross-workspace-relative` now uses `staticSpecifier()`, with a regression that fails on the old rule.                                                                                                                                                                                                            |
| 2026-10-18 | Claude Code | #87 recovery gate: `db:backup`/`db:restore-verify` with checksum, target safety, manifest compare and retention; integration tests on pgvector and the Supabase image; found and fixed the Supabase default-ACL restore failure. PR #101.                                                                                                                                                                                                                                              |
| 2026-10-18 | Claude Code | Mistakenly labelled #89 while Codex held it (a chained command didn't stop on the existing claim); reverted within a minute (label removed, comment deleted). Claims are now checked in a separate step. #88: sources config + fail-closed verified reader with race test; PR #102.                                                                                                                                                                                                    |
| 2026-10-18 | Claude Code | #92 worker skeleton: BullMQ runtime, contracts, processor, outbox relay port, health, drain; Redis integration tests + CI Redis service; bullmq pinned 6.3.10 (release age), msgpackr-extract build disallowed. PR #103.                                                                                                                                                                                                                                                               |
| 2026-10-20 | Claude Code | Fixed the #102 listing race and #103 bounded shutdown after Codex re-reviews; the owner merged #101–#103. Claimed #93: `fs.watch` watcher (events as hints), conservative change planner, `observePaths`/`scanSource`, detection-latency script (p50 705 ms idle, 736 ms burst). Note: the #102 merge commit carries AI co-author trailers; removing them would need an owner-authorized history rewrite.                                                                              |
| 2026-10-20 | Claude Code | Opened and claimed #110, #112, #114, #116, #118, #120, #122 and #124 one at a time (schema-independent work while #91/#94 wait on ADR 0006). Highlights: canonical percent-encoded citation display form with a seeded fuzz round-trip; service scope rejects before body parsing (zero-work tests, real-socket abort); `createSecretCheck` moved to `@aetherion/shared`; found and fixed leaked reader descriptors in tests. All mutation-checked; `pnpm check` green on each branch. |
