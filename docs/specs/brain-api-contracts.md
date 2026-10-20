# Brain API contracts

Issue: [#124](https://github.com/agthumoe/solid-lamp/issues/124). Parent: [#4](https://github.com/agthumoe/solid-lamp/issues/4). Requirements: [brain](brain.md) → _Search contract_, _MCP and access_. Access boundary: the brain-access spec ([#120](https://github.com/agthumoe/solid-lamp/issues/120)). Consumers: routes ([#95](https://github.com/agthumoe/solid-lamp/issues/95)), CLI ([#96](https://github.com/agthumoe/solid-lamp/issues/96)), MCP ([#97](https://github.com/agthumoe/solid-lamp/issues/97)).

## Goal

One wire contract for the three protected brain routes, shared by the api (request validation and response serialization), the CLI and the MCP server (response parsing). It lives in `packages/shared/src/contracts/brain.ts` and is exported from the browser-safe `@aetherion/shared/contracts` entry, which imports only `zod` (enforced by a test).

## Routes

| Route                      | Request                  | 200 response                |
| -------------------------- | ------------------------ | --------------------------- |
| `GET /api/v1/brain/search` | `brainSearchQuerySchema` | `brainSearchResponseSchema` |
| `GET /api/v1/brain/note`   | `brainNoteQuerySchema`   | `brainNoteResponseSchema`   |
| `GET /api/v1/brain/stats`  | none                     | `brainStatsResponseSchema`  |

Errors use the standard envelope. Notable mappings:

- Embedding unavailable with `mode=hybrid`: 503 `UNAVAILABLE`.
- Unknown or out-of-scope citation: 404 `NOT_FOUND`, the same answer for both so scope cannot be probed.
- Auth and limits per the brain-access spec ([#120](https://github.com/agthumoe/solid-lamp/issues/120)).

## Decisions

- **Search request.**
  - `q` is trimmed, 1–1,000 characters. `limit` defaults to 8, maximum 50.
  - Filters: up to 8 `source` IDs, up to 16 `tag`s with `tagMode` `any`/`all`, and a component-aware `pathPrefix`. Repeated querystring keys become arrays.
  - Unknown keys are rejected. In particular, callers cannot choose `versionId`: the use case pins the active version.
- **Degraded mode is explicit.** `mode=lexical` must be requested and is reported back as `mode: lexical_only`. Hybrid never silently falls back.
- **Search statuses.**
  - `ok`: at least one result.
  - `no_match`: candidates existed but none passed the evidence gates; zero results.
  - `not_indexed`: no active version; `versionId: null`.
  - Every response labels `corpus` `complete`/`incomplete` and reports `tookMs`.
- **Results.**
  - Each result carries both branch ranks (`null` when a branch did not return it), cosine and lexical evidence, a snippet of at most 1,200 characters, and a citation DTO.
  - The citation DTO holds the display string plus the structured identity: source, document, revision, content hash, chunk, pinned version, path, heading path and occurrence, and line range.
  - Snippets and excerpts are untrusted note text. Consumers wrap them in data delimiters and never act on them.
- **Note.**
  - The request is the citation identity (source, document, chunk, version, revision, content hash, path) plus `maxChars` (default 2,000, maximum 8,000).
  - The response is either `ok` with a bounded excerpt and a `truncated` flag, or `stale` with a reason (`deleted`/`revision`/`content`/`path`) and **no text**. A citation is never answered from a different revision.
- **Stats.**
  - Reports the active version: ID, `embedRole` (always the role `embed`, never a model tag), dimensions, chunker version and promotion time.
  - Reports document, chunk and embedded-chunk counts, corpus completeness, and per-source last ingest and last scan state.
  - Timestamps are ISO UTC.

## Relation to `@aetherion/brain`

The wire DTO bounds sizes and shapes. Domain validation of citation paths, the canonical display form and staleness checks stays in the brain package's citation codec ([#118](https://github.com/agthumoe/solid-lamp/issues/118)), which the route's use case applies. `packages/shared` imports no internal package, so it does not reuse brain types.

## Open questions

| Question                                              | Default until answered                                                                                 |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Final stats fields once the task-5 schema lands (#91) | This shape; #95 may extend it in the same PR that implements the route                                 |
| Excerpt bound for book sources                        | 1,200 characters per the book-sources spec ([#114](https://github.com/agthumoe/solid-lamp/issues/114)) |
