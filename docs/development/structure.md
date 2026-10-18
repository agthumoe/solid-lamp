# Repository structure and conventions

Status: canonical layout for Phase 1+ ([#49](https://github.com/agthumoe/solid-lamp/issues/49)). System view: [ARCHITECTURE](../ARCHITECTURE.md). Principles: [architecture and API](architecture-api.md), [ADR 0003](../adr/0003-development-architecture.md). Copyable starting points: [templates](templates/README.md).

Create only the folders a feature needs. An empty `infrastructure/` folder "for later" is noise.

## Repository tree

```text
aetherion-os/
├─ apps/
│  ├─ api/                 Fastify public API, auth, SSE, agent runs (in-process)
│  ├─ inference/           LlmGate scheduling authority + Ollama adapter (internal RPC)
│  ├─ worker/              BullMQ consumers, scheduler, outbox dispatcher
│  ├─ web/                 Next.js dashboard
│  ├─ channels/            WhatsApp adapters
│  └─ mcp/                 MCP servers (read tools)
├─ packages/
│  ├─ shared/              Contracts (zod DTOs), Result/AppError, config loader, logger factory, ids, time
│  ├─ db/                  Drizzle schema mirror, client factory, transaction helper, query adapters
│  ├─ llm/                 Inference RPC client, role resolution, gate core (pure), tool-call repair
│  ├─ brain/               Ingestion, chunking, embedding orchestration, hybrid search
│  ├─ agents/              LangGraph graphs, tools, prompts, agent registry
│  └─ evals/               Eval runners and suites (dev-only)
├─ config/                 models.yaml, agents/<slug>/{agent.yaml,persona.md}, schedules.yaml
├─ supabase/               Supabase CLI project; migrations/ is the only schema history
├─ evals/                  Synthetic fixtures (routing/, domain/, artifact-readiness/)
├─ scripts/                Phase 0 diagnostics and repo checks (native TS, no build)
├─ infra/                  docker-compose, systemd units, Ollama override, Windows docs
└─ docs/                   AGENTS-referenced docs, ADRs, specs, development handbook
```

## Inside a backend app (`apps/api`, `apps/worker`, `apps/inference`)

```text
apps/api/
├─ package.json            name: @aetherion/api; scripts: dev, build, start, test
├─ tsconfig.json           extends the root; references used packages
├─ src/
│  ├─ main.ts              Process entry: load config, build container, start server, handle SIGTERM
│  ├─ server.ts            buildServer(deps): registers plugins and feature routes; no I/O at import
│  ├─ config.ts            App-specific config schema (extends shared loader)
│  ├─ composition.ts       Composition root: constructs adapters and wires ports → use cases
│  ├─ plugins/             Cross-cutting Fastify plugins: auth, error mapping, request context, rate limits
│  └─ features/
│     └─ approvals/
│        ├─ domain/        Pure types, invariants, state transitions (no I/O, no framework)
│        ├─ application/   Use cases; each declares the narrow ports it needs
│        ├─ infrastructure/ Adapters implementing those ports (Drizzle, Redis, HTTP)
│        └─ transport/     Fastify routes: schema, auth, mapping only (`approval-routes.ts`)
└─ test/
   └─ integration/         Tests against real local Postgres/Redis; contract tests via `server.inject`
```

- **Unit tests are colocated** (`decide-approval.test.ts` next to `decide-approval.ts`). Integration tests live in `test/integration/`.
- `apps/worker/src/jobs/<job-name>/` holds `job.ts` (payload schema + handler) per job type; wiring is in `composition.ts`.
- `apps/inference/src/` holds `rpc/` (internal routes), `gate/` wiring of `packages/llm`'s gate core, and `ollama/` adapter.

## Inside a package

```text
packages/<name>/
├─ package.json            "exports": { ".": "./src/index.ts" } (single public entry; subpaths only if deliberate)
├─ src/
│  ├─ index.ts             The public API. Nothing outside the package imports any other file
│  └─ <module>/...         Internal modules; same domain/application/infrastructure split when it helps
└─ (tests colocated)
```

- `packages/shared/src/`: `contracts/<feature>.ts` (zod schemas + inferred types shared by api and web), `errors/`, `result.ts`, `config/`, `logging/`, `ids.ts`, `time.ts`. Browser-safe modules are exported from `@aetherion/shared/contracts`; server-only modules (config, logging) from the root entry.
- `packages/db/src/`: `schema/<table>.ts` mirroring SQL, `client.ts` (factory, no global), `transaction.ts`, `queries/<feature>/<query>.ts` for reusable read queries. Feature-specific write adapters stay in the app feature's `infrastructure/`.
- `packages/agents/src/`: `graphs/<graph>/`, `tools/<tool>/`, `prompts/<prompt>/`, `registry/`. See [AI orchestration](ai-orchestration.md#folder-layout).

## Inside the web app (`apps/web`)

```text
apps/web/src/
├─ app/                    Next.js routes, layouts, providers; composes features, owns no business logic
├─ features/
│  └─ approvals/
│     ├─ api/              fetchers, query-key factory, queryOptions, mutation functions
│     ├─ components/       feature components (one purpose each)
│     ├─ hooks/            orchestration hooks (query/mutation/stream)
│     ├─ stores/           feature Zustand store (only if shared ephemeral state exists)
│     └─ lib/              pure helpers for this feature
├─ components/ui/          shadcn/ui primitives; no fetching or business rules
└─ lib/                    api client (fetch + error mapping), query client factory, utilities
```

## Naming conventions

| Thing                         | Convention                                        | Example                                    |
| ----------------------------- | ------------------------------------------------- | ------------------------------------------ |
| Files and folders             | kebab-case                                        | `decide-approval.ts`, `approval-routes.ts` |
| Use case file / function      | verb-noun / camelCase                             | `decide-approval.ts` → `decideApproval`    |
| Domain module                 | noun                                              | `approval.ts`                              |
| Port (interface/type)         | Capability name, not "Repository"/"Service"       | `ApprovalStore`, `Clock`, `OutboxWriter`   |
| Adapter file                  | technology + capability                           | `drizzle-approval-store.ts`                |
| Fastify route file            | `<feature>-routes.ts` (source policy keys on it)  | `approval-routes.ts`                       |
| React component file / export | kebab-case file / PascalCase component            | `approval-card.tsx` → `ApprovalCard`       |
| Hook                          | `use-` file, `use` export                         | `use-approve.ts` → `useApprove`            |
| zod schema / inferred type    | `xxxSchema` / `Xxx`                               | `approvalSchema` / `Approval`              |
| Error codes                   | UPPER_SNAKE string literals                       | `APPROVAL_EXPIRED`                         |
| Env variables                 | `AETHERION_` prefix, UPPER_SNAKE                  | `AETHERION_DATABASE_URL`                   |
| Tests                         | `<unit>.test.ts(x)`; integration `*.int.test.ts`  | `decide-approval.test.ts`                  |
| Migrations                    | `supabase/migrations/<UTC timestamp>_<snake>.sql` | `20261020120000_create_approvals.sql`      |

## Code conventions

- **Named exports only** (Next.js route files that require default exports are the exception).
- **One reason to change per file.** Backend files over ~300 nonblank lines or functions over ~60 lines get a review question: what is the second responsibility? Frontend limits are in [frontend and state](frontend-state.md).
- **Functions over classes.** Use a class only for a stateful resource with a lifecycle (a connection pool, the gate). No parameter properties, no enums (use `as const` unions), no decorators.
- **Dependencies are parameters.** Use cases take `deps` as the first argument (or are created by `makeX(deps)`); nothing imports a configured client.
- **Errors:** return `Result<T, E>` for expected failures (validation, conflict, not found, expired); throw only for programmer errors and truly unexpected failures. Map to HTTP once, at the transport boundary. See [result and errors template](templates/result-and-errors.ts).
- **Async:** every I/O function accepts an `AbortSignal`; deadlines are absolute; no floating promises (lint enforces).
- **Comments** explain _why_, invariants and non-obvious constraints. No commented-out code; no restating the code.
- **Time and money:** UTC `Date`/ISO strings across boundaries, America/Chicago only for display and schedules; money in integer minor units or a decimal type with currency.

## Import rules

| From              | May import                                                   | Must not import                                  |
| ----------------- | ------------------------------------------------------------ | ------------------------------------------------ |
| `domain/`         | Same feature's domain, `@aetherion/shared` pure types/result | Fastify, React, Drizzle, Ollama, loggers, config |
| `application/`    | Its domain, its declared ports, shared types                 | Infrastructure adapters, transport, DB clients   |
| `infrastructure/` | Application ports (to implement), db/llm packages            | Transport, other features' internals             |
| `transport/`      | Application use cases, shared contracts                      | DB clients/Drizzle directly (source policy)      |
| A feature         | Another feature only through its public use case/contract    | Another feature's internal files                 |
| Any app           | Packages via their public entry                              | Another app's source                             |
| `apps/web`        | `@aetherion/shared/contracts`                                | `db`, `llm`, `agents`, `brain`, server config    |

The compliance AST checks reject domain→framework imports, transport→DB imports, cross-feature deep imports and cross-app imports. ESLint `no-restricted-imports` ([#71](https://github.com/agthumoe/solid-lamp/issues/71), `eslint.config.js`) adds the package rules: public entries only (no `@aetherion/<pkg>/src/…`; a local `aetherion/cross-workspace-relative` rule resolves every relative import, re-export and `import()` and rejects any that leaves its own `apps/*` or `packages/*` workspace), packages and apps never import apps, `packages/shared` imports no internal package, `/testing` doubles only in test files, and `apps/web` only `@aetherion/shared/contracts`. Package `exports` maps make the public entries explicit.
