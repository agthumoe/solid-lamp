# Brain access boundary (service scope)

Issue: [#120](https://github.com/agthumoe/solid-lamp/issues/120). Parent: [#4](https://github.com/agthumoe/solid-lamp/issues/4). Requirements: [brain](brain.md) → _MCP and access_, _Search contract_ (protected routes); review F6/F7. Consumers: brain routes ([#95](https://github.com/agthumoe/solid-lamp/issues/95)), brain CLI ([#96](https://github.com/agthumoe/solid-lamp/issues/96)) and MCP server ([#97](https://github.com/agthumoe/solid-lamp/issues/97)).

## Goal

Until owner session auth exists (Phase 3), brain routes serve only trusted local processes (the CLI and the stdio MCP server) that hold a dedicated service key. Authentication precedes all work: a rejected request never parses its body, queries the database, reads a file or embeds text.

## Contract

`registerServiceScope(app, { serviceKey, boundHost, maxInFlight, logger }, routes)` in `apps/api/src/plugins/service-scope.ts`. Every route registered inside it gets one `onRequest` hook that runs these checks in order:

| Order | Check                                                                                                              | Rejection             |
| ----: | ------------------------------------------------------------------------------------------------------------------ | --------------------- |
|     1 | A key is configured (`AETHERION_BRAIN_SERVICE_KEY`); otherwise fail closed                                         | 503 `UNAVAILABLE`     |
|     2 | The API is bound to loopback **and** the peer address is loopback (`127.0.0.0/8`, `::1`, IPv4-mapped loopback)     | 403 `FORBIDDEN`       |
|     3 | No browser request: neither an `Origin` nor a `Sec-Fetch-Site` header; no CORS headers are ever sent               | 403 `FORBIDDEN`       |
|     4 | `x-aetherion-service-key` matches, compared in constant time over SHA-256 digests (shared `createSecretCheck`)     | 401 `UNAUTHENTICATED` |
|     5 | Fewer than `maxInFlight` scoped requests are running; a slot frees when the response finishes or the client leaves | 429 `RATE_LIMITED`    |

- Every scoped response, errors included, carries `Cache-Control: no-store`.
- Rejections log only the event `http.service_scope`, the request ID and the error code. URLs, query strings, headers, bodies and keys are never logged.
- Routes outside the scope are unaffected.

## Configuration

`AETHERION_BRAIN_SERVICE_KEY` (api only): optional, 32–256 characters, and it must differ from `AETHERION_INFERENCE_SECRET`, so leaking one credential does not grant the other. Leaving it empty disables brain routes rather than opening them. Config errors name the key, never its value.

The non-loopback bind check means that if the owner binds the API to the Tailscale address (allowed by hard constraint 3), health stays reachable but brain routes refuse to serve. Exposing brain routes over Tailscale waits for Phase 3 owner auth and is a separate decision.

## Non-goals

- The search/stats/note routes and their per-route bounds: query size, candidate counts, excerpt bytes, deadlines (#95).
- Per-client rate windows. Concurrency is the bound for a single-user local service; a time-window limiter can be added with the routes if measurements need it.
- Owner sessions, CORS and the dashboard (Phase 3).
