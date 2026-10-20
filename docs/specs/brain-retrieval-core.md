# Brain retrieval core: fusion and evidence gates

Issue: [#126](https://github.com/agthumoe/solid-lamp/issues/126). Parent: [#4](https://github.com/agthumoe/solid-lamp/issues/4). Requirements: [brain](brain.md) → _Search contract_ (merge, threshold). Consumer: `search_brain` and the search use case ([#95](https://github.com/agthumoe/solid-lamp/issues/95)). Evaluation metrics are separate ([#98](https://github.com/agthumoe/solid-lamp/issues/98)).

## Goal

Pin down, in pure TypeScript, how vector and lexical candidates are merged and when a merged candidate is allowed to be returned. The SQL function in #95 must order candidates exactly like the reference here, and the search use case applies the gates.

## Reciprocal rank fusion (`fuseRankings`)

- Inputs: each branch's hits in its own rank order (best first). A chunk repeated within one branch keeps its first rank and evidence.
- Score: `Σ 1 / (k + rank)` over the branches that returned the chunk, with `k = 60` (`RRF_CONSTANT`). The result keeps both ranks (`null` when a branch did not return the chunk), cosine similarity and lexical score.
- Order: higher fused score, then better best single-branch rank, then chunk ID in code-unit order. The SQL equivalent is `ORDER BY fused DESC, LEAST(vector_rank, lexical_rank) ASC, chunk_id COLLATE "C"`.
- A "found by both branches" tie-break is deliberately absent: at equal best rank, the two-branch candidate always scores strictly higher, so such a step could never decide.
- `limit` is 1–50. Non-finite evidence is rejected.

## Evidence gates (`EvidenceGates`, `applyEvidenceGates`)

Rank fusion is not proof of relevance, so every fused candidate must also carry enough absolute evidence:

- **Hybrid mode:** passes if `cosine ≥ minCosine` **or** `lexical ≥ minLexical`.
- **Lexical-only mode** (explicitly requested, degraded): only the lexical gate applies.
- `null` turns a branch's gate off: nothing passes on that evidence alone.
- Fused order is kept. If nothing passes, the result is `no_match`.
- The spec case is tested: an unrelated query whose nearest vector ranks first, but with weak cosine, returns `no_match`.
- Gates are versioned (`id`), validated and frozen (`freezeGates`). They are stored with the index version they were calibrated for. Switching versions requires gates calibrated for that version.

## Calibration (`calibrateEvidenceGates`)

- **Input:** questions marked `answerable` or not, each with fused candidates labelled `relevant`.
- **Calibration split only.** Any `held_out` question refuses the run, so gates are frozen before held-out evaluation and cannot be tuned on it.
- The input also needs both answerable and unanswerable questions. Duplicate IDs, or a relevant candidate under an unanswerable question, are refused.
- **Search:** exhaustive over the observed cosine and lexical values (at most 256 quantiles per branch, plus "off").
  - Objective: answerable questions with a relevant chunk among the top K passing candidates (default K = 5), plus unanswerable questions where nothing passes.
  - Ties pick the stricter gate (fewer passing candidates overall), then higher thresholds, so the result is deterministic.
- **Output:** the frozen gates, with `calibration = { questions, sha256 of the calibration set, topK }`, so a later run can prove which data froze them. The output also includes an aggregate report (hits and abstentions only, no queries or paths).

## Non-goals

- SQL and candidate-limit tuning (#95).
- Real calibration data: synthetic and real-model runs are #98; the private set waits for D1/D2 (#99).
- Recall/MRR metrics (Codex's evaluation module).
