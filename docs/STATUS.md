# STATUS — live handoff

> **Read this first** (after `AGENTS.md`). This file is the single source of "where are we right now".
> Any agent (Claude Code, Codex, Cursor, …) must update it **before ending a session** or after any meaningful step:
> refresh _Now_, _Next_, _Blocked on owner_, and append one line to the _Session log_.
> Long-lived facts go elsewhere: phase checklist → `PLAN.md`, hardware facts → `HARDWARE.md`, decisions → `adr/` + `PLAN.md` decisions log.

**Last updated:** 2026-10-15 (Claude, round-3 integration #40)
**Phase:** 0 — Environment audit and models (in progress)

---

## Now

- **Round 3 integrated (#40):** owner decision packets are merged. Codex #41 [role and hardware packet](workstreams/round3/codex/owner-decision-packet.md) (PR #45): proposes Qwen3.5-9B at 16K for chat, routing and the interim tool-driving coder; embeddings at 8K pending a 2K long-chunk test; vision unconfirmed; deep disabled; cites the latest live run `results-tuned-v4.json` (2026-10-13). Claude #42 [domain checklist](workstreams/round3/claude/decision-checklist.md) (PR #44): per-candidate evidence states, owner decisions D1–D10 and stage gates. Shared corrections applied: the domain-agent plan's context sentence follows the per-arm `num_ctx` protocol; acquisition checks verify pinned revisions and hashes rather than comparing to HEAD. Nothing is approved, enabled, downloaded or run by these packets.

- **Round 2 integrated (#38):** PRs #36 (Claude #34 artifact/evaluation readiness dossier: Saul and CPA-Qwen ready for acquisition review, Fin-R1 blocked on license, baseline installed pending local verification; GGUF derivation inferred/unverified) and #37 (Codex #30 schema-v2 domain fixture diagnostics with exact journal balances and date invariants) are merged with required CI after cross-review. Shared changes from #34 applied: per-arm `num_ctx` (Fin-R1 8192) with truncation as failure, explicit per-request sampling, CPA-Qwen thinking off, evidence index → [`evals/artifact-readiness`](../evals/artifact-readiness/README.md). No model downloaded or run; no specialist enabled.

- **Coordinated integration complete (2026-10-14):** PRs #26 (Claude #20 domain evidence/evaluation design), #23 (Codex #21 catalog/routing/scheduling design), #25 (#24 routing fixture integrity) and #28 (review #27 of Claude's design) are merged to `main` with required CI. Cross-reviews: Codex review #27 of #26 (three P2 findings, all resolved at e7e1f60); Claude reviews of #23/#25 (findings resolved, follow-ups closed). Design and fixtures only: no specialist is enabled, no model downloaded or run.

- [Claude review handoff](reviews/claude-pr26.md) records the review of #26. Workbench split per [coordination #19](https://github.com/agthumoe/solid-lamp/issues/19) and [handoff/setup](workstreams/README.md); per-agent STATUS/PLAN under `docs/workstreams/`.

- Owner approved retaining all existing models and adding legal research, financial analysis/investment research, accounting and Qwen3.5-9B knowledge workflows. [#17](https://github.com/agthumoe/solid-lamp/issues/17), [domain-agent plan](specs/domain-agent-plan.md) and ADR 0004 define routing, sequential GPU swaps, source grounding and acceptance. No runtime mapping/model install changed. Specialist evaluation #15 remains open; Fin-R1 upstream license is unresolved.

- Compliance task #13: strict TS (unchecked indexing/exact optionals), typed lint/hooks, formatting, Zod config/HTTP/fixtures, safe structured diagnostic logs, source/size gates and unified CI are implemented. `pnpm check` passes all gates including 51 regression groups; future application rules remain explicitly not applicable until modules exist.
- Benchmark #11 findings fixed in v5: duplicate flags rejected, semantic/format refusal split, required residency failures gate exit/status. Historical artifacts preserved.

- ✅ Initial publication pushed: bootstrap commit `1ebefaa7877b62a710fafe28a7720931bf5e7dd9`; [GitHub CI](https://github.com/agthumoe/solid-lamp/actions/runs/38350697723) passed. Delivery and final commit evidence are recorded in [#1](https://github.com/agthumoe/solid-lamp/issues/1).
- ✅ Development handbook and ADR 0003 adopted: AI/API/DB/SOLID/frontend/hooks/Query+Zustand/12-factor/logging/debugging; issue-first workflow is canonical in AGENTS.
- ✅ Three pinned project-local skills installed and read; provenance/licenses/hash inventory are committed project artifacts. Available to Codex from the next turn; other agents use the AGENTS catalog.
- ✅ GitHub task #1 preceded this session’s file edits. Nine phase milestones/epics (#2–#10) and benchmark follow-up #11 exist → `docs/TRACKING.md`.
- ✅ Current checks: unified `pnpm check` enforces lint/typecheck, 51 benchmark/compliance/routing/domain-fixture regression groups, docs/skill integrity, command mirrors, source policies and formatting. Application-specific enforcement remains phased.

- ✅ Baseline (default settings) and tuned (override applied) benchmarks are done; tables are in `docs/HARDWARE.md`. Tuned settings make the 14B coder fit: 15 → 33 tok/s, 100% GPU.
- ✅ Harness fixes from `docs/REVIEW.md` #1/#3/#4 are applied (strict scoring + schema validation, honest residency checks, per-stage saves, timeouts). The first tuned artifact, scored loosely, was kept as `docs/bench/results-tuned-v1-loose-scoring.json`.
- ✅ Strict-scoring tuned run (harness v2) **complete** → `docs/bench/results-tuned.json` (23:26–23:37); tables are updated in `HARDWARE.md`. GPU was reported idle at completion; verify host state before any new live run.
  - It loaded v2 code before Codex's v3 changes: the tool numbers are comparable to v3; the RAG and "recovered from text" numbers may be slightly more lenient. Current harness is v5 (required residency/refusal/CLI fixes); live v4 confirmation is preserved, and any fresh run needs a new v5 label on an idle host.
- ⚠ `docs/BUILD_PROMPT.md` was edited by Codex (Node 22 → 24, §7/§8 embedding storage per ADR 0002, §16 security note). The owner's original is unchanged at `aetherion-os-build-prompt.md`. Node 24 matches the canonical AGENTS instructions and current package engine.
- ✅ ADR 0001 written (Ollama inside WSL).
- ✅ Remaining review fixes implemented and verified with `pnpm test:bench` (7 tests), syntax checks, and invalid/duplicate CLI probes. V3 uses explicit text repair, atomic stage saves and all-path HTTP timeouts.
- ✅ ADR 0002 and embedding/security-recovery/LlmGate specs adopted; Node 24 engine and canonical requirements aligned. Future service implementations remain unchecked in PLAN.
- ✅ Validation follow-up fixed in harness v4: required skips return incomplete/exit 1; optional skips retain reasons; embedding counts, dimensions, finite components and nonzero norms checked before scoring. `pnpm test:bench`: 12/12 pass, including both original reproductions. Syntax checks pass → `docs/VALIDATION.md`.
- Known measurement caveat: `/api/ps` under-reports `gemma4:12b` (0.97 GB reported vs 8.6 GB in `nvidia-smi`).

## Next (in order)

1. **Owner decisions** (packets above). (a) #2: accept, reject or amend each role/context proposal in the [role packet](workstreams/round3/codex/owner-decision-packet.md), then state whether Phase 0 is accepted. (b) #42 D8: whether synthetic #31 comparisons may run as Phase 0 evidence. (c) D1/D2: evaluation-only residual-risk acceptance for Saul and CPA-Qwen; D3: Fin-R1 license path. (d) D5: personal vs business accounting. The other decisions (D4, D6, D7, D9, D10) wait for results. #15 remains open; no specialist is enabled.
   - After those: #31 as a tracked acquisition task per the [domain checklist](workstreams/round3/claude/decision-checklist.md#minimum-evidence-per-stage) (pinned-revision/hash verification, derivation, template rendering, tokenizer budgets, quality and production-profile GPU tests under the exclusive lease).
2. Finish Phase 0 in [#2](https://github.com/agthumoe/solid-lamp/issues/2): final enabled role/context/residency evidence and owner acceptance. Portfolio direction is approved; phase advancement is not implied. Use a fresh v5 benchmark label on an idle host when needed.
3. After owner's Phase 0 go-ahead, implement catalog/routing/LlmGate foundation in [#3](https://github.com/agthumoe/solid-lamp/issues/3); source/book grounding in #4; bounded delegation in #5; domain workflows in #9. See the domain-agent plan for acceptance/dependencies.
4. Follow [TRACKING.md](TRACKING.md); create/select bounded implementation tasks before edits. Compliance PR #14 and research PR #16 are merged; required main checks remain enforced.

## Blocked on owner

| #   | Question                                                                                                                                                                                                 | Default if no answer                                                    |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| 3   | Raise WSL RAM to 24 GB via `infra/windows/wslconfig.proposed`?                                                                                                                                           | Don't touch; `deep` role stays disabled                                 |
| 4   | Docker Desktop is installed but not running; Tailscale not found on Windows or WSL — confirm how Tailscale is installed                                                                                  | Needed by Phase 1 (Docker) and Phase 4 (Tailscale)                      |
| 5   | Final enabled bindings/context/residency after eval; portfolio direction is approved (#17)                                                                                                               | Existing `config/models.yaml` retained                                  |
| 6   | Personal vs business/entity accounting; investment scope and data sources                                                                                                                                | Synthetic read-only evaluation; no private ingestion                    |
| 7   | Round-3 decisions: #2 role/context proposals ([packet](workstreams/round3/codex/owner-decision-packet.md)); domain D1–D10 ([checklist](workstreams/round3/claude/decision-checklist.md#owner-decisions)) | Existing draft config retained; candidates stay candidates; #31 blocked |

## Repo map (what exists today)

Development standards: `docs/development/`, `CONTRIBUTING.md`, ADR 0003; tracking: `docs/TRACKING.md`, GitHub templates; reference skills: `.agents/skills` + integrity lock; checks: `scripts/check-docs.ts`, `.github/workflows/checks.yml`.

| Path                               | What                                                                                                                                  |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `aetherion-os-build-prompt.md`     | Original prompt from the owner (root copy; canonical copy is `docs/BUILD_PROMPT.md`)                                                  |
| `AGENTS.md` / `CLAUDE.md`          | Agent instructions (`CLAUDE.md` just imports `AGENTS.md`)                                                                             |
| `docs/PLAN.md`                     | Phase checklists + decisions log                                                                                                      |
| `docs/STATUS.md`                   | This file                                                                                                                             |
| `docs/HARDWARE.md`                 | Host audit, baseline + tuned results, recommended roles                                                                               |
| `docs/REVIEW.md`                   | Codex review of Phase 0 (findings 1–7)                                                                                                |
| `docs/adr/0001-ollama-location.md` | Ollama runs inside WSL                                                                                                                |
| `docs/bench/*.json`                | Raw benchmark results                                                                                                                 |
| `config/models.yaml`               | Role → model mapping (draft)                                                                                                          |
| `scripts/bench/`                   | `models.ts` harness, `ollama.ts` client + tolerant tool-call parser, `fixtures/` (20 tool prompts, 10 synthetic notes + 10 questions) |
| `infra/ollama/override.conf`       | Ollama systemd drop-in (**installed and verified in the prior session**)                                                              |
| `infra/windows/wslconfig.proposed` | Proposed `.wslconfig` (**not applied**)                                                                                               |
| `package.json`                     | Root; `bench:models`, `test:bench`, Node 24 engine, dep `yaml@2.8.4`; Makefile mirrors commands. Full scaffold comes in Phase 1.      |

Initial baseline is published to `main` under the owner’s explicit authorization (#1), and its CI passed. See #1 for publication/final commit evidence; future work uses issue-linked branches/PRs.

## Gotchas learned

- Scripts run with Node 24's native TS type stripping (`node file.ts`). **No parameter properties, enums, or namespaces**; imports need the `.ts` extension.
- `sudo` needs a password → the agent can't apply system config; hand the owner the exact command.
- Ollama runs as the `ollama` systemd service; models live in `/usr/share/ollama/.ollama/models`. Verify settings from the `server config` line in `journalctl -u ollama`, not from env vars.
- Windows desktop holds 0.8–1.6 GB of VRAM (display on the 3060, varies), so budget against `nvidia-smi` free memory.
- `/api/ps` `size_vram` is wrong for `gemma4:12b`; cross-check with `nvidia-smi`.
- Multiple agents may edit these docs and the harness concurrently (Claude Code + Codex happened on 2026-10-12). Re-read a file before overwriting it.
- **Only one benchmark at a time.** Each run calls `unloadAll()`, so concurrent runs evict each other's models and corrupt the timings. Check `pgrep -af '^node scripts/bench/models.ts'` first (an unanchored pattern also matches the shell running the check).

## Session log

| Date       | Agent       | Summary                                                                                                                                                                                                                                                                                                                                                                                           |
| ---------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-10-12 | Claude Code | Phase 0 started. Audited host, pulled role + fallback models, built bench harness, drafted PLAN/AGENTS/models.yaml/override.conf/wslconfig proposal. Added STATUS.md + HARDWARE.md as handoff files. Baseline bench done (coder doesn't fit at 16K).                                                                                                                                              |
| 2026-10-12 | Codex       | Reviewed Phase 0 code, baseline evidence, and plan; reproduced permissive repair parsing, identified scoring/residency issues, and recorded recommendations in REVIEW.md. Corrected stale settings instructions. No runtime/config changes or phase completion.                                                                                                                                   |
| 2026-10-12 | Claude Code | Owner applied Ollama override. Tuned bench: coder now fits (33 tok/s). Investigated gemma4 VRAM misreport and embed speed. Fixed harness per REVIEW #1/#3/#4, wrote ADR 0001, folded REVIEW #2/#5/#6 into PLAN. Strict-scoring tuned re-run in progress.                                                                                                                                          |
| 2026-10-12 | Codex       | Completed remaining review fixes with regression coverage; atomic artifacts preserve historical evidence, repaired calls require whole explicit responses, all HTTP paths bounded. Adopted embedding ADR/spec and early security/recovery/LlmGate gates; aligned Node 24 docs/engine. Preserved the separately running v2 benchmark; v3 measurements and final model confirmation remain pending. |
| 2026-10-12 | Claude Code | Strict tuned run complete; HARDWARE tuned table + recommendations refreshed (fixed a garbled row). Noted Codex's edits to BUILD_PROMPT.md for owner review. Phase 0 report delivered; waiting on owner.                                                                                                                                                                                           |
| 2026-10-12 | Codex       | Validated latest changes: 7 tests and syntax checks pass; verified completed tuned v2 artifact/table metrics. Reproduced invalid embedding acceptance and skipped required target completion; recorded VALIDATION.md and pending fixes. Corrected handoff/checklist/table inconsistencies. No live inference or phase advancement.                                                                |
| 2026-10-12 | Codex       | Fixed both validation gaps in harness v4. Required skipped targets yield incomplete/exit 1 and suppress residency probes; optional failures persist. Validated all embedding batches and robust cosine inputs. Added five regression groups: 12/12 tests plus syntax checks pass. Historical benchmark artifacts preserved; no live inference or phase advancement.                               |
| 2026-10-12 | Claude Code | Validated Codex's v4 changes incl. live run `results-tuned-v4.json` (complete, matches v2). Confirmed num_ctx reload claim (~3.8 s). Findings in VALIDATION.md: refusal-check false negative (medium), residency doesn't gate status, duplicate flags accepted, Node 24 set without owner sign-off. No code changed.                                                                              |

| 2026-10-13 | Codex | Issue #1 created before edits. Adopted development handbook/ADR 0003 and issue-first AGENTS; installed three pinned MIT skill references with provenance/hashes; created phase milestones/epics #2–#10 and benchmark task #11; added templates, README/CONTRIBUTING and Phase 0 CI/docs checks. Existing baseline published in `1ebefaa`; GitHub CI passed. Final handoff publication evidence is recorded in #1. Phase 0 model gate stays open. |

| 2026-10-13 | Codex | Issue #12 created before CI bootstrap cleanup. Verified current checkout/setup-node/pnpm setup release commits declare Node 24; pinned Ubuntu 24.04. Prior main CI passed; fresh cleanup-run evidence is recorded in #12. No application phase advancement. |

| 2026-10-13 | Codex | #13 opened before edits; compliance branch implements strict typing/lint/format, Zod boundaries, safe logs and negative policy tests; closes #11 benchmark gaps. Updated unified CI and applicability evidence. Application modules/owner model gates remain pending; PR #14/required-check evidence recorded in #13; main protection verified (strict compliance check, PR, admin enforcement, no force-push/delete). |

| 2026-10-13 | Codex | #15 opened before recording US/Texas specialist research. Finance agent is planned only; no specialist roles installed. Shortlisted Saul legal and conditional Fin-R1 finance comparison; CPA-Qwen is experimental and tax uses current-source retrieval/deterministic rules. Licenses/evals/hardware and personal-vs-business scope remain adoption gates. |

| 2026-10-13 | Codex | #17 created before edits. Owner direction recorded: retain all existing models; evaluate Saul/Fin-R1/CPA-Qwen and keep Qwen3.5-9B knowledge. Added domain-agent spec/ADR 0004 with source grounding, decimal calculations, sequential LlmGate swaps, explicit fallback and measurable eval gates; aligned PLAN/TRACKING. No models installed, bindings changed or phase advanced; publication/check evidence belongs to #17. |

| 2026-10-13 | Codex | #19 created before split edits; created ready Claude #20 and Codex #21 with disjoint file ownership and frozen boundary contract. Added per-agent handoffs, Git worktree setup and copy/paste Claude prompt; AGENTS routes parallel-session updates to owned handoffs. Canonical/shared files and host GPU require serialized integration/coordination. Publication/setup checks recorded in #19; neither workstream implementation started. |

| 2026-10-14 | Codex | #27 created before review handoff edits. Reviewed Claude PR #26 head b7cfea3 without editing its owned files: verified 180 cases, source/citation IDs, 32 balanced entry cases, and current checks. Recorded three P2 evaluation-design findings; corrections/re-review required before integration. No inference/GPU/adoption/phase changes. |

| 2026-10-14 | Codex | Re-reviewed Claude reply and head e7e1f60 under existing #27. All three findings resolved; no new blocking issue in the changed revision. Verified 180 cases/82 calculations/32 balanced entry cases/28 abstentions, consistent policies and deadline/source corrections. Current checks and exact-head CI pass; no Claude file edits, merge or specialist activation. |

| 2026-10-14 | Codex | Continued under #24 in a new isolated stacked worktree/branch. Added strict routing fixture integrity schemas, independent patch expansion, expected-result checks and negative tests; root check/Makefile integration added. Claude #20 remains active; no task-owned artifacts, models, GPU or active config changed. Local `pnpm check` passes 34 regression groups and validates 51 routing fixtures; PR/CI evidence is in #24. Phase gates remain open. |

| 2026-10-14 | Codex | Addressed Claude review on #23/#25 under existing open #21/#24. Added omitted installed inventory, fallback edge cases and required/optional retrieval rules; diagnostic now closes reason vocabulary, plan/attempt identity and fallback evidence invariants. Cases expanded to 51 and diagnostic groups to 13. CI/evidence in tasks; no Claude-owned or runtime configuration changes. |

| 2026-10-14 | Codex | Claude second re-review confirms original findings resolved. Under #21/#24, added explicit missing inventory rows and closed two minor diagnostic gaps (mandatory degradation disclosure; invalid fallback bindings on successful routes/plans). New mutation probes reproduce both reports; 15 diagnostic groups/34 total and 51 fixtures verified. Final evidence in tasks; no Claude edits, model activation or merge. |

| 2026-10-14 | Claude | Coordinated integration at owner request: squash-merged #26, #23 (after updating to main), #25 (retargeted to main after #23), and #28 (resolved STATUS/PLAN conflicts with #25 in a separate detached worktree; both sides' session-log entries kept). Required compliance CI passed for each merge. No runtime, config or model changes. |

| 2026-10-14 | Codex | #29 opened before audit cleanup. Verified merged #23/#25/#26/#28 on main 9504a1a and successful main CI; combined check validates 51 routing fixtures and 34 groups. Preserved 180 schema-v2 domain cases (82 calculations, 32 balanced-entry cases, 28 abstentions), all ten installed models and unchanged active config/dependencies. Reconciled shared inventory/evidence/tracking; created #30 domain diagnostics and #31 gated live-eval follow-ups. No runtime/model/GPU changes or phase advancement; cleanup publication evidence in #29. |

| 2026-10-14 | Codex | #33 opened before round-2 setup edits. Assigned existing #30 to Codex (domain fixture diagnostics/root scripts) and created ready Claude #34 (public metadata/artifact readiness under #31). Added frozen boundary, separate branches/worktrees, per-agent handoffs and copy/paste prompt; no source fixtures/config/models/GPU changed, no task execution or phase advancement. Setup/check evidence in #33. |

| 2026-10-14 | Claude | Round-2 integration #38 at owner request: squash-merged #36 (Claude #34; Codex re-review clean at 91531a3) and #37 (Codex #30; Claude re-review confirmed at 0cc8ac4, later commit handoff-only; updated to main before merge). Applied #34 shared-change requests to the evaluation protocol and evidence index; reconciled STATUS/PLAN/TRACKING; closed #30/#34. Required CI passed for each merge. No runtime, config, model or GPU changes. |

| 2026-10-15 | Claude | Round-3 integration #40 at owner request: PRs #44 (Claude #42) and #45 (Codex #41) were merged earlier with required CI; this pass applied #42 shared corrections S1 (domain-agent plan context sentence → per-arm `num_ctx`) and S2 (pinned-revision/hash verification wording in the round-2 dossier, artifact-readiness README and round-1 evidence index), reconciled STATUS/PLAN/TRACKING and marked rounds 2/3 handoffs complete. No runtime, config, model or GPU changes; owner decisions pending. |
