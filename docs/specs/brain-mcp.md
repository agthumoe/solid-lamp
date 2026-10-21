# Brain MCP server (stdio)

Issue: [#97](https://github.com/agthumoe/solid-lamp/issues/97). Parent: [#4](https://github.com/agthumoe/solid-lamp/issues/4). Requirements: [brain](brain.md) → _MCP and access_. Contracts: [brain API contracts](brain-api-contracts.md). SDK: `@modelcontextprotocol/sdk` 1.32.1 ([ADR 0005](../adr/0005-phase1-stack-and-topology.md)).

## Goal

Make the brain usable from any local MCP client (agents through MCP adapters, Claude Code, Cursor) without a second path to the data: the server only calls the protected brain api, so it inherits its authentication, scope, relevance gates, bounds and staleness rules. It has no direct filesystem or database fallback.

## Process and transport

- `apps/mcp/src/brain/main.ts`, run with `pnpm dev:mcp-brain`. Transport is **stdio only**: the trusted boundary is the process that spawns it. No network listener; a streamable-HTTP endpoint is not built in Phase 2.
- stdout carries only MCP frames. Logs go to stderr and never include the key, queries or note text.
- Configuration:
  - `AETHERION_BRAIN_SERVICE_KEY` is required: the dedicated key the api checks on brain routes.
  - `AETHERION_API_URL` is optional, default `http://127.0.0.1:4000`. It must be **http on loopback**, without credentials, because brain routes serve loopback peers only and the key must not cross a network.
  - Invalid configuration exits 1 with key names only, and writes nothing to stdout.

Example client entry (owner's local MCP config; the key comes from the local environment, never from a committed file):

```json
{
  "mcpServers": {
    "aetherion-brain": {
      "command": "pnpm",
      "args": ["--silent", "--dir", "/path/to/solid-lamp", "dev:mcp-brain"]
    }
  }
}
```

## Tools

All three are read-only:

- annotations: `readOnlyHint: true`, `destructiveHint: false`, `idempotentHint: true`, `openWorldHint: false`;
- `_meta`: `sideEffect: false`, `risk: low`, `timeoutMs`;
- strict input schemas (unknown keys rejected before any api call);
- a per-call deadline combined with client cancellation.

| Tool             | Input                                                                                                   | Deadline | Calls                      |
| ---------------- | ------------------------------------------------------------------------------------------------------- | -------: | -------------------------- |
| `brain_search`   | `query` (1–1,000), `limit` (1–20, default 8), `sources`, `tags`, `tagMode`, `pathPrefix`, `lexicalOnly` |     20 s | `GET /api/v1/brain/search` |
| `brain_get_note` | `ref` from a search result, `maxChars` (1–8,000, default 2,000)                                         |      5 s | `GET /api/v1/brain/note`   |
| `brain_stats`    | none                                                                                                    |      5 s | `GET /api/v1/brain/stats`  |

- **`ref`** is base64url JSON of a result's citation identity: source, document, chunk, version, revision, content hash and the SHA-256 of the path. It saves the model copying seven fields and has a small fixed maximum length (`REF_MAX_CHARS`) however long the path is.
  - A ref is only a lookup key. The api decides whether it exists, is in scope and is current.
  - A forged ref returns `NOT_FOUND`; an outdated one returns `stale`, with no text. Never different text.
  - A malformed ref is rejected locally (`VALIDATION_FAILED`) without calling the api.
- **Untrusted text is fenced.**
  - Snippets, excerpts, titles, citation display strings and headings appear between `<note-data-NONCE>` markers. The nonce is random per response and guaranteed absent from the fenced text, so note content cannot close the fence.
  - A preamble says the content is data to quote or summarize, never instructions.
  - Generated fields (ref, ranks, scores, status) stay outside the fence.
- **Statuses are explicit.**
  - `no_match` tells the model to say nothing relevant was found.
  - `not_indexed` says there is no active index.
  - Degraded lexical-only mode and incomplete corpora are labelled.
- **Failures** are tool errors with a stable code and a fixed message. Codes: `VALIDATION_FAILED`, `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`, `RATE_LIMITED`, `UNAVAILABLE`, `DEADLINE_EXPIRED`, or `BAD_RESPONSE` for a reply that does not match the contract. API messages are never relayed.

## API client

Shared with the CLI from `@aetherion/shared` (`createBrainApiClient`, `toBrainSearchQuery`, `loadBrainClientConfig`; #96).

- Sends `x-aetherion-service-key` only to the configured loopback URL.
- **Never follows redirects**, so the key cannot be forwarded.
- Caps response bodies at 8 MiB, above the largest contract-valid response (about 4 MiB; a test builds it).
- Validates every 200 against the shared contract. Maps error envelopes to known codes; anything else is `UNAVAILABLE`.

## Tests (no GPU, database or real data)

- **Client, against a local fake api:**
  - key header and repeated filters;
  - envelope mapping;
  - contract violations and oversized bodies → `BAD_RESPONSE`;
  - deadline and unreachable cases;
  - the redirect is not followed and the redirect target never sees the key.
- **Server, through the SDK in-memory transport:**
  - exactly three tools, all read-only and strict;
  - bad arguments make zero api calls;
  - injected instructions come back inside the fence, with no follow-up calls;
  - ref → excerpt; stale and forged refs never return text;
  - error messages carry the code only;
  - `no_match` / `not_indexed` wording.
- **Stdio entry, as a real process:**
  - stdout contains only JSON-RPC frames;
  - the key reaches the api and is not logged;
  - bad configuration exits 1 with empty stdout.

**Pending with #95:** end-to-end access tests against the real brain routes. They cover absent or invalid keys, disallowed origins, and forged or out-of-scope citations returning one 404. Also pending: CLI/MCP parity with #96.
