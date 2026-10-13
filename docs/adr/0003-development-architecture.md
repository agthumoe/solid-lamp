# ADR 0003 — Feature modules, explicit boundaries, and single state ownership

Status: Accepted, 2026-10-13. Tracking: [#1](https://github.com/agthumoe/solid-lamp/issues/1).

## Decision

Use a modular monolith with separate process entry points. Feature modules contain transport adapters, application use cases, domain rules and infrastructure adapters. Composition roots wire dependencies; domain logic never imports Fastify, React, Drizzle or Ollama. Prefer functions and narrow interfaces over base classes or a DI container.

Use Fastify with validated request/response contracts, Drizzle for typed application queries, and a single ordered Supabase SQL migration history. Drizzle definitions mirror that SQL; do not maintain a second live migration ledger. Reviewed generated SQL is an input to the canonical history, never an automatic production schema change.

Next.js routes compose small feature components. TanStack Query owns browser server state; Zustand owns shared ephemeral client state; URL state owns shareable navigation/filter state; React local state owns isolated controls. Avoid duplicate stores. Server-rendered data hydration uses request-local caches/stores and a documented handoff to TanStack Query.

Adopt a 100-line target and 150-line extraction trigger per React component function; files over 250 nonblank lines need decomposition or an issue/PR exception. Responsibility and maintainability take precedence over padding or arbitrary splitting. Composition is the default; compound components/context are reserved for genuinely related controls.

Apply SOLID to boundaries and responsibilities, not to class count. External side effects retain the runtime approval/idempotency boundary. LlmGate is the only application inference gateway.

## Consequences

Features can be tested independently; the frontend has clear state ownership. SQL needs deliberate review and schema-drift tests. Some boilerplate is necessary at adapters, but generic repositories/service factories and duplicate frontend/server business logic are prohibited without a demonstrated need.

Implementation and automated enforcement belong to the existing phases. Details and exceptions are in `docs/development/README.md`. Upstream skills are advisory; AGENTS and project decisions override their hosting/library preferences.
