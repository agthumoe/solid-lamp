# Baseline security and recovery gates

Goal: establish access, approval integrity, and recoverability before remote exposure or real-vault ingestion. Implementation belongs to the phases below; this specification does not claim those services exist yet.

Phase 1: all service bindings and container published ports default to 127.0.0.1 or an explicitly selected private interface. `doctor` verifies the configured bind policy. Plan schema/backups to include index versions and approval/audit state; secrets stay outside backup artifacts unless encrypted.

Phase 2, before real-vault ingest: back up a synthetic database, restore into an isolated local database, and verify documents, links, search/index version, and citations. A restore never overwrites the primary database. Document retention and recovery steps. Remote-capable brain MCP endpoints require access checks at introduction; stdio is restricted to the trusted local process boundary. Test unauthenticated HTTP rejection, origin policy, and source path boundaries including traversal and symlink escape.

Phase 3: require authentication/authorization on API and remote MCP before exposing any route over Tailscale. SSE and approval routes use the same access policy. Test denied access with no run/tool execution and locked CORS. Every approval stores an immutable action payload/hash, owner identity, expiry, run/checkpoint, and single-use state transition. Changed payloads require new approval. Dispatch uses a durable idempotency key; resumed/replayed/concurrent decisions cannot duplicate a side effect. A rejected/expired approval never executes. Test approval/rejection races and restart after decision, dispatch, and completion. If a downstream API cannot guarantee idempotency, ambiguous outcomes require reconciliation rather than blind retries.

Phase 4: session login UI and phone smoke test complete the existing API authentication policy. Do not defer server-side enforcement until the dashboard exists.

Phase 8: automate rotation, reboot recovery, and full operational checks. Earlier restore/access/approval tests remain required.
