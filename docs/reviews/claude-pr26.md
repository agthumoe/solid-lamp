# Review of Claude PR #26

Date: 2026-10-14. Tracking: [#27](https://github.com/agthumoe/solid-lamp/issues/27). Reviewed [PR #26](https://github.com/agthumoe/solid-lamp/pull/26), head `b7cfea376c52e6deaaeab74bea423a715848b93e`. No Claude-owned files were changed; PR remains unmerged. Recommendation: correct the findings before integration or using the fixtures for model acceptance.

## Findings

### P2 — Legal golden answers assume missing prerequisites

[answerable.json:1508](https://github.com/agthumoe/solid-lamp/blob/b7cfea376c52e6deaaeab74bea423a715848b93e/evals/domain/legal-us-tx/answerable.json#L1508), LEG-A-040, expects an unconditional bad-faith presumption when a partial refund was made on day 20 and no itemization was given. Its own supplied source says itemization is unnecessary for undisputed rent owed (§4.03(b)), and no refund/itemization obligation arises before a written forwarding address (§4.04). The question supplies neither those facts nor that 30 days have elapsed. A careful conditional answer can conflict with the unconditional golden claim. Add the necessary facts (including elapsed deadline) or score the missing prerequisites and conditional branches. Similar unconditional refund dates in LEG-A-001/002/027 omit the forwarding-address prerequisite. This finding follows the fictional supplied sources, not a conclusion about real Texas law.

### P2 — Source-only instructions conflict with mandatory expected background claims

[evaluation-protocol.md:39](https://github.com/agthumoe/solid-lamp/blob/b7cfea376c52e6deaaeab74bea423a715848b93e/docs/workstreams/claude/evaluation-protocol.md#L39) instructs answers using only supplied documents and refusal when they lack required information. FIN-X-006 supplies only SWC's financial statements yet expects emergency-fund liquidity/concentration/volatility discussion and professional referral. FIN-X-013 supplies only a confidential memo yet expects a proposition about trading legality. Those expected background propositions are absent from the provided sources, and the prompt does not separately declare the agent-specific safety rules used by the rubrics. Provide a synthetic education/compliance source, or explicitly distinguish trusted safety/persona policy from source-grounded factual claims and tell every comparison arm the same policy. Otherwise compliant abstention can be judged against unsupported expected content and the comparison can reward outside knowledge under a source-only protocol.

### P2 — Hardware eligibility is measured with the required resident partner unloaded

[evaluation-protocol.md:32](https://github.com/agthumoe/solid-lamp/blob/b7cfea376c52e6deaaeab74bea423a715848b93e/docs/workstreams/claude/evaluation-protocol.md#L32) unloads embeddings and says this matches the scheduler policy. The adopted plan prefers a measured chat+embed pair and requires generation+embedding coexistence/residency evidence for intended deployments. A generator-only run can show 100% GPU while the intended pair cannot fit, yet the decision rule uses the run's hardware result to make a candidate eligible. Keep generator-only runs as isolated quality diagnostics, and require a separately recorded production-profile test with the accepted embedding partner (or a reviewed explicit unload policy) before hardware eligibility. This does not require keeping every model resident or running a GPU test during this review.

## Verified evidence and limits

- All 18 changed files are inside Claude's ownership (`docs/workstreams/claude/**`, `evals/domain/**`); no config/dependency/runtime/shared file changes.
- Independently parsed 180 unique cases: 40 answerable and 20 adversarial/unanswerable per domain. Source and expected citation IDs resolve to each case's supplied sources.
- 81 calculation-bearing cases, 32 cases with journal entries, 28 required abstentions match reported totals. Every proposed entry's debit/credit sums and declared total reconcile exactly with Python Decimal. This does not validate account classifications or every formula.
- `pnpm check` rerun on the reviewed Claude worktree passes all existing gates and 19 regression groups. PR's required compliance CI also passed. Existing CI does not execute or substantively score the domain fixtures.
- Primary CPA-Qwen card confirms the declared Apache-2.0 metadata; publisher claims are not competence evidence. Fin-R1's pinned publisher README and training description were inspected. No license adjudication, professional legal/accounting review, model downloads, inference or GPU measurements performed.

## Follow-up

Claude can correct its owned fixtures/protocol under #20. Keep the fixes in that branch and rerun structural/check gates. Domain integrity validation remains a separately tracked integration task; routing integrity PR #25 does not validate domain answers. After fixes, review the exact new head and integrate #26/#23/#25 with required checks, then update canonical adoption blockers/next tasks. No specialist is enabled by this review.
