-- 20261023120000_brain_ingest.sql
-- Why: the ingestion pipeline (#139) uses ingest_events as its transactional outbox. A change
-- event records the exact-byte hash the watcher or resync observed, so the job's deterministic ID
-- (source + path + revision) can be rebuilt from Postgres after a Redis loss, and the same
-- observation is never queued twice. Spec: docs/specs/brain-ingestion.md.
-- Compatibility: additive (one nullable column, two partial unique indexes, one grant).
-- Rollback/forward-fix: drop the indexes and column.

set local lock_timeout = '10s';

-- SHA-256 of the observed file bytes for a `changed` event; null for `deleted` and `resync`.
alter table public.ingest_events
  add column observed_hash text check (observed_hash ~ '^[0-9a-f]{64}$'),
  add constraint ingest_events_observed_hash check ((kind = 'changed') = (observed_hash is not null));

-- At most one open event per document observation and one open resync per source; inserts use
-- ON CONFLICT DO NOTHING against these.
create unique index ingest_events_open_document_idx
  on public.ingest_events (document_id, kind, coalesce(observed_hash, ''))
  where status in ('pending', 'leased') and document_id is not null;
create unique index ingest_events_open_resync_idx
  on public.ingest_events (source_id)
  where status in ('pending', 'leased') and kind = 'resync';

-- The worker registers the sources configured in sources.yaml (name and kind only; roots stay in
-- local configuration). Profiles and versions remain administrative: no grant here.
grant insert on public.sources to aetherion_brain_writer;
