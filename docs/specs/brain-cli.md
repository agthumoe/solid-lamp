# Brain CLIs

Issue: [#96](https://github.com/agthumoe/solid-lamp/issues/96). Parent: [#4](https://github.com/agthumoe/solid-lamp/issues/4). Requirements: [brain](brain.md) → _Search contract_ ("the CLI calls the same protected API contract, so it cannot bypass authorization or relevance gates"). Contracts: [brain API contracts](brain-api-contracts.md). Sibling: [brain MCP server](brain-mcp.md).

## Commands

| Command                                   | Calls                      | Status        |
| ----------------------------------------- | -------------------------- | ------------- |
| `pnpm run brain:query "<question>" [...]` | `GET /api/v1/brain/search` | Built         |
| `pnpm run brain:stats [--json]`           | `GET /api/v1/brain/stats`  | Built         |
| `pnpm run brain:ingest [--source ID]`     | ingest pipeline            | Waits for #91 |

Both names avoid pnpm built-ins (checked by `pnpm docs:check`) and are mirrored in the `Makefile` (`make brain:query ARGS='"question" --json'`).

`brain:query` options:

- `--limit N` (default 8, maximum 50).
- `--source ID` and `--tag TAG`, each repeatable; `--tag-mode any|all`.
- `--path-prefix DIR`.
- `--lexical`: explicit degraded mode.
- `--json`: prints the validated contract response unchanged.

## One client, one mapping

- The CLI and MCP server share `createBrainApiClient`, `toBrainSearchQuery` and `loadBrainClientConfig` from `@aetherion/shared`, so neither can apply different filters, bounds or access rules.
- The client and config moved there from `apps/mcp` for this. The test fake is `@aetherion/shared/testing`, usable by test files only.
- Configuration is the same as the MCP server: `AETHERION_BRAIN_SERVICE_KEY` is required, and `AETHERION_API_URL` must be http on loopback, without credentials.

## Output and exit codes

- **Human output:** the status line, degraded or incomplete labels, and per result the citation display, evidence and snippet.
- **Terminal safety:** note text is untrusted, so before printing, C0/C1 controls (including ESC, so no ANSI or OSC sequences), DEL, line separators and bidi overrides are replaced with U+FFFD. Line breaks and tabs become spaces.
- **Exit codes:**
  - `0`: an answer, including `no_match` and `not_indexed`, which are stated plainly.
  - `1`: a configuration or API error, printed as code plus fixed message. API messages and the key are never printed.
  - `2`: a usage error, reported before any configuration read or API call.
