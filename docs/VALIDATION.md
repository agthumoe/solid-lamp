# Latest-change validation — 2026-10-12

Verdict after fixes: both acceptance gaps below are resolved in harness v4; 12/12 regression groups and syntax checks pass. Phase 0 remains open pending model confirmation and hardware evidence.

## Verified

- `pnpm test:bench`: 7/7 tests pass, including stubbed harness completion/failure and duplicate-label protection.
- Node syntax checks pass for models.ts, ollama.ts, and integrity.ts; Makefile command mirrors resolve.
- `results-tuned.json` has a completion timestamp. Native/recovered/abstained/wrong totals and native-call percentages reconcile for all six candidates. Throughput and tool metrics match the updated HARDWARE table.
- The tuned artifact is v2 evidence, not validation of v3's stricter recovery/citation/GPU allocation behavior. No live inference or host re-audit was run in this validation session.
- Embedding version isolation, early access/restore/approval gates, and LlmGate contracts are documented; their runtime implementations do not exist yet.

## Findings reproduced before the fix

1. **Medium — skipped requested models still yield successful completion.** In `scripts/bench/models.ts`, a `/api/show` error is caught and recorded as skipped; the harness later writes `status: complete` and exits zero. A stub returning HTTP 503 for chat reproduced this. Distinguish complete measurement coverage from a finished process; required skipped targets must cause a non-success acceptance status/exit. Preserve skip/error evidence for optional fallbacks too.
2. **Medium — embedding responses can produce invalid benchmark evidence.** `Ollama.embed` returns unchecked arrays and `benchEmbed` uses them directly. A stub returning one-dimensional zero vectors for the configured 1024-dimensional primary completed successfully with `dims: 1`; cosine similarity divides by zero. Validate response count, consistent expected dimensions, finite components, and nonzero norms before throughput/retrieval calculations. Add negative regression cases.

## Documentation corrections

Ticked the completed tuned-run/table task while retaining the model/residency approval gates. Repaired split Markdown tables and removed stale references to missing blocker #2. Clarified that sharing a model tag does not establish a no-reload guarantee when role contexts differ; keep compatible residency contexts or measure switching. Corrected wording about generated WhatsApp calls: no messages were sent by the benchmark.

Full lint/typecheck/application integration checks are unavailable in the Phase 0 scaffold. These syntax/runtime checks do not establish strict TypeScript type correctness. Both findings are now addressed and covered by tests; use a new v4 artifact for current-code hardware evidence.


## Fix verification

- Required generation inspection failures remain visible in `gens` and `skipped`; final status is `incomplete`, finishedAt records the end, exit code is 1, and residency probes are suppressed. Optional fallback failures produce `complete_with_skips`, retain their error, and do not fail required coverage.
- Every embedding call validates output count and vector shape/value/norm before returning. Primary dimensions come from role config; fallback dimensions are inferred on warmup and pinned across the benchmark's subsequent batches. Primary config must declare positive dimensions.
- Cosine rejects zero/nonfinite/mismatched vectors and normalizes before multiplication to avoid overflow/underflow for valid extreme inputs.
- Added unit/client and full-harness probes for invalid dimensions/counts/zero norms, dimension changes between batches, required model HTTP 503, and optional fallback failure. `pnpm test:bench`: 12/12 pass. Syntax checks pass for changed TS files. No live inference was performed and historical artifacts were left unchanged.


## Independent validation by Claude Code — 2026-10-12

Remaining technical findings are tracked in [GitHub #11](https://github.com/agthumoe/solid-lamp/issues/11); phase/model confirmation stays in [#2](https://github.com/agthumoe/solid-lamp/issues/2).

Scope: harness v4 (`ollama.ts`, `models.ts`, `integrity.ts`, `integrity.test.ts`), ADR 0002, the four specs, Makefile/package.json, and the BUILD_PROMPT edits. Includes **live inference**: `docs/bench/results-tuned-v4.json` (status `complete`, harness 4, exit 0).

**Verified**
- `pnpm test:bench` 12/12 pass; `node --check` passes for all bench files.
- CLI rejects unknown flags, missing values, invalid `--only` roles, and unsafe labels.
- Live v4 matches v2 within noise: chat 50.7, router 77.8, coder 33.1, qwen3:8b 57.4, gemma4 49.3 tok/s. Every candidate except coder has 18/18 native calls and 2/2 abstentions. Coder still has 0 native and 17 recovered: the stricter whole-response parser keeps real recoveries while rejecting prose examples. Both residency checks pass (chat+embed 7.71 GB; coder+embed 11.93 GB, `nvidia-smi` 11964/12288 MiB). The eviction probe correctly records chat evicted.
- Codex's claim that shared-model roles reload when `num_ctx` differs is **confirmed live** for `qwen3.5:9b`: 16K→4K and 4K→16K each cost ~3.8 s `load_duration`; omitting `num_ctx` falls back to 4K and also reloads.
- Specs and ADR 0002 are consistent with each other and with PLAN; they describe future contracts and claim no implementation.

**Findings**
1. **Medium — refusal check gives false negatives.** `benchRag` requires `a.trim() === "I don't know."`. Live: chat and chat+think answered `I don't know` (no full stop) to the unanswerable question and were scored as failures (RAG 0.9). That's correct behaviour scored wrong. Suggest `/^I don['’]t know\.?$/`.
2. **Low — residency failures don't affect run status.** A failed `kind: 'residency'` probe still yields `status: complete` / exit 0. Phase 0's "100% GPU" acceptance relies on it. Suggest `complete_with_residency_failures` (or a nonzero exit) when any required residency probe fails.
3. **Low — duplicate flags are accepted.** `--label a --label b` silently uses `a`. An earlier handoff note said duplicate probes were done; they weren't rejected.
4. **Process — owner decision changed without sign-off.** `docs/BUILD_PROMPT.md` and `package.json` (`engines.node >=24 <25`) now say Node 24, which is still open as Blocked #2. The original prompt (Node 22) is unchanged at `/aetherion-os-build-prompt.md`. The §7/§8 data-model edits are allowed by §7 ("record changes in an ADR"), and ADR 0002 does.

**Consequence for model roles:** if router/coder/vision share `qwen3.5:9b` with chat, set all of them to `num_ctx: 16384`. Current config has router 4096 and vision 8192, which would reload on every role switch.

No code was changed in this validation pass.
