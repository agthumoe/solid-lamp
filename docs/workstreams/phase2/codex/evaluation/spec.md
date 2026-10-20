# Brain evaluation scoring contract

Task [#98](https://github.com/agthumoe/solid-lamp/issues/98), early independent slice of [brain plan](../../../../specs/brain.md) task 12. This does not claim completion of the pre-vault safety gate.

## Inputs and provenance

`scoreBrainEvaluation(unknown)` validates a strict run containing frozen profile/chunker/threshold identities, an evidence kind (`synthetic_fake`, `synthetic_local_model`, `real_vault_local`), questions split into `calibration`/`held_out`, and one observation per held-out question. Unknown/duplicate question IDs, missing held-out observations, invalid timings/paths and contradictory result states are errors. Non-JSON/private detail is never included in error output. Calibration observations are allowed but excluded from every metric.

A question has expected alternative citations (`sourceId`, relative path, heading path) iff it is answerable. Observations contain bounded hits with chunk IDs, structured citations and a trusted citation-resolver verification flag. This helper cannot establish that a flag or provenance label is truthful; the eventual runner must bind them to real retrieval/resolution and freeze profiles before evaluation. No model or I/O is performed by scoring.

## Metrics

Deduplicate identical chunk IDs preserving first rank. Conflicting repeated IDs in one observation are invalid rather than silently hiding a false citation. Top 5 means first five distinct returned chunk IDs, as in the search contract. Recall@5 is the fraction of held-out answerable questions with a verified expected note/heading among those five; an answerable abstention/error is a miss. MRR uses the first verified expected citation anywhere in the bounded returned list. Citation accuracy is verified citations / returned distinct citations. Abstention accuracy is correct abstain/non-abstain decisions over all held-out questions; errors/incomplete results never count as correct abstentions. Also report unanswerable abstention rate, errors/degraded counts and p50/p95/max latency. Undefined denominators yield `null`, never a perfect score. Latency percentiles use nearest rank and include failures.

The raw recall target is >= 0.8, but a fake-only run cannot establish semantic retrieval quality. A degraded/incomplete/unavailable run cannot certify the normal hybrid protocol. Every score reports `phase2Accepted: false`: the separate recovery/path/revision/restart/latency and approved real-vault evidence gates are outside this helper. Never infer readiness solely from a high recall score. Output includes aggregates and frozen identities only, not queries, paths, headings, case IDs or raw hits.

## Ownership and pending work

Own only `packages/brain/src/evaluation/**`, `evals/brain/evaluation/**`, `docs/workstreams/phase2/codex/evaluation/**`. Package integration declares existing `zod@4.6.7`, exports the helper and wires tests. No root/lockfile/CI/canonical handoff edits. Local fixtures are synthetic. Copy the private-question template only to existing git-ignored `backups/brain-evals/questions.json`, with private permissions; do not read the real vault until D1/D2 and all gates pass.

Pending: an actual search runner (#95), real-model synthetic runs, profile/race/restart/Redis-loss coverage and final-schema restore verification (#87/#91/#94 and integration). ADR 0006 and real-data approval remain separate gates. No host services or GPU calls are part of this slice.
