# Aetherion OS — Plan

Source of truth for phase status. Update at the end of every phase (see `AGENTS.md`).
Full requirements: [`BUILD_PROMPT.md`](BUILD_PROMPT.md).

**Current phase:** 0 — Environment audit and models (in progress)

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
- [ ] Every resident model shows 100% GPU
- [ ] Model roles confirmed with owner
- [x] ADR 0001: Ollama location (`docs/adr/0001-ollama-location.md`)

## Phase 1: Scaffold

- [ ] pnpm monorepo (`apps/*`, `packages/*`), strict TS, ESLint, Vitest, Makefile mirror
- [x] Development handbook/ADR 0003 and issue-first AGENTS adopted; `CLAUDE.md` imports canonical instructions
- [x] Project-local React/composition/Postgres skills pinned with license/provenance/hash checks
- [x] GitHub phase milestones/epics, issue/PR templates, baseline docs/tests CI
- [x] Owner-authorized baseline publication pushed; GitHub CI green ([#1](https://github.com/agthumoe/solid-lamp/issues/1))
- [x] Enforce current handbook: strict TS, typed lint/hooks/boundaries, formatting, Zod diagnostics and safe logging, negative policy tests, unified CI ([#13](https://github.com/agthumoe/solid-lamp/issues/13))
- [ ] Extend enforcement to API/DB/production LlmGate/logging and migration/restore integration tests when implemented
- [x] Decide embedding storage strategy: versioned fixed-dimension tables and atomic promotion → ADR 0002, `specs/embedding-storage.md`
- [ ] Implement ADR 0002 schema in the first migrations
- [ ] Supabase local project + first migrations (§7)
- [ ] Private binding/port checks at service introduction (`specs/security-recovery.md`)
- [ ] Redis via `infra/docker-compose.yml`
- [ ] `packages/shared` (config loader, zod schemas, pino logger)
- [ ] `packages/db` (Drizzle schema)
- [x] Spec `docs/specs/llm-gate.md`: queue limits, cancellation, interactive priority, starvation prevention, model/ctx switching, eviction behaviour
- [ ] `packages/llm` (role router, LlmGate, tool-call repair) + unit tests, including negative repair cases: JSON quoted in prose, scalar/invalid args, tools outside the allowlist (REVIEW #2)
- [ ] `pnpm doctor`
- [ ] `/health` endpoint reporting Ollama + DB
- Acceptance target: `pnpm doctor` green, `packages/llm` tests pass, `/health` reports Ollama and DB

## Phase 2: Brain

- [ ] Spec `docs/specs/brain.md`
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
- [ ] Persona loader (`config/agents/*`), `PostgresSaver`
- [ ] Approval / `interrupt()` flow with a fake side-effect tool
- [ ] Fastify API with SSE; API/MCP access checks (auth, bind address) before any remote exposure (REVIEW #6)
- [ ] Approval tests: expiry, replay, concurrent decisions, resume after process restart (REVIEW #6)
- Acceptance target: Streamed cited answer via API; fake side-effect tool pauses, approves, rejects correctly

## Phase 4: Dashboard v1

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

Specialist research: [US/Texas shortlist](specs/domain-model-research.md), [#15](https://github.com/agthumoe/solid-lamp/issues/15). Tax/legal/accounting agents are proposals; evaluate scope/licenses/quality before adding them.

- [ ] Coding-quality comparison on real repo tasks before changing coder model
- [ ] `coder` (repo ingestion + read tools)
- [ ] `planner` + tasks
- [ ] `inbox` (Gmail read-only)
- [ ] `finance` (CSV)
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
