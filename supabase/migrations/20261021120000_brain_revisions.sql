-- 20261021120000_brain_revisions.sql
-- Why: ADR 0006 (accepted 2026-10-21) and review findings F2/F5 (docs/reviews/phase2-plan-pr85.md):
-- immutable embedding profiles, document revisions (including tombstones), immutable chunk sets
-- keyed by revision + chunker, per-version chunk-set selection, durable ingest events with a
-- monotonic watermark, source sync state, resumable embedding builds and reader leases. Issue #91.
-- Spec: docs/specs/brain-revisions.md.
--
-- Compatibility: Phase 1 rows are preserved by the backfill below (revision 1 per document, plus a
-- tombstone revision for an already deleted document; one chunk set per document and chunker;
-- selections for every existing version; a legacy profile per version).
-- Locks/volume: ALTER TABLE on chunks, documents and embedding_versions takes ACCESS EXCLUSIVE
-- locks. Run before real ingestion (tables hold synthetic rows only), as one transaction; the
-- statement timeout bounds a stuck lock.
-- Rollback/forward-fix: no down migration. Before real ingestion a restore from the pre-migration
-- backup is the rollback; afterwards ship a forward fix.

set local lock_timeout = '10s';
set local statement_timeout = '5min';

-- Rows that must never change after insert (ADR 0006: immutable identities). Deletion stays
-- possible for retention/cleanup and cascades.
create function public.brain_reject_update() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  raise exception '% rows are immutable', tg_table_name using errcode = 'restrict_violation';
end;
$$;
revoke all on function public.brain_reject_update() from public;

-- Embedding profiles -------------------------------------------------------------------------
-- An opaque, immutable identity for one embedding space: artifact digest, dimensions, prefixes and
-- num_ctx. The inference registry resolves the ID; callers never send model tags or prefixes.
create table public.embedding_profiles (
  id              text primary key check (id ~ '^[a-z0-9][a-z0-9._-]{0,63}$'),
  model           text not null check (length(model) between 1 and 128),
  model_digest    text not null check (model_digest ~ '^[0-9a-f]{64}$'),
  dimensions      integer not null check (dimensions in (768, 1024)),
  query_prefix    text not null default '',
  document_prefix text not null default '',
  -- null only for profiles backfilled from Phase 1 versions, which never recorded num_ctx.
  num_ctx         integer check (num_ctx between 1 and 1048576),
  created_at      timestamptz not null default now(),
  constraint embedding_profiles_identity_key unique (id, dimensions, model_digest)
);
create trigger embedding_profiles_immutable before update on public.embedding_profiles
  for each row execute function public.brain_reject_update();

alter table public.embedding_versions add column profile_id text;
insert into public.embedding_profiles (id, model, model_digest, dimensions, query_prefix, document_prefix)
  select 'legacy-v' || v.id, v.model, v.model_digest, v.dimensions, v.query_prefix, v.document_prefix
  from public.embedding_versions v;
update public.embedding_versions set profile_id = 'legacy-v' || id;
alter table public.embedding_versions
  alter column profile_id set not null,
  -- A version's dimensions and digest are its profile's: one embedding space per version.
  add constraint embedding_versions_profile_fk foreign key (profile_id, dimensions, model_digest)
    references public.embedding_profiles (id, dimensions, model_digest),
  add constraint embedding_versions_id_chunker_key unique (id, chunker_version);
create index embedding_versions_profile_id_idx on public.embedding_versions (profile_id);

-- Document revisions ---------------------------------------------------------------------------
-- Every published state of a document, including deletion. A revision carries the citation and
-- filter identity (path, title, tags, frontmatter, exact source-byte hash) even when chunk text
-- and vectors are reused. Revisions are immutable; `documents.current_revision_id` moves forward
-- only through public.brain_publish_revision (compare-and-set).
create table public.document_revisions (
  id           bigint generated always as identity primary key,
  document_id  bigint not null references public.documents (id) on delete cascade,
  revision     bigint not null check (revision >= 1),
  kind         text not null check (kind in ('content', 'tombstone')),
  uri          text not null check (length(uri) between 1 and 2048),
  title        text not null default '',
  frontmatter  jsonb not null default '{}'::jsonb check (jsonb_typeof(frontmatter) = 'object'),
  tags         text[] not null default '{}',
  -- Hash of the exact source bytes; null for a tombstone.
  content_hash text check (content_hash ~ '^[0-9a-f]{64}$'),
  created_at   timestamptz not null default now(),
  constraint document_revisions_document_revision_key unique (document_id, revision),
  constraint document_revisions_id_document_key unique (id, document_id),
  constraint document_revisions_tombstone_hash check ((kind = 'tombstone') = (content_hash is null))
);
create trigger document_revisions_immutable before update on public.document_revisions
  for each row execute function public.brain_reject_update();

alter table public.documents add column current_revision_id bigint;
-- Backfill: revision 1 holds each Phase 1 document's state; a tombstoned document also gets a
-- tombstone revision 2, so a late job built on revision 1 can never resurrect it.
insert into public.document_revisions (document_id, revision, kind, uri, title, frontmatter, tags, content_hash, created_at)
  select d.id, 1, 'content', d.uri, d.title, d.frontmatter, d.tags, d.content_hash, d.created_at
  from public.documents d;
insert into public.document_revisions (document_id, revision, kind, uri, title, frontmatter, tags, content_hash, created_at)
  select d.id, 2, 'tombstone', d.uri, d.title, d.frontmatter, d.tags, null, d.deleted_at
  from public.documents d where d.deleted_at is not null;
update public.documents d set current_revision_id = (
  select r.id from public.document_revisions r
  where r.document_id = d.id order by r.revision desc limit 1);
-- The current revision must belong to the same document. Deferred: a publication inserts the
-- revision and moves the pointer in one transaction.
alter table public.documents
  add constraint documents_current_revision_fk foreign key (current_revision_id, id)
    references public.document_revisions (id, document_id) deferrable initially deferred;
create index documents_current_revision_id_idx on public.documents (current_revision_id);

-- Chunk sets -----------------------------------------------------------------------------------
-- The chunks one chunker produced for one revision. A new chunker or revision makes a new set;
-- active sets are never rewritten, so a failed rechunk leaves the old index and citations usable.
create table public.chunk_sets (
  id                   bigint generated always as identity primary key,
  document_revision_id bigint not null,
  document_id          bigint not null,
  chunker_version      text not null check (length(chunker_version) between 1 and 64),
  created_at           timestamptz not null default now(),
  constraint chunk_sets_revision_fk foreign key (document_revision_id, document_id)
    references public.document_revisions (id, document_id) on delete cascade,
  constraint chunk_sets_revision_chunker_key unique (document_revision_id, chunker_version),
  constraint chunk_sets_id_document_key unique (id, document_id),
  constraint chunk_sets_id_chunker_key unique (id, chunker_version)
);
create index chunk_sets_document_id_idx on public.chunk_sets (document_id);
create trigger chunk_sets_immutable before update on public.chunk_sets
  for each row execute function public.brain_reject_update();

-- Phase 1 chunks become one set per (document, chunker) on revision 1.
insert into public.chunk_sets (document_revision_id, document_id, chunker_version)
  select r.id, r.document_id, c.chunker_version
  from (select distinct document_id, chunker_version from public.chunks) c
  join public.document_revisions r on r.document_id = c.document_id and r.revision = 1;

alter table public.chunks
  add column chunk_set_id bigint,
  -- Inclusive 1-based source lines for citations; null only for backfilled Phase 1 chunks.
  add column line_start integer,
  add column line_end integer;
update public.chunks c set chunk_set_id = s.id
  from public.chunk_sets s
  where s.document_id = c.document_id and s.chunker_version = c.chunker_version;
alter table public.chunks
  alter column chunk_set_id set not null,
  drop constraint chunks_document_ordinal_key,
  add constraint chunks_set_ordinal_key unique (chunk_set_id, ordinal),
  -- A chunk's document and chunker are its set's.
  add constraint chunks_set_document_fk foreign key (chunk_set_id, document_id)
    references public.chunk_sets (id, document_id) on delete cascade,
  add constraint chunks_set_chunker_fk foreign key (chunk_set_id, chunker_version)
    references public.chunk_sets (id, chunker_version),
  add constraint chunks_line_range check (
    (line_start is null and line_end is null)
    or (line_start >= 1 and line_end >= line_start));
create index chunks_document_id_idx on public.chunks (document_id);
create trigger chunks_immutable before update on public.chunks
  for each row execute function public.brain_reject_update();

-- Per-version selection -----------------------------------------------------------------------
-- Which chunk set each embedding version uses for each document. Vector and lexical search both
-- read a pinned version's selection; the composite keys make a version select only sets of its
-- own chunker, for the right document.
create table public.embedding_version_selections (
  embedding_version_id bigint not null,
  document_id          bigint not null,
  chunk_set_id         bigint not null,
  chunker_version      text not null,
  selected_at          timestamptz not null default now(),
  primary key (embedding_version_id, document_id),
  constraint selections_version_fk foreign key (embedding_version_id, chunker_version)
    references public.embedding_versions (id, chunker_version) on delete cascade,
  constraint selections_set_document_fk foreign key (chunk_set_id, document_id)
    references public.chunk_sets (id, document_id) on delete cascade,
  constraint selections_set_chunker_fk foreign key (chunk_set_id, chunker_version)
    references public.chunk_sets (id, chunker_version)
);
create index selections_chunk_set_id_idx on public.embedding_version_selections (chunk_set_id);
create index selections_document_id_idx on public.embedding_version_selections (document_id);

insert into public.embedding_version_selections (embedding_version_id, document_id, chunk_set_id, chunker_version)
  select v.id, s.document_id, s.id, s.chunker_version
  from public.embedding_versions v
  join public.chunk_sets s on s.chunker_version = v.chunker_version
  join public.documents d on d.id = s.document_id and d.deleted_at is null;

-- Ingestion state ------------------------------------------------------------------------------
create table public.source_sync_state (
  source_id                 bigint primary key references public.sources (id) on delete cascade,
  last_scan_started_at      timestamptz,
  last_scan_completed_at    timestamptz,
  -- Only a complete scan may tombstone missing files (a partial/offline scan never mass-deletes).
  last_scan_complete        boolean not null default false,
  files_seen                integer not null default 0 check (files_seen >= 0),
  files_indexed             integer not null default 0 check (files_indexed >= 0),
  files_skipped             integer not null default 0 check (files_skipped >= 0),
  last_error_code           text check (last_error_code ~ '^[A-Za-z0-9_.:-]{1,64}$'),
  updated_at                timestamptz not null default now()
);

-- The durable record behind queue jobs: Redis is disposable, so a lost queue is rebuilt from
-- pending rows. `id` is the monotonic ingestion sequence (the watermark). Events reference the
-- durable document row (its path), never note text; `path_hash` is for logs.
create table public.ingest_events (
  id               bigint generated always as identity primary key,
  source_id        bigint not null references public.sources (id) on delete cascade,
  document_id      bigint references public.documents (id) on delete cascade,
  kind             text not null check (kind in ('changed', 'deleted', 'resync')),
  path_hash        text check (path_hash ~ '^[0-9a-f]{64}$'),
  -- The document revision the work was planned against; publication compares it (F5).
  base_revision_id bigint references public.document_revisions (id) on delete set null,
  status           text not null default 'pending'
                     check (status in ('pending', 'leased', 'done', 'failed', 'superseded')),
  attempts         integer not null default 0 check (attempts between 0 and 100),
  next_attempt_at  timestamptz not null default now(),
  lease_owner      text check (lease_owner ~ '^[A-Za-z0-9_.:-]{1,96}$'),
  lease_expires_at timestamptz,
  last_error_code  text check (last_error_code ~ '^[A-Za-z0-9_.:-]{1,64}$'),
  created_at       timestamptz not null default now(),
  processed_at     timestamptz,
  constraint ingest_events_target check ((kind = 'resync') = (document_id is null)),
  constraint ingest_events_path_hash check ((kind = 'resync') = (path_hash is null)),
  constraint ingest_events_lease check (
    (status = 'leased') = (lease_owner is not null and lease_expires_at is not null)),
  constraint ingest_events_processed check ((status in ('done', 'superseded')) = (processed_at is not null))
);
create index ingest_events_pending_idx on public.ingest_events (next_attempt_at, id)
  where status in ('pending', 'leased');
create index ingest_events_document_id_idx on public.ingest_events (document_id);
create index ingest_events_source_id_idx on public.ingest_events (source_id);
create index ingest_events_base_revision_id_idx on public.ingest_events (base_revision_id);

-- A resumable (re)build of one version: progress cursor and the ingestion watermark it covered.
create table public.embedding_builds (
  id                   bigint generated always as identity primary key,
  embedding_version_id bigint not null references public.embedding_versions (id) on delete cascade,
  status               text not null default 'running'
                         check (status in ('running', 'paused', 'completed', 'failed')),
  total_chunks         integer not null default 0 check (total_chunks >= 0),
  embedded_chunks      integer not null default 0 check (embedded_chunks >= 0),
  cursor_chunk_id      bigint,
  watermark_event_id   bigint,
  last_error_code      text check (last_error_code ~ '^[A-Za-z0-9_.:-]{1,64}$'),
  started_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  completed_at         timestamptz,
  constraint embedding_builds_progress check (embedded_chunks <= total_chunks),
  constraint embedding_builds_completed check ((status = 'completed') = (completed_at is not null))
);
create index embedding_builds_version_idx on public.embedding_builds (embedding_version_id);
-- One running/paused build per version; completed and failed attempts stay as history.
create unique index embedding_builds_one_open_idx on public.embedding_builds (embedding_version_id)
  where status in ('running', 'paused');

-- Bounded reader leases: an in-flight multi-step read (search, then excerpt) pins its version, and
-- cleanup of retired versions' chunk sets waits until every lease has expired.
create table public.embedding_version_leases (
  id                   bigint generated always as identity primary key,
  embedding_version_id bigint not null references public.embedding_versions (id) on delete cascade,
  holder               text not null check (holder ~ '^[A-Za-z0-9_.:-]{1,96}$'),
  acquired_at          timestamptz not null default now(),
  expires_at           timestamptz not null,
  constraint embedding_version_leases_bounded
    check (expires_at > acquired_at and expires_at <= acquired_at + interval '15 minutes')
);
create index embedding_version_leases_version_idx
  on public.embedding_version_leases (embedding_version_id, expires_at);

-- Publication and promotion --------------------------------------------------------------------
-- Publication and promotion serialize through one advisory lock key: publications take it shared
-- (they run concurrently with each other), promotion takes it exclusive. A promotion therefore
-- checks coverage against a state no publication can change until it commits (F2), with no
-- deferred-FK-only "coverage".

-- Moves a document to an already inserted revision only if its current revision is still the
-- one the work was planned against, so a delayed job cannot overwrite a newer edit or delete.
-- Revision numbers only grow. Then repoints the selection of every non-retired version whose
-- chunker has a set for the new revision, and drops selections on a tombstone.
-- Returns false (nothing changed) when the compare-and-set fails.
create function public.brain_publish_revision(
  p_document_id bigint,
  p_expected_revision_id bigint,
  p_revision_id bigint
) returns boolean
  language plpgsql
  security invoker
  set search_path = ''
as $$
declare
  v_current bigint;
  v_current_number bigint;
  v_new public.document_revisions%rowtype;
begin
  perform pg_catalog.pg_advisory_xact_lock_shared(pg_catalog.hashtext('aetherion.brain.publication'));
  select current_revision_id into v_current from public.documents
    where id = p_document_id for update;
  if not found then
    raise exception 'document % does not exist', p_document_id using errcode = 'no_data_found';
  end if;
  if v_current is distinct from p_expected_revision_id then
    return false;
  end if;
  select * into v_new from public.document_revisions where id = p_revision_id;
  if not found or v_new.document_id <> p_document_id then
    raise exception 'revision % does not belong to document %', p_revision_id, p_document_id
      using errcode = 'foreign_key_violation';
  end if;
  select revision into v_current_number from public.document_revisions where id = v_current;
  if v_current_number is not null and v_new.revision <= v_current_number then
    raise exception 'revision numbers must increase' using errcode = 'check_violation';
  end if;

  update public.documents set
    current_revision_id = p_revision_id,
    uri = v_new.uri,
    title = v_new.title,
    frontmatter = v_new.frontmatter,
    tags = v_new.tags,
    content_hash = coalesce(v_new.content_hash, content_hash),
    deleted_at = case when v_new.kind = 'tombstone' then pg_catalog.now() else null end,
    updated_at = pg_catalog.now()
  where id = p_document_id;

  if v_new.kind = 'tombstone' then
    delete from public.embedding_version_selections where document_id = p_document_id;
  else
    insert into public.embedding_version_selections (embedding_version_id, document_id, chunk_set_id, chunker_version)
      select v.id, p_document_id, s.id, s.chunker_version
      from public.embedding_versions v
      join public.chunk_sets s on s.chunker_version = v.chunker_version and s.document_revision_id = p_revision_id
      where v.status in ('building', 'ready', 'active')
    on conflict (embedding_version_id, document_id) do update
      set chunk_set_id = excluded.chunk_set_id, selected_at = pg_catalog.now();
  end if;
  return true;
end;
$$;

-- Atomically makes a version active (first promotion, a switch or a rollback) after checking, under
-- the exclusive publication lock, that it covers every live document's current revision: a
-- selection on that revision with the version's chunker, and a vector with a matching content hash
-- for every chunk in the selected sets. Raises with counts otherwise and changes nothing.
create function public.brain_promote_version(p_version_id bigint) returns void
  language plpgsql
  security invoker
  set search_path = ''
as $$
declare
  v_version public.embedding_versions%rowtype;
  v_missing_documents bigint;
  v_missing_vectors bigint;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('aetherion.brain.publication'));
  select * into v_version from public.embedding_versions where id = p_version_id for update;
  if not found then
    raise exception 'embedding version % does not exist', p_version_id using errcode = 'no_data_found';
  end if;
  if v_version.status not in ('ready', 'retired', 'active') then
    raise exception 'embedding version % is %, not ready', p_version_id, v_version.status
      using errcode = 'check_violation';
  end if;

  select pg_catalog.count(*) into v_missing_documents
  from public.documents d
  where d.deleted_at is null and d.current_revision_id is not null
    and not exists (
      select 1 from public.embedding_version_selections sel
      join public.chunk_sets s on s.id = sel.chunk_set_id
      where sel.embedding_version_id = p_version_id and sel.document_id = d.id
        and s.document_revision_id = d.current_revision_id);

  select pg_catalog.count(*) into v_missing_vectors
  from public.embedding_version_selections sel
  join public.documents d on d.id = sel.document_id and d.deleted_at is null
  join public.chunks c on c.chunk_set_id = sel.chunk_set_id
  where sel.embedding_version_id = p_version_id
    and not exists (
      select 1 from public.chunk_embeddings_1024 e
      where v_version.dimensions = 1024 and e.embedding_version_id = p_version_id
        and e.chunk_id = c.id and e.content_hash = c.content_hash
      union all
      select 1 from public.chunk_embeddings_768 e
      where v_version.dimensions = 768 and e.embedding_version_id = p_version_id
        and e.chunk_id = c.id and e.content_hash = c.content_hash);

  if v_missing_documents > 0 or v_missing_vectors > 0 then
    raise exception 'embedding version % does not cover the corpus: % documents without a current selection, % chunks without a matching vector',
      p_version_id, v_missing_documents, v_missing_vectors using errcode = 'check_violation';
  end if;

  update public.embedding_versions set status = 'retired'
    where status = 'active' and id <> p_version_id;
  update public.embedding_versions set status = 'active', promoted_at = pg_catalog.now()
    where id = p_version_id;
  update public.search_config set
    active_embedding_version_id = p_version_id,
    active_status = 'active',
    updated_at = pg_catalog.now();
end;
$$;

-- Privileges -----------------------------------------------------------------------------------
-- RLS on every new table (fails closed if the Supabase API ever exposes them).
alter table public.embedding_profiles enable row level security;
alter table public.document_revisions enable row level security;
alter table public.chunk_sets enable row level security;
alter table public.embedding_version_selections enable row level security;
alter table public.source_sync_state enable row level security;
alter table public.ingest_events enable row level security;
alter table public.embedding_builds enable row level security;
alter table public.embedding_version_leases enable row level security;

-- Group roles (NOLOGIN) for least-privilege runtime logins created by the operator. Roles are
-- cluster-wide, so create them only if missing. Neither can create or drop databases.
do $$
begin
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'aetherion_brain_reader') then
    create role aetherion_brain_reader nologin nocreatedb nocreaterole;
  end if;
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'aetherion_brain_writer') then
    create role aetherion_brain_writer nologin nocreatedb nocreaterole;
  end if;
end;
$$;

grant usage on schema public, extensions to aetherion_brain_reader, aetherion_brain_writer;
-- Readers (api search/stats/excerpts) read the corpus and take reader leases.
grant select on
  public.sources, public.documents, public.document_revisions, public.chunks, public.chunk_sets,
  public.links, public.embedding_profiles, public.embedding_versions,
  public.embedding_version_selections, public.chunk_embeddings_1024, public.chunk_embeddings_768,
  public.search_config, public.source_sync_state, public.embedding_builds
  to aetherion_brain_reader;
grant select, insert, delete on public.embedding_version_leases to aetherion_brain_reader;
-- The ingestion writer (worker) records revisions, chunks, vectors, events and progress. It cannot
-- promote versions or change profiles: promotion is an approved administrative action.
grant select on all tables in schema public to aetherion_brain_writer;
grant insert on public.document_revisions, public.chunk_sets, public.chunks,
  public.chunk_embeddings_1024, public.chunk_embeddings_768, public.links
  to aetherion_brain_writer;
grant insert, update on public.documents, public.ingest_events, public.source_sync_state,
  public.embedding_builds to aetherion_brain_writer;
grant delete on public.links to aetherion_brain_writer;
-- brain_publish_revision runs with the caller's privileges and repoints selections.
grant insert, update, delete on public.embedding_version_selections to aetherion_brain_writer;

-- RLS stays closed for every other role (including any Supabase API role): BYPASSRLS is not
-- inherited through membership, so the two brain roles get explicit policies instead. Grants
-- above still decide which commands each role may run.
do $$
declare
  t text;
begin
  foreach t in array array[
    'sources', 'documents', 'document_revisions', 'chunk_sets', 'chunks', 'links',
    'embedding_profiles', 'embedding_versions', 'embedding_version_selections',
    'chunk_embeddings_1024', 'chunk_embeddings_768', 'search_config', 'source_sync_state',
    'ingest_events', 'embedding_builds', 'embedding_version_leases'
  ] loop
    execute format('create policy %I on public.%I for select to aetherion_brain_reader using (true)',
      t || '_brain_reader', t);
    execute format('create policy %I on public.%I for all to aetherion_brain_writer using (true) with check (true)',
      t || '_brain_writer', t);
  end loop;
end;
$$;
create policy embedding_version_leases_brain_reader_write on public.embedding_version_leases
  for all to aetherion_brain_reader using (true) with check (true);

revoke all on function public.brain_publish_revision(bigint, bigint, bigint) from public;
revoke all on function public.brain_promote_version(bigint) from public;
grant execute on function public.brain_publish_revision(bigint, bigint, bigint) to aetherion_brain_writer;
