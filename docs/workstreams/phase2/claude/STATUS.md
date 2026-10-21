# Claude workbench — Phase 2

Read [workbench rules](../../README.md), the brain plan `docs/specs/brain.md` and its review `docs/reviews/phase2-plan-pr85.md` ([PR #85](https://github.com/agthumoe/solid-lamp/pull/85), not yet merged). Board: epic [#4](https://github.com/agthumoe/solid-lamp/issues/4). This file is Claude's handoff; canonical STATUS/PLAN are updated by the integrating session after merges.

## Claim protocol

One agent per issue. Claim by adding `agent:claude` (or `agent:codex`) and switching `status:ready` → `status:in-progress`, with a comment naming the branch and worktree. Each issue gets its own worktree under `/tmp/aetherion-workbenches/phase2-claude-<issue>`. PRs are opened for review and are not merged by the authoring agent unless the owner says so.

## Now

No open Claude PRs. Merged on 2026-10-20 after Codex review (P2 findings fixed first where raised):

| PR   | Issue | Delivered                                                                                   |
| ---- | ----- | ------------------------------------------------------------------------------------------- |
| #109 | #93   | Vault watcher (maxSettleMs enforced under continuous events), change planner, latency probe |
| #111 | #110  | doctor Phase 2 checks                                                                       |
| #113 | #112  | Fixture vault materializer (physical-path guard) and reader → parser → chunker test         |
| #115 | #114  | Book and dated official-source spec and fixtures                                            |
| #117 | #116  | Advisory dependency audit                                                                   |
| #119 | #118  | Citation codec                                                                              |
| #121 | #120  | api fail-closed service-key scope                                                           |
| #123 | #122  | Source-reader test handle leak                                                              |
| #125 | #124  | `@aetherion/shared/contracts` brain contracts (display bound = codec worst case; depth 6)   |
| #127 | #126  | Reference RRF fusion and frozen evidence gates                                              |
| #128 | #97   | Brain MCP server (fixed-size refs: note contract carries `pathSha256`)                      |
| #130 | #129  | ADR 0007 (proposed): EPUB/PDF parser libraries                                              |
| #131 | #96   | `brain:query` / `brain:stats` on the shared client                                          |
| #133 | #132  | Duplicate package.json keys rejected by docs:check                                          |

Still open (Claude): #93 end-to-end write → searchable latency and worker wiring; #96 `brain:ingest`; #97 access tests against the real brain routes. All three wait on #91/#95.

## Next

1. Owner decision on ADR 0006 → then #91 schema migration → #95 `search_brain` + routes, assembled from the citation codec, service scope, contracts and fusion/gates already on main (the route compares `pathSha256` with the hash of the current path).
2. Then: #97 real-route access tests, #96 `brain:ingest`, #93 end-to-end latency, worker handler bodies.
3. Book parsers after ADR 0007 is accepted.

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
| 2026-10-20 | Claude Code | Later the same day: #126 retrieval core (RRF reference + calibrated, frozen evidence gates; a dead tie-break found and removed), claimed #97 and built the stdio brain MCP server on the #125 contracts (SDK 1.32.1 per ADR 0005), and proposed ADR 0007 for book parser libraries with a scratch spike that reproduced the #114 fixtures.                                                                                                                                             |
| 2026-10-20 | Claude Code | Claimed #96: `brain:query`/`brain:stats` with terminal-safe output; moved the brain client, query mapping and client config into `@aetherion/shared` so CLI and MCP share them. Trial-merged all 13 open branches: fixed a real export collision (`isSafeRelativePath`, #118 vs #109) and found a duplicate `test:brain` key on main (#132).                                                                                                                                           |
| 2026-10-20 | Claude Code | Owner authorized merging: fixed six Codex P2 findings (watcher deadline, fixture-vault symlink guard, token-aware duplicate-key scan, display bound, fixed-size refs plus header-size limit, DOCTYPE policy) and merged all 14 Claude PRs; rebuilt the stacked CLI branch on main after squash merges.                                                                                                                                                                                 |
