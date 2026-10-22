# Brain ingestion pipeline

Issue: [#139](https://github.com/agthumoe/solid-lamp/issues/139). Parent: [#4](https://github.com/agthumoe/solid-lamp/issues/4). Completes the worker side of [#93](https://github.com/agthumoe/solid-lamp/issues/93) and provides `brain:ingest` for [#96](https://github.com/agthumoe/solid-lamp/issues/96). Requirements: [brain](brain.md) → _Ingestion rules_, _Embedding lifecycle_; review F5. Builds on [revisions schema](brain-revisions.md), [embedding profiles](inference-rpc.md), [worker](worker.md), [source boundary](source-boundary.md).

## Flow

1. **Detection.**
   - The watcher (`createVaultWatcher`, enabled sources only) and full resyncs produce **durable `ingest_events`** in Postgres: `changed` (with the observed exact-byte hash), `deleted`, or `resync`.
   - Watcher events are hints. Each batch is re-observed through the verified reader.
   - A nameless event, a folder-like event or a watch error requests a resync, and the watcher is recreated after an error.
   - Open events are deduplicated per document observation and per source resync.
2. **Relay** (every second; one run at a time).
   - Pending events, or leased events whose lease expired, are enqueued as BullMQ jobs and leased for 15 minutes.
   - **Job identity follows the event** (`eventId` is part of the job ID). A re-send after a Redis loss deduplicates, but a new event for the same bytes always runs; that covers a delete right after an edit and an A→B→A edit.
3. **`ingest.document`.**
   - **Before reading:** take an event watermark. Then read through the verified reader and hash the exact bytes.
   - **Missing or ineligible file** (excluded, too large, symlink, …): publish a **tombstone** revision.
   - **Unchanged hash:** nothing is published.
   - **Otherwise:** `parseNote` → `chunkMarkdown` → one transaction holding the document row (if new), an immutable revision, a chunk set, chunks with line ranges, the replacement links (resolved by path within the source), and then `brain_publish_revision`.
   - **Lost compare-and-set:** the transaction rolls back and the job reports `superseded`. A late job never overwrites a newer edit or delete.
   - **Embeddings:** for each non-retired version, chunks of the document's current revision without vectors are embedded in batches of 32. Each batch uses the version's **pinned profile** at background priority. The returned profile ID and dimensions must match before any vector is stored. Inference unavailable means retryable; an identity mismatch is permanent.
   - **Completion:** events for the path up to the watermark are marked done. A later event stays pending and runs again, which is idempotent.
4. **`ingest.resync`.**
   - `scanSource` → `planChanges` against the indexed revision hashes → events.
   - A failed or partial listing records an incomplete scan and **plans nothing**, so there are no mass deletes.
   - `source_sync_state` records the scan counts; `sources.last_synced_at` is updated on a complete scan.
5. **Startup.** The worker requests a resync for each enabled source, so a restart converges without relying on Redis.

## Configuration (`apps/worker`)

- `AETHERION_DATABASE_URL` (private Postgres) and `AETHERION_INFERENCE_SECRET` must be set together, with `AETHERION_INFERENCE_URL` (default `http://127.0.0.1:4100`). Without them, handlers stay `NOT_WIRED` and nothing is read.
- `AETHERION_WORKER_WATCH` (default `true`).
- Sources come from `config/sources.yaml`. Only `enabled: true` sources get a reader, so the real vault stays off until the owner approves it (D2).

## Administrative boundary

- The worker registers sources but never creates embedding profiles or versions, and never promotes.
- Creating a building version from an approved profile, calibrating gates and `brain_promote_version` remain owner/maintenance actions; the writer role cannot perform them (#91).
- Until a version exists, revisions are published and lexically indexed but not embedded.

## `pnpm run brain:ingest [--source ID]... [--wait] [--timeout S]`

- Requests a resync of the named enabled sources (default: all enabled) through the same outbox; the running worker executes it.
- A disabled or unknown source is refused (exit 2) before any database work.
- `--wait` follows until the source's events are processed, then prints document counts and scan state. It exits 1 on failed events or a timeout.

## Verification

- **Unit (`features/ingest/application/ingest.test.ts`):**
  - a new note is published with its exact-byte hash, tags and line-ranged chunks, and embedded with the version profile;
  - unchanged bytes don't republish but still complete missing vectors after an inference outage (retryable);
  - a frontmatter-only edit makes a new revision;
  - deleted and too-large files become tombstones;
  - a raced late job is `superseded` and the newer tombstone stands;
  - a disabled source fails permanently without reading;
  - an embedding with another profile or dimensions is never stored;
  - resync plans adds, edits, renames and deletes, and a failed listing plans nothing;
  - a later event stays pending past the watermark.
- **Job identity:** event-based IDs are deterministic per event and distinct across events.
- **End to end (`apps/worker/test/integration/ingest-pipeline.int.test.ts`, real Postgres and Redis, fake inference client):**
  - the 40-note fixture vault is resynced, published and fully embedded, with line ranges and links;
  - the version then passes `brain_promote_version`;
  - **a file edit is picked up by the watcher and visible as revision 2 with vectors in about 0.8 s** (fake embedder; no model or GPU time);
  - a delete becomes a tombstone, and coverage still holds.

## Not yet

- The end-to-end latency with the real embedding model (cold and busy GPU) is the measured acceptance run in #93/#98, on the owner's machine.
- An administrative command to create a building version from the default profile.
- A periodic full resync schedule (Phase 6 schedules).
