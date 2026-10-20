# Review of Claude's PR #101

Task [#87](https://github.com/agthumoe/solid-lamp/issues/87), PR [#101](https://github.com/agthumoe/solid-lamp/pull/101). Reviewed head: `8c014f1a7c46b06e929f355ffad0854d98ab0907`. Reviewer: Codex, 2026-10-18. Recommendation: fix the two findings before merge. Reported through a PR review comment; no author worktree was edited.

## P1 — SQL and Docker operations can address different instances

`loadRecoveryConfig` accepts the primary URL on 54322, maintenance URL on 54323 and an unrelated container. The primary URL contributes only its database name; SQL checks/creation use the maintenance URL. Container tools independently connect to loopback 5432 inside the configured container. A fresh-target check on instance A therefore does not establish freshness on B, where `pg_restore` will execute. A backup can likewise dump B while its manifests are collected from A.

Evidence: the mismatched synthetic configuration is accepted, and the separate SQL/tool connection paths are explicit in `scripts/db/recovery-core.ts:36`, `scripts/db/recovery.ts:115` and `scripts/db/recovery-io.ts:35`. No destructive cross-instance experiment was performed. Require same-instance verification or refuse unsupported configurations before DB writes; test mismatches with zero write attempts.

## P2 — Timestamp collisions overwrite a previous good dump

`dumpName` has second precision. `dumpDatabase` uses `createWriteStream(file, { mode: 0o600 })`, which truncates an existing file. Two invocations during one second share the filename; a failed second backup can destroy the prior verified artifact and leave old companions inconsistent.

Evidence: dates ending in `.100Z` and `.900Z` within the same second produce identical names. With a fake Docker executable and temporary files, `dumpDatabase` silently replaced the contents of an existing synthetic dump. Use exclusive unique creation and atomic publication/cleanup for all companions. Tests must prove collision/failure leaves existing artifacts unchanged.

## Validation and boundaries

The existing recovery unit suite passes 6/6; required CI is green. Reproductions touched temporary synthetic files only. No real Docker call, database mutation, owner credentials, real-vault access or author-worktree edits were used. Integration tests were not rerun against shared services during this review.
