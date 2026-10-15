# Testing strategy

Status: Phase 1+ standard ([#49](https://github.com/agthumoe/solid-lamp/issues/49)). Phase 0 scripts keep using `node:test` (no build step); application packages and apps use **Vitest**. Frontend end-to-end uses **Playwright**. Versions are pinned in [ADR 0005](../adr/0005-phase1-stack-and-topology.md).

## What to test where

| Level             | Scope                                                              | Tools / doubles                                              | Runs in CI                               |
| ----------------- | ------------------------------------------------------------------ | ------------------------------------------------------------ | ---------------------------------------- |
| Unit (most tests) | Domain rules, use cases, nodes, pure helpers, prompt rendering     | In-memory fakes implementing ports; fake clock/ids           | Yes                                      |
| Contract          | HTTP routes (schema, auth, error envelope, pagination, SSE frames) | `server.inject` with fake use cases or a real test DB        | Yes                                      |
| Integration       | DB adapters, migrations, transactions, queues                      | Real local Postgres and Redis (Docker), isolated per run     | Yes (service containers, synthetic data) |
| Component (web)   | Feature components and hooks                                       | Testing Library, MSW or fake fetchers, fresh QueryClient     | Yes                                      |
| End-to-end (web)  | Critical journeys: login, chat stream, approve/reject              | Playwright against a local stack with a fake inference       | Smoke set                                |
| Evaluation        | Model/prompt quality, tool safety, retrieval                       | Fixtures in `evals/`; fake gate in CI, local Ollama manually | Structure only                           |

**Never in CI:** live Ollama/GPU calls, real WhatsApp/Gmail, private data. Inference in tests always goes through a fake `InferenceClient`.

## Rules

- **Test behaviour through public functions**, not private internals. One behaviour per test, named as a sentence: `it('rejects a decision after the approval expired')`.
- **Arrange / act / assert** with blank lines between. Keep setup in builders (`makeApproval({ status: 'pending' })`) rather than giant fixtures.
- **Fakes honour the contract** (Liskov): a fake store must reject a second decision, respect expiry, honour `AbortSignal` and return the same error types as the real adapter. A fake that only returns success is a bug.
- **Deterministic:** inject `Clock` and ID generators; never `sleep`; use Vitest fake timers for time-based logic. No network.
- **Errors are tested:** each `Result` failure branch and each HTTP error mapping has a test.
- **Safety cases are required** for anything touching approvals, tools or untrusted content: replay, concurrent decision, expiry, payload tampering, injected instructions in source text.
- **Database tests** run in a fresh schema/database migrated from the full `supabase/migrations` history; each test runs in a transaction that rolls back, or truncates its tables. Never share state between tests.
- **Frontend:** query by role/label, not test IDs, when possible; assert loading, empty, error and stale states; a fresh `QueryClient` per test with retries off.
- **Coverage is a signal, not a goal.** Domain and application code should be close to fully covered; transport is covered by contract tests; generated code is excluded.

## Layout and naming

```text
apps/api/src/features/approvals/application/decide-approval.ts
apps/api/src/features/approvals/application/decide-approval.test.ts   ← unit, colocated
apps/api/test/integration/approvals.int.test.ts                       ← integration (real DB)
apps/api/test/support/                                                ← builders, fakes, test server
apps/web/src/features/approvals/components/approval-card.test.tsx     ← component
apps/web/e2e/approve-flow.spec.ts                                      ← Playwright
```

Shared fakes for package ports (`FakeInferenceClient`, `FakeClock`) are exported from a package's `testing` entry (`@aetherion/llm/testing`), never from its production entry.

## Commands (wired in Phase 1)

| Command         | Runs                                                        |
| --------------- | ----------------------------------------------------------- |
| `pnpm test`     | Phase 0 `node:test` suites + Vitest unit/contract/component |
| `pnpm test:int` | Integration suites (needs local Postgres/Redis)             |
| `pnpm test:e2e` | Playwright smoke                                            |
| `pnpm check`    | Lint, typecheck, unit tests, fixture checks, docs, format   |

## Definition of done for a test suite

A PR that adds behaviour adds the tests that would fail without it. A bug fix starts with a failing regression test. Skipped tests need an issue link and a reason; they don't merge silently.
