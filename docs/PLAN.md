# Aetherion OS — Plan

Source of truth for phase status. Update at the end of every phase (see `AGENTS.md`).
Full requirements: [`BUILD_PROMPT.md`](BUILD_PROMPT.md).

**Current phase:** 1 — Scaffold (Phase 0 accepted by the owner 2026-10-15, #47)

Rounds 2 and 3 are merged and integrated (#38, #40): round-2 [domain diagnostics and readiness records](workstreams/round2/README.md); round-3 [Phase 0 decision packets](workstreams/round3/README.md) for the owner. Phase 0 acceptance, #31 downloads/inference and phase advancement remain gated on owner decisions.

GitHub tasks/milestones: [TRACKING.md](TRACKING.md). Standards: [development handbook](development/README.md). Create/select a task before project edits.

---

## Phase 0: Environment audit and models

- [x] Audit host: WSL, systemd, Docker, Node/pnpm, GPU, Ollama → `docs/HARDWARE.md`
- [x] Pull role models (`qwen3.5:9b`, `qwen3.5:4b`, `qwen3-embedding:0.6b`; `qwen2.5-coder:14b` already present)
- [x] Pull fallbacks (`qwen3:8b`, `gemma4:12b`; `nomic-embed-text` already present)
- [x] Benchmark harness `pnpm bench:models` (`scripts/bench/`)
- [x] Harness fixes from `docs/REVIEW.md` #1, #3, #4: strict tool scoring + schema validation, honest residency checks, per-stage result persistence, request timeouts
- [x] Review Phase 0 implementation and plan → `docs/REVIEW.md`
- [x] Fix remaining review findings: explicit text repair, strict residency allocation, all-path HTTP timeouts, atomic stage persistence, CLI validation, and regression tests (`pnpm test:bench`)
- [x] Apply Ollama settings (`infra/ollama/override.conf`, needs sudo) and verify in server log
- [x] Run `bench:models` with settings applied; write v2 table to `docs/HARDWARE.md`
- [x] Address validation gaps: required skipped targets must fail acceptance; validate embedding response counts/dimensions/values/norms (`VALIDATION.md`)
- [x] Resolve remaining benchmark findings ([#11](https://github.com/agthumoe/solid-lamp/issues/11)): semantic/format refusal metrics, required residency acceptance, duplicate CLI flags
- [x] Every resident model shows 100% GPU (chat 16K + embed 8K, v2 and v4 live runs; `results-tuned-v4.json`)
- [x] Owner confirms retained portfolio direction: keep all existing models; add evaluated legal/finance/accounting specialists and Qwen broad knowledge ([#17](https://github.com/agthumoe/solid-lamp/issues/17))
- [x] Final enabled model bindings/context/residency confirmed by the owner (#47): router, coder and vision share `qwen3.5:9b` at 16K with chat; embed 8K; deep disabled; specialists declined
- [x] Split domain plan into isolated workstreams and per-agent handoffs (#19)
- [x] Claude #20: specialist provenance and domain evaluation design (merged PR #26; review #27 findings resolved at e7e1f60)
- [x] Codex #21: retained catalog/routing/scheduling design and decision fixtures (merged PR #23)
- [x] Routing fixture integrity diagnostics and negative tests (#24, merged PR #25)
- [x] Resolve Claude review findings #27 and re-review exact updated head e7e1f60; all three resolved (merged PR #28)
- [x] Integrate both PRs (#26, #23, plus #25 and #28 merged 2026-10-14); shared plan/evaluation follow-ups are listed in STATUS Next and need their own tracked issues
- [x] Combined-main audit and canonical model inventory/evidence/tracking reconciliation (#29)
- [x] Round-2 workbench plan and handoffs (#33)
- [x] Codex: domain schema-v2 fixture diagnostics (#30, merged PR #37)
- [x] Claude: artifact/evaluation readiness dossier (#34 under #31, merged PR #36)
- [x] Round-2 integration and shared-change reconciliation (#38)
- [x] Round-3 decision packets: Codex #41 role/hardware packet (merged PR #45) and Claude #42 domain candidate and adoption-gate checklist (merged PR #44); integration and shared corrections (#40)
- [x] Owner decisions from the round-3 packets (#47): roles accepted; synthetic tests acceptable in Phase 0; D1–D3 declined
- [x] ~~Gated specialist artifact pinning and live comparisons (#31 under #15)~~: not pursued; owner declined D1–D3 (#47)
- **Phase 0 accepted by the owner, 2026-10-15 (#47).**
- [x] ADR 0001: Ollama location (`docs/adr/0001-ollama-location.md`)

## Phase 1: Scaffold

- [x] Foundations: ARCHITECTURE, structure, AI orchestration, testing, templates, ADR 0005 (proposed) ([#49](https://github.com/agthumoe/solid-lamp/issues/49), pending review)
- [ ] pnpm monorepo (`apps/*`, `packages/*`), strict TS, ESLint, Vitest, Makefile mirror (workspace, strict TS, ESLint with import boundaries [#71](https://github.com/agthumoe/solid-lamp/issues/71) and Makefile mirror done; Vitest arrives with the first suite that needs it, per the 2026-10-18 decision)
- [x] Development handbook/ADR 0003 and issue-first AGENTS adopted; `CLAUDE.md` imports canonical instructions
- [x] Project-local React/composition/Postgres skills pinned with license/provenance/hash checks
- [x] GitHub phase milestones/epics, issue/PR templates, baseline docs/tests CI
- [x] Owner-authorized baseline publication pushed; GitHub CI green ([#1](https://github.com/agthumoe/solid-lamp/issues/1))
- [x] Enforce current handbook: strict TS, typed lint/hooks/boundaries, formatting, Zod diagnostics and safe logging, negative policy tests, unified CI ([#13](https://github.com/agthumoe/solid-lamp/issues/13))
- [ ] Extend enforcement to API/DB/production LlmGate/logging and migration/restore integration tests when implemented
- [x] Decide embedding storage strategy: versioned fixed-dimension tables and atomic promotion → ADR 0002, `specs/embedding-storage.md`
- [x] Implement ADR 0002 schema in the first migrations ([#73](https://github.com/agthumoe/solid-lamp/issues/73), [spec](specs/brain-schema.md); replay/parity verified in CI on pgvector Postgres)
- [x] Supabase local project + first migrations (§7) ([#73](https://github.com/agthumoe/solid-lamp/issues/73), [#75](https://github.com/agthumoe/solid-lamp/issues/75), [spec](specs/supabase-local.md): Supabase Postgres via compose on loopback; CLI as migration operator; `supabase start` rejected for binding all interfaces)
- [x] Private binding/port checks at service introduction (`specs/security-recovery.md`) (inference/api loopback defaults #60/#61; doctor `bindings` #62; compose policy #67; Supabase Postgres on loopback #75)
- [x] Redis via `infra/docker-compose.yml` ([#67](https://github.com/agthumoe/solid-lamp/issues/67); running healthy on `127.0.0.1:6379`, `noeviction`, AOF)
- [x] `packages/shared` (config loader, zod schemas, pino logger) ([#52](https://github.com/agthumoe/solid-lamp/issues/52), [#56](https://github.com/agthumoe/solid-lamp/issues/56))
- [x] `packages/db` (Drizzle schema) ([#73](https://github.com/agthumoe/solid-lamp/issues/73); brain tables, client factory)
- [x] Spec `docs/specs/llm-gate.md`: queue limits, cancellation, interactive priority, starvation prevention, model/ctx switching, eviction behaviour
- [ ] Retained model catalog/status schema, semantic domain-role bindings and disclosed fallback; no candidate enabled without evidence (ADR 0004)
  - [x] Catalog with states/digests/scoped evidence; bindings validated at inference startup and by doctor ([#69](https://github.com/agthumoe/solid-lamp/issues/69), [spec](specs/model-catalog.md))
  - [ ] Domain-role bindings and disclosed fallback at runtime (with agents, Phase 3/7)
- [ ] `packages/llm` (role router, LlmGate, tool-call repair) + unit tests, including negative repair cases: JSON quoted in prose, scalar/invalid args, tools outside the allowlist (REVIEW #2)
  - [x] Pure core: role snapshots, gate queue/priority/cancellation/deadlines, embedding batch interleave, allowlisted tool-call validation and repair with REVIEW #2 negative cases ([#57](https://github.com/agthumoe/solid-lamp/issues/57), [spec](specs/llm-package.md))
  - [x] `apps/inference` Ollama adapter: residency/eviction observation, context reload accounting, transient retries, streaming ([#59](https://github.com/agthumoe/solid-lamp/issues/59), [spec](specs/inference-ollama-adapter.md))
  - [x] `apps/inference` RPC server, gate wiring, readiness; `packages/llm` `InferenceClient` ([#60](https://github.com/agthumoe/solid-lamp/issues/60), [spec](specs/inference-rpc.md))
- [x] `pnpm doctor` ([#62](https://github.com/agthumoe/solid-lamp/issues/62), [spec](specs/doctor.md); green on 2026-10-18 with Docker, Supabase Postgres, Redis, inference and api running)
- [x] `/health` endpoint reporting Ollama + DB ([#61](https://github.com/agthumoe/solid-lamp/issues/61), [spec](specs/api-health.md); `ready` with database/inference/Ollama `ok` on 2026-10-18)
- Acceptance target: `pnpm doctor` green, `packages/llm` tests pass, `/health` reports Ollama and DB

## Phase 2: Brain

- [ ] Spec `docs/specs/brain.md`
- [ ] Spec/task for book extraction and dated official-source ingestion; edition/location/jurisdiction/freshness citations (domain-agent plan)
- [ ] Obsidian ingestion (chokidar watch + full resync), frontmatter, wikilinks, tags, embeds
- [ ] Heading-aware chunking, incremental by content hash, renames/deletes
- [ ] Embeddings via `embed` role, `search_brain` hybrid + RRF, versioned rebuild/catch-up/promotion (ADR 0002)
- [ ] Representative long-chunk embedding comparison before reducing embed context
- [ ] Link extraction → `links`
- [ ] MCP access checks and source-path boundary tests at introduction (`specs/security-recovery.md`)
- [ ] `brain` MCP server; `brain:ingest`, `brain:query`, `brain:stats`
- [ ] Backup + restore smoke test before ingesting the real vault (REVIEW #6)
- [ ] Eval set over the real vault
- Acceptance target: Full vault ingested, incremental < 5 s, cited results, recall@5 ≥ 0.8

## Phase 3: Agent core

- [ ] Specs for supervisor, `concierge`, `librarian`
- [ ] Deterministic allowed-agent routing and bounded typed specialist delegation; owner selection wins, retrieved content cannot route
- [ ] Persona loader (`config/agents/*`), `PostgresSaver`
- [ ] Approval / `interrupt()` flow with a fake side-effect tool
- [ ] Fastify API with SSE; API/MCP access checks (auth, bind address) before any remote exposure (REVIEW #6)
- [ ] Approval tests: expiry, replay, concurrent decisions, resume after process restart (REVIEW #6)
- Acceptance target: Streamed cited answer via API; fake side-effect tool pauses, approves, rejects correctly

## Phase 4: Dashboard v1

- [x] Spec `docs/specs/dashboard.md`: routes ↔ API, auth, per-screen states and state ownership, approval lifecycle UI, keyboard map, tokens ([#51](https://github.com/agthumoe/solid-lamp/issues/51), in review)
- [ ] Home (health + approvals), Chat, Brain search, Runs, Approvals, Auth
- [ ] Feature/component size enforcement; Query/Zustand/URL state ownership, hooks and SSR policies; accessibility/component tests
- Acceptance target: Playwright smoke tests pass; reachable over Tailscale from phone

## Phase 5: Graph and workflows

- [ ] Graph page (notes, links, tags), Workflows page (graph render + run replay)
- Acceptance target: Full vault graph renders smoothly; run replay works

## Phase 6: Background engine and WhatsApp

- [ ] BullMQ, schedules, events, `sentinel`, notification policy
- [ ] WhatsApp adapter (default: `baileys`, `cloud-api` stub)
- [ ] Morning brief
- Acceptance target: Brief arrives on schedule; `/approve` works; non-allowlisted numbers ignored + logged

## Phase 7: Domain agents (spec-first, one at a time)

Owner-approved portfolio and delivery sequence: [domain-agent plan](specs/domain-agent-plan.md), [ADR 0004](adr/0004-domain-model-routing.md), [#17](https://github.com/agthumoe/solid-lamp/issues/17). Retain every model. Specialist evaluation remains [#15](https://github.com/agthumoe/solid-lamp/issues/15); workflows and activation remain unimplemented. Tax stays a separately scoped proposal.

- [ ] Coding-quality comparison on real repo tasks before changing coder model
- [ ] `coder` (repo ingestion + read tools)
- [ ] `planner` + tasks
- [ ] `inbox` (Gmail read-only)
- [ ] `knowledge` (Qwen3.5-9B + cited book/brain retrieval)
- [ ] `legal-us-tx` (scoped legal research; accepted Saul or disclosed Qwen baseline)
- [ ] `finance` (retain CSV spending; add statements/investment research; accepted Fin-R1 or disclosed Qwen baseline)
- [ ] `accountant` (read-only reconciliation and reviewed entry proposals; accepted CPA-Qwen or disclosed Qwen baseline)
- [ ] `coach`
- Acceptance target: Each agent's spec acceptance criteria and eval set pass

## Phase 8: Hardening

- [ ] Evals in CI, backups, service units, keep-alive docs, log retention, `ARCHITECTURE.md`
- Acceptance target: Survives reboot with all services back; documented end to end

---

## Decisions log

| Date       | Decision                                                                                                                                   | Why                                                                                                                                                                                    | Ref                                                                                                     |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| 2026-10-12 | Use Node 24 LTS (installed: v24.17.0) instead of Node 22                                                                                   | Node 24 is the active LTS; 22 is in maintenance. Native TS type stripping lets scripts run without a build step. Aligned with canonical AGENTS and package engine during review fixes. | HARDWARE.md                                                                                             |
| 2026-10-12 | Keep Ollama inside WSL (systemd service, already installed)                                                                                | Default in §17; GPU works through the Windows driver; no Windows-native Ollama installed to compare                                                                                    | `adr/0001-ollama-location.md`                                                                           |
| 2026-10-12 | Phase 0 retrieval quality uses a synthetic 10-note fixture                                                                                 | The brain doesn't exist yet; replaced by a real vault eval in Phase 2                                                                                                                  | `scripts/bench/fixtures/brain.json`                                                                     |
| 2026-10-12 | Isolate embeddings in versioned 1024/768 tables; atomic validated promotion, no query-time fallback                                        | Prevent dimension errors and mixed vector spaces                                                                                                                                       | `adr/0002-embedding-versions.md`                                                                        |
| 2026-10-12 | Introduce access/approval/restore gates before exposure or real data; specify bounded LlmGate                                              | Address review findings before the dependent services ship                                                                                                                             | `specs/security-recovery.md`, `specs/llm-gate.md`                                                       |
| 2026-10-13 | Adopt feature boundaries, single state ownership, Drizzle queries + one SQL history, small-component review rules and issue-first delivery | Maintainable implementation contracts and measurable review gates                                                                                                                      | [ADR 0003](adr/0003-development-architecture.md), [#1](https://github.com/agthumoe/solid-lamp/issues/1) |

Review fixes (2026-10-12): see `REVIEW.md`. Embedding storage and earlier security/restore gates are specified and adopted in this plan; their implementation stays in the relevant phases. Model roles and Phase 0 completion remain unconfirmed.

Validation follow-up (2026-10-12): both reproduced gaps fixed in harness v4; 12 regression groups and syntax checks pass → `VALIDATION.md`. Fresh hardware evidence remains separate from these stubbed checks.

Decision (2026-10-13, #17): retain every existing installed/planned model and add evaluated domain specialists; Qwen3.5-9B owns broad knowledge/synthesis. [ADR 0004](adr/0004-domain-model-routing.md) and [domain-agent plan](specs/domain-agent-plan.md) define activation gates, source grounding and sequential GPU swaps. Owner approved direction; final enabled settings and Phase 0 acceptance remain pending.
| 2026-10-15 | Phase 0 accepted. Initial bindings: chat, router, coder and vision share `qwen3.5:9b` at 16K; embed `qwen3-embedding:0.6b` at 8K; deep disabled. `qwen3.5:4b`, `qwen2.5-coder:14b` and all other installed models retained as unbound alternates. Specialist license residuals (D1–D3) declined: Saul, CPA-Qwen and Fin-R1 stay retained candidates, not acquired | Owner decision on the round-3 packets; shared profile avoids measured context-switch reloads; candidates' license chains unaccepted | [#47](https://github.com/agthumoe/solid-lamp/issues/47) |
| 2026-10-15 | Proposed: separate `apps/inference` process as the single LlmGate; Fastify + zod, Drizzle, BullMQ, LangGraph, Next/Query/Zustand, Vitest/Playwright candidate versions; pure-TS templates type-checked in CI | Cross-process GPU priority needs one queue owner; templates must not rot | [ADR 0005](adr/0005-phase1-stack-and-topology.md), [#49](https://github.com/agthumoe/solid-lamp/issues/49) |
| 2026-10-17 | Pure `packages/llm` core before the inference process: gate is a class with injected clock, jobs are `(signal) => Result`; workspace packages linked via `pnpm-workspace.yaml` `packages/*` | Gate behavior from the LlmGate spec is testable without Ollama or Docker; residency/eviction checks wait for `apps/inference` | [#57](https://github.com/agthumoe/solid-lamp/issues/57), `specs/llm-package.md` |
| 2026-10-18 | Ollama adapter lives in `apps/inference/src/ollama` (structure.md) and keeps `node:test`; `StreamEvent`/`collectStream` move into `packages/llm` as the client contract | ADR 0005 installs each library in the PR that first needs it; the adapter needs no new dependency, so Vitest arrives with the first suite that needs fake timers or Fastify | [#59](https://github.com/agthumoe/solid-lamp/issues/59), `specs/inference-ollama-adapter.md` |
| 2026-10-18 | Internal inference RPC: NDJSON stream, shared-secret header (SHA-256 + constant-time compare), 15 min max deadline, stream failures as terminal events in a 200 response; client throws only on `VALIDATION_FAILED`; exact-pin compliance now covers workspace manifests | Same streaming contract in-process and over RPC; no browser reconnect semantics needed; a rejected request shape is a caller bug | [#60](https://github.com/agthumoe/solid-lamp/issues/60), `specs/inference-rpc.md` |
| 2026-10-18 | `apps/api` readiness reports `not_configured` when `AETHERION_DATABASE_URL` is unset and reaches Ollama only via inference `/readyz`; health responses carry statuses only until Phase 3 auth | API can start and be checked while Docker/Supabase are down; one GPU authority; no information leak from an unauthenticated route | [#61](https://github.com/agthumoe/solid-lamp/issues/61), `specs/api-health.md` |
| 2026-10-18 | `pnpm doctor` lives in `scripts/doctor` as pure checks over injected probes; root links `@aetherion/shared` (`workspace:*`) to reuse runtime config validation; app processes not running are warnings | Doctor must reuse the exact runtime schemas, stay read-only, and be green without dev servers running | [#62](https://github.com/agthumoe/solid-lamp/issues/62), `specs/doctor.md` |
| 2026-10-18 | `config/catalog.yaml` is the retained inventory; a binding needs an enabled record accepted for the role with passed `gpu_context` evidence and no failed/revoked scoped evidence; inference refuses to start otherwise; doctor fails on a changed digest of an enabled record | Retention ≠ selection (ADR 0004); fail closed on contradictory config; a changed artifact invalidates its evidence | [#69](https://github.com/agthumoe/solid-lamp/issues/69), `specs/model-catalog.md` |
| 2026-10-18 | Migration invariants enforced in SQL (composite version/dimension FKs, partial unique active index, deferrable active-only search pointer); migration replay/parity tests run in CI against a digest-pinned `pgvector/pgvector:0.8.7-pg17` service and skip locally without a database URL | Database constraints, not application code, keep vector spaces apart; CI gives real Postgres verification while local Docker is down | [#73](https://github.com/agthumoe/solid-lamp/issues/73), `specs/brain-schema.md` |
| 2026-10-18 | Do not use `supabase start`; run `supabase/postgres` from `infra/docker-compose.yml` on `127.0.0.1:54322` and use the pinned Supabase CLI only for `migration up/list --db-url` (password via `PGPASSWORD`, telemetry disabled) | `supabase start` published Postgres and Kong on all interfaces with no bind option (hard constraint 3); one migration operator and Supabase's own image are kept | [#75](https://github.com/agthumoe/solid-lamp/issues/75), `specs/supabase-local.md` |
| 2026-10-18 | Relative imports are resolved and must stay inside their own `apps/*`/`packages/*` workspace (local ESLint rule); every link keeps `to_title` so target deletion only unresolves it | Codex review of #72/#74: path regexes missed sibling imports, and a nullable title conflicted with `ON DELETE SET NULL` | #72, #74 |

Review note (2026-10-15, #51): dashboard design issue reviewed for scope/acceptance only. Second review: explicit Auth and approval lifecycle coverage are recommendations for the planned spec, not confirmed design defects; earlier P2 severity withdrawn. Private visual draft was inaccessible and the spec is absent locally; Phase 4 checkboxes remain unchanged.

Review note (2026-10-15, #49 / PR #50, head `735a420`): previous approval atomicity and streaming error findings resolved. Full quality gates pass; BullMQ template still needs valid custom job IDs and path-aware document deduplication. Phase completion unchanged.

Review follow-up (2026-10-15, #49 / PR #50, head `fc86baf`): prior BullMQ findings resolved; remaining NFC path normalization collision reproduced on Linux. Quality gates pass; preserve filesystem identity before using the ingestion job template. Phase completion unchanged.

Review follow-up (2026-10-16, #49 / PR #50, head `41b8272`): all prior findings resolved; no new findings in latest changes. Actual-file collision check, full quality gates and CI pass. Framework Markdown templates remain reference-only pending library installation; phase checkboxes unchanged.
