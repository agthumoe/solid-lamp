# Aetherion development handbook

Status: adopted standards, 2026-10-13. Delivery task: [#1](https://github.com/agthumoe/solid-lamp/issues/1). Application enforcement is implemented in the phase shown below; a documented rule is not a claim that the application exists.

Read AGENTS → STATUS → PLAN → this index → the relevant guide before editing. Every change needs a GitHub issue with scope and acceptance criteria. Record architecture changes in an ADR and feature behavior in a spec before implementation.

| Guide | Covers | Enforcement begins |
|---|---|---|
| [Architecture and API](architecture-api.md) | SOLID, dependency direction, patterns, TypeScript, contracts | Phase 1 |
| [Frontend and state](frontend-state.md) | Small components, React hooks, Query, Zustand, SSR | Phase 4; foundation planned in Phase 1 |
| [Database and migrations](database.md) | Drizzle, SQL history, locks, versions, restore | Phases 1–2 |
| [AI engineering](ai.md) | Local inference, tools, approvals, evaluation | Phases 1–3 |
| [Operations](operations.md) | 12 factors, logs, debugging, runbooks | Phase 1 baseline; Phase 8 automation |
| [Delivery](delivery.md) | GitHub tasks, branches, reviews, CI, definition of done | Now |
| [Examples](examples.md) | Query/mutation, components, selectors, safe SSE lifecycle | Reference now; typecheck when frontend dependencies exist |
| [Skills and references](skills.md) | Pinned open-source skills, applicability, updates | Now |

## Non-negotiable review rules

- Local Ollama inference only; private service bindings; untrusted source content remains data.
- One responsibility per component/use case; explicit dependency direction; validate I/O at boundaries.
- No application DB query in a route or React component; no HTTP/framework dependency in pure domain rules.
- One owner per state value. Never mirror Query data into Zustand or redundant useState.
- No unreviewed destructive schema change, automatic `drizzle-kit push`, or migration on every worker startup.
- Every approval binds to an immutable action and one durable execution key. Reject/replay/restart paths are tested.
- Production logs are structured and redacted; private prompts, notes, email, tokens and credentials stay out of logs.
- PRs name their issue, explain behavior, show relevant checks and disclose checks not run.

## Enforcement roadmap

Phase 1 adds strict TypeScript (including unchecked-index and exact-optional review), ESLint hooks/dependency/import-boundary rules, formatting, Vitest, config schemas, Drizzle schema-drift tests, migration tests, Pino redaction tests, and API contract tests. Choose and pin exact compatible dependency versions then; this handbook does not install future runtime libraries.

Phase 2 adds vector-version/search, path-boundary, incremental-ingestion and restore tests. Phase 3 adds graph/tool/approval/restart/SSE tests. Phase 4 adds component accessibility, Query/Zustand ownership review, hook linting, component size checks and Playwright. Phase 8 automates operational recovery and retention. Issue exceptions need an owner, reason, and follow-up date; do not permanently suppress checks to bypass a failing design.
