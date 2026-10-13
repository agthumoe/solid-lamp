# STATUS — live handoff

> **Read this first** (after `AGENTS.md`). This file is the single source of "where are we right now".
> Any agent (Claude Code, Codex, Cursor, …) must update it **before ending a session** or after any meaningful step:
> refresh _Now_, _Next_, _Blocked on owner_, and append one line to the _Session log_.
> Long-lived facts go elsewhere: phase checklist → `PLAN.md`, hardware facts → `HARDWARE.md`, decisions → `adr/` + `PLAN.md` decisions log.

**Last updated:** 2026-10-13 (Codex)
**Phase:** 0 — Environment audit and models (in progress)

---

## Now

- Compliance task #13: strict TS (unchecked indexing/exact optionals), typed lint/hooks, formatting, Zod config/HTTP/fixtures, safe structured diagnostic logs, source/size gates and unified CI are implemented. `pnpm check` passes all gates including 19 regression groups; future application rules remain explicitly not applicable until modules exist.
- Benchmark #11 findings fixed in v5: duplicate flags rejected, semantic/format refusal split, required residency failures gate exit/status. Historical artifacts preserved.

- ✅ Initial publication pushed: bootstrap commit `1ebefaa7877b62a710fafe28a7720931bf5e7dd9`; [GitHub CI](https://github.com/agthumoe/solid-lamp/actions/runs/38350697723) passed. Delivery and final commit evidence are recorded in [#1](https://github.com/agthumoe/solid-lamp/issues/1).
- ✅ Development handbook and ADR 0003 adopted: AI/API/DB/SOLID/frontend/hooks/Query+Zustand/12-factor/logging/debugging; issue-first workflow is canonical in AGENTS.
- ✅ Three pinned project-local skills installed and read; provenance/licenses/hash inventory are committed project artifacts. Available to Codex from the next turn; other agents use the AGENTS catalog.
- ✅ GitHub task #1 preceded this session’s file edits. Nine phase milestones/epics (#2–#10) and benchmark follow-up #11 exist → `docs/TRACKING.md`.
- ✅ Current checks: 12 benchmark tests, documentation/skill integrity, command mirrors, and native TS syntax pass. CI runs these synthetic checks; full lint/typecheck/app enforcement remains Phase 1.

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

1. Compliance delivery is [PR #14](https://github.com/agthumoe/solid-lamp/pull/14) for #13; branch and PR CI passed. Main now requires the GitHub Actions `compliance` check, an up-to-date PR and resolved conversations, including administrators. Final merge evidence is in #13. The PR evidence records final commands and applicability; no service/model changes were made.
2. Owner confirms final model roles in [#2](https://github.com/agthumoe/solid-lamp/issues/2). Align shared-model contexts using measured reload behavior; a fresh v5 run uses a new label when the host is idle.
3. After Phase 0 acceptance and owner's go-ahead, split/start [Phase 1 #3](https://github.com/agthumoe/solid-lamp/issues/3) with application-specific config/logging/DB/API/LLM enforcement. Existing strict tooling is already in place.
4. Follow `docs/TRACKING.md`. Create/select a task before edits and use issue-linked branches/PRs.

## Blocked on owner

| #   | Question                                                                                                                | Default if no answer                               |
| --- | ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| 3   | Raise WSL RAM to 24 GB via `infra/windows/wslconfig.proposed`?                                                          | Don't touch; `deep` role stays disabled            |
| 4   | Docker Desktop is installed but not running; Tailscale not found on Windows or WSL — confirm how Tailscale is installed | Needed by Phase 1 (Docker) and Phase 4 (Tailscale) |
| 5   | Final model roles: see "Recommended model roles" in `HARDWARE.md`                                                       | `config/models.yaml` as-is                         |

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
