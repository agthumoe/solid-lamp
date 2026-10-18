# STATUS — live handoff

> **Read this first** (after `AGENTS.md`). This file is the single source of "where are we right now".
> Any agent (Claude Code, Codex, Cursor, …) must update it **before ending a session** or after any meaningful step:
> refresh _Now_, _Next_, _Blocked on owner_, and append one line to the _Session log_.
> Long-lived facts go elsewhere: phase checklist → `PLAN.md`, hardware facts → `HARDWARE.md`, decisions → `adr/` + `PLAN.md` decisions log.

**Last updated:** 2026-10-18 (Claude, merged the Phase 1 stack #63–#76 after fixing Codex's five review findings)
**Phase:** 1 — Scaffold (Phase 0 accepted 2026-10-15, #47)

---

## Now

- **Merged 2026-10-18 (owner said to merge after the reviews):** the Phase 1 stack, squash-merged bottom-up, with CI green on each up-to-date head:
  - #63 → `d31bd6a`: [#59](https://github.com/agthumoe/solid-lamp/issues/59) Ollama adapter ([spec](specs/inference-ollama-adapter.md))
  - #64 → `acfa993`: [#60](https://github.com/agthumoe/solid-lamp/issues/60) inference RPC, gate wiring, `InferenceClient` ([spec](specs/inference-rpc.md))
  - #65 → `88a8414`: [#61](https://github.com/agthumoe/solid-lamp/issues/61) `apps/api` health ([spec](specs/api-health.md))
  - #66 → `4534957`: [#62](https://github.com/agthumoe/solid-lamp/issues/62) `pnpm doctor` ([spec](specs/doctor.md))
  - #68 → `5f9beef`: [#67](https://github.com/agthumoe/solid-lamp/issues/67) Redis compose and compose exposure policy
  - #70 → `cae2df9`: [#69](https://github.com/agthumoe/solid-lamp/issues/69) retained model catalog ([spec](specs/model-catalog.md))
  - #72 → `9fcd13e`: [#71](https://github.com/agthumoe/solid-lamp/issues/71) import boundaries
  - #74 → `2489346`: [#73](https://github.com/agthumoe/solid-lamp/issues/73) brain-core migration and `packages/db` ([spec](specs/brain-schema.md))
  - #76 → `c2e4475`: [#75](https://github.com/agthumoe/solid-lamp/issues/75) local Supabase Postgres on loopback ([spec](specs/supabase-local.md))

  Codex reviewed every PR at combined head `983af5f`. Five P2 findings were fixed with regression tests before merge: NDJSON oversized complete lines (#63), body-stall deadline mapping in the client (#64), configured nondefault ports in doctor bindings (#66), sibling-package relative imports (#72, via a new `aetherion/cross-workspace-relative` lint rule), and link deletion versus the target check (#74; `links.to_title` is now required). The last was verified against a throwaway pgvector Postgres: it fails on the old migration and passes 9/9 on the fix. There were no findings for #65/#68/#70/#76. Issues #59–#75 are closed as `status:done`.

- **Phase 1 acceptance was met locally before the merge:** `pnpm doctor` green (22 ok), `/api/v1/health/ready` all `ok`, `packages/llm` tests pass. **Owner go-ahead to close Phase 1 is still pending.** Owner actions: create `.env` (`AETHERION_POSTGRES_PASSWORD`, `AETHERION_DATABASE_URL`, `AETHERION_INFERENCE_SECRET`), then `pnpm db:start && pnpm db:migrate`; turn on Docker Desktop WSL integration so `docker compose` works.

- **Merged 2026-10-18:** PR #58 → `4b1d578`: [#56](https://github.com/agthumoe/solid-lamp/issues/56) config loader ([spec](specs/config-loader.md)) and [#57](https://github.com/agthumoe/solid-lamp/issues/57) `packages/llm` pure core ([spec](specs/llm-package.md)), including fixes for Codex's two review findings (deadline at dispatch/settlement; `{ value, snapshot }` results).

- **Merged 2026-10-16 (owner go-ahead):** PR #50 foundations ([#49](https://github.com/agthumoe/solid-lamp/issues/49)) → `197e3ae`; PR #54 [dashboard spec](specs/dashboard.md) ([#51](https://github.com/agthumoe/solid-lamp/issues/51)) → `ea6d358`; PR #53 `@aetherion/shared` Result/errors/safe logging ([#52](https://github.com/agthumoe/solid-lamp/issues/52), Codex) → `ea1a556`. Stacked PRs were rebased onto `main` and passed CI before merging; #49, #51 and #52 closed. Codex reviews of #50 (4 rounds) and #51 found no open defects; framework Markdown templates stay reference-only until their libraries are installed.

- Foundations now on `main`: [ARCHITECTURE](ARCHITECTURE.md), [structure](development/structure.md), [AI orchestration](development/ai-orchestration.md), [testing](development/testing.md), [templates](development/templates/README.md) (25 tested template cases), [ADR 0005](adr/0005-phase1-stack-and-topology.md) (proposed until pins are installed).

- **Owner decisions 2026-10-15 ([#47](https://github.com/agthumoe/solid-lamp/issues/47)). Phase 0 accepted.**
  - Initial bindings applied in `config/models.yaml`: chat, router, coder and vision share `qwen3.5:9b` at 16K; embed `qwen3-embedding:0.6b` at 8K; deep disabled. `qwen3.5:4b` and `qwen2.5-coder:14b` are retained as unbound alternates, and every installed model is kept.
  - Synthetic tests are acceptable as Phase 0-type work.
  - Specialist license residuals D1–D3 **declined**: Saul, CPA-Qwen and Fin-R1 are not acquired or evaluated and stay catalog candidates. #31 is closed as not planned; #15 is closed with the research retained.

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

1. **Continue Phase 1 ([#3](https://github.com/agthumoe/solid-lamp/issues/3)): scaffold** following the templates; `packages/shared` is done (#52, #56 config loader); `packages/llm` pure core is in review (#57); next are monorepo/Vitest, `apps/inference` Ollama adapter, `pnpm doctor`, `/health`. Create bounded child issues (monorepo, Supabase/migrations with ADR 0002 schema, Redis compose, `packages/shared`/`db`/`llm` with LlmGate, `pnpm doctor`, `/health`). Requires Docker Desktop running (blocked item 4).
2. Optional synthetic domain baseline: run the 180 domain fixtures on the installed `qwen3.5:9b` per the prompt-v2 protocol, under the GPU lease. This gives the scoped domain evidence Qwen needs before serving domain agents; it is not scheduled until requested.
3. Finish Phase 0 in [#2](https://github.com/agthumoe/solid-lamp/issues/2): final enabled role/context/residency evidence and owner acceptance. Portfolio direction is approved; phase advancement is not implied. Use a fresh v5 benchmark label on an idle host when needed.
4. After owner's Phase 0 go-ahead, implement catalog/routing/LlmGate foundation in [#3](https://github.com/agthumoe/solid-lamp/issues/3); source/book grounding in #4; bounded delegation in #5; domain workflows in #9. See the domain-agent plan for acceptance/dependencies.
5. Follow [TRACKING.md](TRACKING.md); create/select bounded implementation tasks before edits. Compliance PR #14 and research PR #16 are merged; required main checks remain enforced.

## Blocked on owner

| #   | Question                                                                                                                                                                                                                           | Default if no answer                                                  |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| 3   | Raise WSL RAM to 24 GB via `infra/windows/wslconfig.proposed`?                                                                                                                                                                     | Don't touch; `deep` role stays disabled                               |
| 4   | Docker Desktop now runs (started 2026-10-18 at owner request), but this distro's CLI lacks the `docker compose` plugin: turn on WSL integration for it. Tailscale not found on Windows or WSL — confirm how Tailscale is installed | `pnpm db:start` needs compose; Tailscale needed by Phase 4            |
| 7   | Create `.env` with `AETHERION_POSTGRES_PASSWORD`, `AETHERION_DATABASE_URL` and `AETHERION_INFERENCE_SECRET` (see `.env.example`). Credentials are owner-handled                                                                    | api readiness reports `not_configured` and inference refuses to start |
| 6   | Personal vs business/entity accounting; investment scope and data sources                                                                                                                                                          | Synthetic read-only evaluation; no private ingestion                  |

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

- Never run `supabase start`: it publishes Postgres and Kong on all interfaces. Use `pnpm db:start` (compose, loopback) plus `pnpm db:migrate`.
- Supabase CLI telemetry is on by default; the repo scripts set `SUPABASE_TELEMETRY_DISABLED=1`. Raw `npx supabase` calls do not.
- Ollama residency is not stable across roles: after an embed then a chat request, `/api/ps` listed only the chat model (2026-10-18). Observe `/api/ps` around each job; never assume the chat+embed pair is loaded.
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

| 2026-10-15 | Claude | Owner Phase 0 decisions recorded under #47: initial role bindings applied to `config/models.yaml` (shared `qwen3.5:9b` 16K for chat/router/coder/vision; embed 8K; deep disabled; alternates retained), synthetic tests acceptable, specialist D1–D3 declined, Phase 0 accepted. Updated PLAN/STATUS/HARDWARE/domain-agent plan; #2 closed, #3 ready, #31/#15 closed. No model download, deletion or GPU run. |
| 2026-10-15 | Claude Code | #49 Phase 1 foundations: ARCHITECTURE, structure, AI orchestration, testing, templates (type-checked result/errors, approval use case with fake + 6 tests, tool executor + 6 tests), ADR 0005 proposed. `test:templates` added to `pnpm test`. No dependencies installed, no app code. Codex review requested. |
| 2026-10-15 | Claude Code | #49 Codex review (2×P2) addressed on PR #50: approval decision + audit + outbox now commit through a `DecisionUnitOfWork` (fake proves rollback on outbox failure and retry); typed streaming failure contract (`inference-stream.ts`, one terminal `done`/`error` event with `partial`). 17 template tests. |
| 2026-10-16 | Claude Code | #51 dashboard design: private design canvas (8 boards) plus reviewable text spec `docs/specs/dashboard.md` (auth, routes ↔ API, per-screen ownership/states, approval decision × execution lifecycle, SSE, a11y, acceptance tests). Stacked on PR #50. |

| 2026-10-15 | Codex | Reviewed open dashboard design issue #51 read-only on GitHub; identified missing explicit Auth acceptance and approval lifecycle states. Private canvas inaccessible; dashboard spec absent locally. Recorded review limitations; no GitHub writes, runtime changes or phase advancement. |

| 2026-10-15 | Codex | Re-reviewed #51: issue/comments unchanged, no dashboard spec found in main or checked worktrees and no associated PR in the retrieved list; private canvas remains inaccessible. Corrected earlier P2 severity: Auth/approval lifecycle items are recommendations pending inspectable design evidence, not confirmed defects. |

| 2026-10-15 | Codex | Reviewed PR #50 head 735a420 under open #49; verified the two earlier fixes, ran full pnpm check successfully and reproduced both ingestion job ID defects. Findings returned in chat; foundations files unchanged, no GitHub writes or merge. |

| 2026-10-15 | Codex | Re-reviewed PR #50 head fc86baf under #49. Verified prior BullMQ fixes; reproduced a new NFC filename collision using two distinct Linux files. Full pnpm check and CI pass; findings returned in chat, no foundations changes or GitHub writes. |

| 2026-10-16 | Codex | Re-reviewed PR #50 head 41b8272 under #49; filename collision fixed and independently verified with actual files. No new findings in latest changes. Full pnpm check, diff whitespace checks and CI pass; no foundations edits, GitHub writes or merge. |
| 2026-10-16 | Claude Code | Owner said all good: merged PR #50 (#49), rebased and merged stacked PRs #54 (#51) and #53 (#52, Codex) after green CI; closed #49/#51/#52, deleted merged branches. Kept Codex's uncommitted review notes from the main checkout (reconciled into STATUS/PLAN). |
| 2026-10-17 | Claude Code | Owner selected config loader + `packages/llm`. Created #56/#57 under #3. Implemented `@aetherion/shared` config loader (11 tests) and `@aetherion/llm` core (21 tests: queue limits, priority/starvation, cancellation/teardown, deadlines, snapshots, batch interleave, REVIEW #2 repair negatives). Specs `config-loader.md`, `llm-package.md`; `test:llm` + Makefile mirror. No Ollama/GPU/Docker use. |
| 2026-10-18 | Claude Code | Fixed Codex PR #58 review (#57): `LlmGate` re-checks deadlines against the clock at dispatch and settlement; `scheduleGeneration` wraps the executor value as `{ value, snapshot }` instead of spreading it. Two regression tests (lagging-timer test fails on the old code). Spec updated; `pnpm check` passes. |
| 2026-10-18 | Claude Code | PR #58 merged. Created #59–#62 under #3. #59: `apps/inference` Ollama adapter (chat stream/generate, embed, `/api/ps` residency, retry-before-output) with 26 fake-fetch tests plus 3 `collectStream` tests; live smoke against local Ollama OK. Spec `inference-ollama-adapter.md`; `test:inference` + Makefile mirror. Docker still stopped (blocked item 4). |
| 2026-10-18 | Claude Code | #60 (stacked on PR #63): inference RPC server, gate-wired service (terminal event after gate settles, per-job residency observation), env config, client + fake, NDJSON reader moved to `packages/llm`, workspace exact-pin compliance. 45 new tests (service, `server.inject` contract, loopback client↔server, client, fake, config, pin policy). Live server smoke against local Ollama OK. |
| 2026-10-18 | Claude Code | #61 (stacked on #64): `apps/api` skeleton with liveness/readiness, error envelope plugin, postgres + inference probes, env config; `InferenceClient.ready()` + readiness contract. 14 api tests (incl. real `postgres` driver against a refused port); live api+inference readiness checked. GitHub API rate limit hit mid-session (gh calls paused). |
| 2026-10-18 | Claude Code | #62 (stacked on #65): `pnpm doctor` with 10 unit tests; root links `@aetherion/shared`. Local run: only Docker/Postgres/Redis fail (Docker Desktop stopped). |
| 2026-10-18 | Claude Code | #67 (stacked on #66): Redis compose + compose exposure policy in compliance (1 new test group); compliance evidence table refreshed. Docker-dependent items (Supabase, migrations, `packages/db`) remain blocked on owner item 4. |
| 2026-10-18 | Claude Code | #69 (stacked on #68): catalog schema + binding validation (6 tests), inference startup gate (manually verified exit on contradiction), doctor catalog/bindings/artifacts checks (2 new tests). No binding or routing change. |
| 2026-10-18 | Claude Code | #71 (stacked on #70): ESLint `no-restricted-imports` boundaries per structure.md with negative lint tests; structure/compliance docs updated. |
| 2026-10-18 | Claude Code | #73 (stacked on #72): brain-core migration, `packages/db`, integration replay/parity tests (9) running in CI on pgvector 0.8.7-pg17; local run skipped (Docker stopped). Note: one commit was pushed before `pnpm check` finished (format-only miss) and fixed in the next commit. |
| 2026-10-18 | Claude Code | Owner asked me to start Docker Desktop. Redis is up on loopback. #75: `supabase start` bound all interfaces, so it was stopped, rejected and its volume removed; Supabase Postgres now runs via compose on loopback with the CLI as migration operator. Migration applied, `test:int` 9/9 on Supabase Postgres, `/health/ready` all ok, doctor green (verified in a throwaway project, since torn down). Phase 1 acceptance met; owner go-ahead pending. |
| 2026-10-18 | Claude Code | Fixed Codex's five P2 findings on the Phase 1 stack (#63 NDJSON bound, #64 body deadline, #66 configured ports, #72 relative imports, #74 link lifecycle), each with a regression that fails on the old code; replied on each PR; merged #63–#76 bottom-up with CI green; closed #59–#75. |
