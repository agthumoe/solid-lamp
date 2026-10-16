# Code templates

Copyable starting points that show how the handbook rules look in code ([#49](https://github.com/agthumoe/solid-lamp/issues/49)). Copy the shape, rename, delete what you don't need. When a template and a guide disagree, the guide wins; fix the template in the same PR.

**Type-checked and tested now** (`pnpm typecheck`, `pnpm test:templates`): the `.ts` files below use only installed dependencies (zod, Node). **Reference only until their libraries are installed**: the `.md` templates. The PR that first installs a library ([ADR 0005](../../adr/0005-phase1-stack-and-topology.md)) moves the matching template into real code and verifies it against the pinned version.

| Template                                                                             | Layer / use                                                                                | Real home                                           |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ | --------------------------------------------------- |
| [result-and-errors.ts](result-and-errors.ts)                                         | `Result<T,E>`, error codes, HTTP mapping, error envelope                                   | `packages/shared/src/result.ts`, `errors/`          |
| [backend-feature/approval.ts](backend-feature/approval.ts)                           | Domain: pure state transition with invariants                                              | `apps/api/src/features/<f>/domain/`                 |
| [backend-feature/ports.ts](backend-feature/ports.ts)                                 | Application ports (narrow, capability-named)                                               | `apps/api/src/features/<f>/application/ports.ts`    |
| [backend-feature/decide-approval.ts](backend-feature/decide-approval.ts)             | Use case: deps first, `Result` out, no framework                                           | `apps/api/src/features/<f>/application/`            |
| [backend-feature/in-memory-approval-db.ts](backend-feature/in-memory-approval-db.ts) | Contract-honouring fake: isolated, staged, rolls back                                      | `apps/api/test/support/`                            |
| [backend-feature/decide-approval.test.ts](backend-feature/decide-approval.test.ts)   | Unit tests: atomic commit, rollback on outbox failure, replay, expiry, tamper, concurrency | Colocated `*.test.ts`                               |
| [tool-definition.ts](tool-definition.ts) + [test](tool-definition.test.ts)           | Agent tool shape, allowlist, strict input, approval hash, timeout                          | `packages/agents/src/tools/`                        |
| [inference-stream.ts](inference-stream.ts) + [test](inference-stream.test.ts)        | Streaming contract: one terminal event, typed errors, partial output                       | `packages/llm/src/`                                 |
| [fastify-route.md](fastify-route.md)                                                 | Transport: schema, auth, one use case, `Result` → HTTP                                     | `apps/api/src/features/<f>/transport/<f>-routes.ts` |
| [drizzle-adapter.md](drizzle-adapter.md)                                             | Infrastructure: port implementation, conditional writes                                    | `apps/api/src/features/<f>/infrastructure/`         |
| [migration-sql.md](migration-sql.md)                                                 | Supabase SQL migration with constraints, indexes, RLS                                      | `supabase/migrations/`                              |
| [bullmq-job.md](bullmq-job.md)                                                       | Worker job: zod payload, deterministic ID, idempotent handler                              | `apps/worker/src/jobs/<job>/job.ts`                 |
| [langgraph-graph.md](langgraph-graph.md)                                             | Graph state, node, wiring, approval interrupt                                              | `packages/agents/src/graphs/<graph>/`               |
| [agent-yaml.md](agent-yaml.md)                                                       | Agent config + persona                                                                     | `config/agents/<slug>/`                             |
| [react-feature.md](react-feature.md)                                                 | Query keys/options, mutation hook, small component                                         | `apps/web/src/features/<f>/`                        |
| [zustand-store.md](zustand-store.md)                                                 | Shared ephemeral client state                                                              | `apps/web/src/features/<f>/stores/`                 |
| [spec.md](spec.md)                                                                   | Feature/agent spec                                                                         | `docs/specs/<name>.md`                              |
| [adr.md](adr.md)                                                                     | Architecture decision record                                                               | `docs/adr/NNNN-<title>.md`                          |

The backend-feature files sit in one folder here for readability; in an app they split into `domain/`, `application/` and `test/support/` as shown in [structure](../structure.md#inside-a-backend-app-appsapi-appsworker-appsinference).

## How the layers fit (the approval example end to end)

```text
fastify-route.md ──calls──► decide-approval.ts ──uses──► approval.ts (pure rules)
   (transport)               (application)      └─needs─► ports.ts ◄─implements─ drizzle-adapter.md (prod, one transaction)
                                                                     ◄─implements─ in-memory-approval-db.ts (tests)
```
