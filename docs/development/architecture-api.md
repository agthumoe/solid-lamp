# Architecture and API standards

Decision: [ADR 0003](../adr/0003-development-architecture.md). Contracts: [security/recovery](../specs/security-recovery.md).

## Dependency direction

Use `transport → application → domain`; infrastructure implements the ports the application needs. An entry point wires them. Domain may depend on pure shared value types, not shared environment loaders, loggers or database clients. Packages expose narrow public modules; avoid cross-feature deep imports and circular barrels. `apps/*` never import another app's source. `packages/shared` contains genuinely shared contracts/utilities, not a miscellaneous domain dump.

Typical feature shape:

```text
features/approvals/
  domain/approval.ts            # transitions/invariants
  application/decide-approval.ts # use case + narrow ports
  infrastructure/approval-store.ts # Drizzle adapter
  transport/approval-routes.ts  # Fastify schema, auth, mapping
  tests/
```

Only create layers a feature actually needs. A simple read query can use a small application query adapter; do not add an enterprise command bus or one class per table.

## SOLID in TypeScript

| Principle             | Required practice                                                                            | Smell to reject                                               |
| --------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Single responsibility | Split validation, domain transition, persistence and rendering into their natural boundaries | Controller that queries SQL, calls Ollama and formats JSX     |
| Open/closed           | Add an adapter/strategy behind an existing narrow port when a real provider variation exists | Switch on provider throughout the app                         |
| Liskov substitution   | Adapters/fakes honor failure, cancellation and side-effect contracts                         | Fake that ignores expiry or succeeds where production rejects |
| Interface segregation | Use-case-specific ports, such as `loadPendingApproval` and `decideOnce`                      | Huge repository exposing unrelated tables                     |
| Dependency inversion  | Pass ports/config through constructors or function arguments at composition roots            | Domain importing a globally constructed DB or HTTP client     |

Default patterns: functional core/imperative shell, ports/adapters, composition, strategy for role/provider selection, explicit state machines for approvals/jobs, transactional outbox for reliable DB→queue notifications. Use a repository only to express domain access/atomic operations; avoid generic CRUD base repositories. Use factories for scoped resources, not hidden global service locators. Model failure with typed errors or discriminated results; do not catch-and-return-success.

## TypeScript and quality

Strict TS, `unknown` at external boundaries, zod parsing before use, explicit async ownership and AbortSignal propagation. No `any`, assertion-based validation, non-null assertions or blanket suppressions in application code without a narrowly documented exception. Use discriminated unions for mutually exclusive states. Prefer immutable value updates, named exports, kebab-case files and explicit public entry points. Do not introduce enums/parameter properties into native-TS Phase 0 scripts.

## API contracts

- `/api/v1` is the application contract. Fastify routes handle schema/auth/request context/response mapping only; use cases enforce domain rules.
- Define shared request/response zod schemas with inferred DTOs; wire an exact-version-compatible Fastify schema compiler and OpenAPI generation during Phase 1. Fastify JSON-schema serialization must use the same declared contract; avoid competing validators.
- Validate path/query/body, content type, pagination bounds and response shape. Never perform DB lookups inside synchronous schema validation. Reject unknown mutation fields; cap request bodies and per-client/run concurrency.
- Return stable error envelopes `{ error: { code, message, requestId, details? } }`. Map bad input to 400, unauthenticated to 401, forbidden to 403, absent resources to 404, conflict to 409, expired decisions to 410, rate limits to 429, unavailable dependencies to 503. Internal stacks never go to clients. Details contain safe field errors, not raw payloads.
- Cursor pagination uses a deterministic tie-breaker, bounded `limit`, opaque validated cursor and stable filters. Dates are ISO UTC over the wire; display/schedules use America/Chicago.
- Authenticate reads, mutations and SSE consistently. Cookie-auth mutations require CSRF protection; lock CORS/origin to the dashboard. Private networking alone is not authentication.
- Mutations with external effects require an approval proposal first. An idempotency key and payload hash prevent retries from issuing duplicate effects. Do not auto-retry non-idempotent writes.
- Timeouts/deadlines cover queues and I/O. Cancellation tears down streams/subscriptions; disconnect does not silently re-run a committed action.
- SSE events include protocol version, runId, eventId/sequence and type. Support reconnect/dedup and bounded replay, or declare the replay window and force a REST resync. Use heartbeat/backpressure limits. A stream completion reconciles the Query cache with authoritative API state.

## API definition of done

Contract, auth/CORS/CSRF, malformed input, response serialization, pagination, cancellation, idempotency/conflict and dependency-error tests pass as applicable. Integrate against a real local DB for transactional behavior; mock external adapters only. OpenAPI/DTOs and examples match. Health distinguishes liveness from readiness without revealing secrets. References: [Fastify validation](https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/), [Fastify source/examples](https://github.com/fastify/fastify).
