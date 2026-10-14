# STATUS — live handoff

> **Read this first** (after `AGENTS.md`). This file is the single source of "where are we right now".
> Any agent (Claude Code, Codex, Cursor, …) must update it **before ending a session** or after any meaningful step:
> refresh _Now_, _Next_, _Blocked on owner_, and append one line to the _Session log_.
> Long-lived facts go elsewhere: phase checklist → `PLAN.md`, hardware facts → `HARDWARE.md`, decisions → `adr/` + `PLAN.md` decisions log.

**Last updated:** 2026-10-14 (Codex)
**Phase:** 0 — Environment audit and models (in progress)

---

## Now

- Requested Claude review recorded in [review #27](reviews/claude-pr26.md): three P2 evaluation-design findings (missing legal prerequisites, source-only/expected-background mismatch, hardware test with embed unloaded). Review recommends corrections before acceptance/integration; no Claude files changed. Structural counts/journal sums and current checks pass.

- Owner requested two independent workbenches: Claude #20 owns specialist evidence/domain eval design; Codex #21 owns catalog/routing/scheduling design. [Coordination #19](https://github.com/agthumoe/solid-lamp/issues/19) and [handoff/setup](workstreams/README.md) define disjoint paths, separate branches/worktrees and per-agent STATUS/PLAN. Claude design is published in PR #26; Codex design in PR #23 and diagnostic follow-up in stacked PR #25. All remain open for coordinated integration.

- Owner approved retaining all existing models and adding legal research, financial analysis/investment research, accounting and Qwen3.5-9B knowledge workflows. [#17](https://github.com/agthumoe/solid-lamp/issues/17), [domain-agent plan](specs/domain-agent-plan.md) and ADR 0004 define routing, sequential GPU swaps, source grounding and acceptance. No runtime mapping/model install changed. Specialist evaluation #15 remains open; Fin-R1 upstream license is unresolved.

- Compliance task #13: strict TS (unchecked indexing/exact optionals), typed lint/hooks, formatting, Zod config/HTTP/fixtures, safe structured diagnostic logs, source/size gates and unified CI are implemented. `pnpm check` passes all gates including 19 regression groups; future application rules remain explicitly not applicable until modules exist.
- Benchmark #11 findings fixed in v5: duplicate flags rejected, semantic/format refusal split, required residency failures gate exit/status. Historical artifacts preserved.

- ✅ Initial publication pushed: bootstrap commit `1ebefaa7877b62a710fafe28a7720931bf5e7dd9`; [GitHub CI](https://github.com/agthumoe/solid-lamp/actions/runs/38350697723) passed. Delivery and final commit evidence are recorded in [#1](https://github.com/agthumoe/solid-lamp/issues/1).
- ✅ Development handbook and ADR 0003 adopted: AI/API/DB/SOLID/frontend/hooks/Query+Zustand/12-factor/logging/debugging; issue-first workflow is canonical in AGENTS.
- ✅ Three pinned project-local skills installed and read; provenance/licenses/hash inventory are committed project artifacts. Available to Codex from the next turn; other agents use the AGENTS catalog.
- ✅ GitHub task #1 preceded this session’s file edits. Nine phase milestones/epics (#2–#10) and benchmark follow-up #11 exist → `docs/TRACKING.md`.
- ✅ Current checks: unified `pnpm check` enforces lint/typecheck, 19 benchmark/compliance regression groups, docs/skill integrity, command mirrors, source policies and formatting. Application-specific enforcement remains phased.

- ✅ Baseline (default settings) and tuned (override applied) benchmarks are done; tables are in `docs/HARDWARE.md`. Tuned settings make the 14B coder fit: 15 → 33 tok/s, 100% GPU.
- ✅ Harness fixes from `docs/REVIEW.md` #1/#3/#4 are applied (strict scoring + schema validation, honest residency checks, per-stage saves, timeouts). The first tuned artifact, scored loosely, was kept as `docs/bench/results-tuned-v1-loose-scoring.json`.
- ✅ Strict-scoring tuned run (harness v2) **complete** → `docs/bench/results-tuned.json` (23:26–23:37); tables are updated in `HARDWARE.md`. GPU was reported idle at completion; verify host state before any new live run.
  - It loaded v2 code before Codex's v3 changes: the tool numbers are comparable to v3; the RAG and "recovered from text" numbers may be slightly more lenient. Current harness is v4 (v3 scoring plus acceptance fixes); fresh confirmation: `pnpm bench:models --label tuned-v4` (~12 min).
- ⚠ `docs/BUILD_PROMPT.md` was edited by Codex (Node 22 → 24, §7/§8 embedding storage per ADR 0002, §16 security note). The owner's original is unchanged at `aetherion-os-build-prompt.md`. Node 24 matches the canonical AGENTS instructions and current package engine.
- ✅ ADR 0001 written (Ollama inside WSL).
- ✅ Remaining review fixes implemented and verified with `pnpm test:bench` (7 tests), syntax checks, and invalid/duplicate CLI probes. V3 uses explicit text repair, atomic stage saves and all-path HTTP timeouts.
- ✅ ADR 0002 and embedding/security-recovery/LlmGate specs adopted; Node 24 engine and canonical requirements aligned. Future service implementations remain unchecked in PLAN.
- ✅ Validation follow-up fixed in harness v4: required skips return incomplete/exit 1; optional skips retain reasons; embedding counts, dimensions, finite components and nonzero norms checked before scoring. `pnpm test:bench`: 12/12 pass, including both original reproductions. Syntax checks pass → `docs/VALIDATION.md`.
- Known measurement caveat: `/api/ps` under-reports `gemma4:12b` (0.97 GB reported vs 8.6 GB in `nvidia-smi`).

## Next (in order)

1. Resolve review #27 findings on Claude PR #26 under #20, then re-review and integrate #26/#23 and retarget stacked #25 after #23 merges. Keep workbench ownership boundaries; #15 stays open and no specialist is enabled.
2. Finish Phase 0 in [#2](https://github.com/agthumoe/solid-lamp/issues/2): final enabled role/context/residency evidence and owner acceptance. Portfolio direction is approved; phase advancement is not implied. Use a fresh v5 benchmark label on an idle host when needed.
3. After owner's Phase 0 go-ahead, implement catalog/routing/LlmGate foundation in [#3](https://github.com/agthumoe/solid-lamp/issues/3); source/book grounding in #4; bounded delegation in #5; domain workflows in #9. See the domain-agent plan for acceptance/dependencies.
4. Follow [TRACKING.md](TRACKING.md); create/select bounded implementation tasks before edits. Compliance PR #14 and research PR #16 are merged; required main checks remain enforced.

## Blocked on owner

| #   | Question                                                                                                                | Default if no answer                                 |
| --- | ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| 3   | Raise WSL RAM to 24 GB via `infra/windows/wslconfig.proposed`?                                                          | Don't touch; `deep` role stays disabled              |
| 4   | Docker Desktop is installed but not running; Tailscale not found on Windows or WSL — confirm how Tailscale is installed | Needed by Phase 1 (Docker) and Phase 4 (Tailscale)   |
| 5   | Final enabled bindings/context/residency after eval; portfolio direction is approved (#17)                              | Existing `config/models.yaml` retained               |
| 6   | Personal vs business/entity accounting; investment scope and data sources                                               | Synthetic read-only evaluation; no private ingestion |

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
