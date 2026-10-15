# Shared runtime foundation

Issue: #52. Status: draft. Parent: #3. Architecture: [system architecture](../ARCHITECTURE.md) and [repository structure](../development/structure.md). Handbook contracts: [API errors](../development/architecture-api.md), [operations/logging](../development/operations.md).

## Goal

Provide a narrow, browser-safe-independent server package for expected failures, result values and structured application logging. Runtime features consume these shared primitives without importing logging infrastructure into domain rules.

## Scope

- `Result<T, E>` with `ok`/`err` constructors and a closed `AppError` code union.
- One exhaustive HTTP status map and a safe error-envelope mapper that adds the request ID.
- A Pino logger factory with typed service/component/correlation bindings and a strict event-field allowlist. The package owns Pino; callers receive a narrow `Logger` port.
- Unit tests for result/error mapping, safe envelope construction, valid and rejected log fields, redaction behavior, and scoped child bindings.

The existing Phase 0 diagnostic logger remains in place during this task. Runtime configuration parsing, contracts for individual features, IDs, clocks, and app composition roots are out of scope.

## Contracts

- Expected failures are values; unexpected programmer errors still throw.
- Error codes map exhaustively to documented HTTP statuses. Public envelopes expose only code, safe message, request ID and explicitly safe scalar details.
- Log event and binding schemas reject unknown fields and nested objects. Private prompts, documents, email, tokens, credentials and bank data are never accepted as fields. Pino redaction is a secondary safeguard for credential-shaped keys.
- Log levels are debug/info/warn/error and output is structured JSON. A child logger accepts only validated correlation/context bindings.
- Public package imports use `@aetherion/shared`; implementation subpaths remain private unless deliberately exported.

## Non-goals

No Fastify routes, DB/migrations, runtime service setup, config loader, network calls, model work, or replacement of the diagnostic scripts logger.

## Acceptance

- Strict TypeScript and typed lint pass; focused tests run from `pnpm test`; formatting and documentation checks pass.
- Compile-time exhaustiveness fails if an error code lacks a status.
- Tests prove arbitrary/private fields do not appear in serialized logs; unknown/nested fields are rejected; known secret paths are redacted.
- No new runtime dependency; no secrets or private artifacts.
