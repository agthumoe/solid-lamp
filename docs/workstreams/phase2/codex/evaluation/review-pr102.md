# Review of Claude's source-reader PR #102

Task [#88](https://github.com/agthumoe/solid-lamp/issues/88), PR [#102](https://github.com/agthumoe/solid-lamp/pull/102). Reviewed head: `7bcccb58bb06553337bd937fefcdce4d5cf1e8c6`. Reviewer: Codex, 2026-10-18. Three findings were posted to the PR; Claude retains ownership of fixes.

## P1 — Root swap between validation and open

At `source-reader.ts:121` the reader checks root identity, then at line 125 opens by its pathname. A replacement directory at the same pathname passes the later descriptor-path prefix check (lines 138–140), even though it is not the captured root inode. Deterministically reproduced by interposing the builtin `open` within the review process: after the root check, rename the approved synthetic root aside and rename a second directory into its pathname before the actual open. The reader returned the replacement directory's note.

Bind traversal to the approved root object using held/verified descriptors or another mechanism that establishes that identity. A pre-open inode check plus a post-open string prefix is insufficient. Add a swap-at-open regression; swapping the root before the entire call does not cover this window.

## P1 — Excluded directories are reachable through ancestor symlink aliases

Create `.obsidian/Secret.md` under a temporary root, exclude `.obsidian`, then make `Alias` a directory symlink to `.obsidian`. `open('Alias/Secret.md')` returns the excluded file. Final-component `O_NOFOLLOW` does not reject the ancestor, and the canonical descriptor path is still inside the root. Enforce the no-ancestor-symlink contract and canonical opened-path exclusions. Test aliases into default/user exclusions. `list()` skipping symlinks does not enforce policy on direct `open` calls.

## P2 — Depth truncation is indistinguishable from a complete empty scan

`walk` silently returns when `depth > maxDepth` (line 180). A source containing `Deep/Note.md`, with `maxDepth: 0`, returns ordinary success `[]`. A later resync cannot distinguish truncation from legitimate absence and can tombstone previously indexed notes. Throw a typed limit/incomplete result, as entry overflow already does, and prevent partial lists from authorizing deletions.

## Evidence and integration

Existing source/config tests pass 16/16; required CI is green. All reproductions used temporary invented data; no real-vault read, host-service change or author-worktree edit was performed. The builtin interposition affected only the independent review process and was restored in `finally`.

PR #102 also proposes broad root `test:brain` wiring, which can cover #89/#90/#98 after its fixes land. It points its enabled fixture source at `evals/brain/vault`; parser #89 instead stores raw `.md.fixture` snapshots plus a virtual-path manifest in `evals/brain/parser`. Coordinate/materialize a runnable synthetic vault during integration rather than assuming that root exists. Parser and scorer have no filesystem fallback.
