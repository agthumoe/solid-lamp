# Domain fixture integrity diagnostic

Task [#30](https://github.com/agthumoe/solid-lamp/issues/30); [round-2 boundary](../workstreams/round2/CONTRACT.md). Phase 0 tooling only. Existing fixtures remain read-only; this validator neither runs models nor proves domain correctness.

## Contract

`pnpm evals:domain:check` reads the schema-v2 manifest and its six approved regular JSON files under evals/domain. Strict Zod schemas reject unsupported versions, unknown keys, malformed date/ID/money values, unknown rubric/reason values and missing required fields. Manifest paths are a closed reviewed allowlist; no arbitrary paths, symlinks or formula execution. Counts are recomputed and compared to the manifest, with at least 40 answerable and 20 adversarial/unanswerable cases per domain. Reviewed baseline totals are 180 cases, 82 calculation cases, 32 journal-entry cases and 28 abstentions; tests preserve that baseline, while production integrity derives totals from the manifest.

Cross-record checks: unique global case IDs and per-file source IDs; consistent source definitions and trusted policy/prompt versions across files per domain; agent/domain/file/category identity; source and citation references scoped to the case; required claims/citations for answerable cases; abstention for unanswerable cases; adversarial prohibition or premise correction; optional claims structurally separate from required claims. Every referenced source document date and expected journal entry date must be on or before the case as_of date (equal dates are allowed). Date-unit calculation results must be valid ISO calendar dates; conditional results use exactly two dates separated by `|`. This checks syntax, not the correctness of calculated dates. Checks cannot establish that a claim is substantively supported by its citation.

Journal entries use integer cents (BigInt), not binary floating point. Require nonnegative two-decimal money, exactly one positive debit or credit per line, at least two distinct accounts, matching totals, and account code/name drawn from the provided synthetic chart of accounts. Treat chart text as parsed data, never instructions. The narrowly defined chart grammar is documented and tested; unsupported charts fail clearly rather than guessing. Amounts may exceed Number.MAX_SAFE_INTEGER and still reconcile exactly. Calculator inputs/formulas/results are validated as data only, never evaluated; arbitrary calculations and account classifications require independent domain review.

Failures expose known filenames, fixture IDs/schema field names and predefined codes only, without private/source/input text. CLI errors yield nonzero exit; unsupported filesystem/JSON errors have generic codes. Quality statements explicitly say no inference or substantive grading occurred. No dependency additions, active config changes, private data, GPU or model calls.

## Verification and delivery

Add negative tests for versions/unknown fields/dates/rubrics, duplicate or inconsistent IDs/policies, path/symlink rejection, missing sources/citations, required/optional claims, abstention/adversarial shape, manifest count drift, unknown account/name, unbalanced totals, two-sided/zero/negative money, large exact values and sanitized failures. Wire the CLI and tests into current pnpm check and Makefile mirrors. Existing routing suite continues to pass.

Write only the #30 owned script/spec/round2-codex paths and root scripts/mirrors; keep dependencies, lockfile, fixtures and Claude files unchanged. Own handoff/issue/PR records verification; canonical integration is separate. Revert tooling/script wiring to recover; no runtime records or model state are touched.
