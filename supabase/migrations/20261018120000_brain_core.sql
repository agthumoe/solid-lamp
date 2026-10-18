-- 20261018120000_brain_core.sql
-- Why: the brain's durable core (BUILD_PROMPT §7) and ADR 0002 versioned embedding storage
-- (docs/specs/embedding-storage.md). Issue #73.
-- Rollback/forward-fix: dropping these tables is safe only before any ingestion; afterwards
-- ship forward fixes. No data is migrated by this file.
-- Extensions live in the `extensions` schema (Supabase convention), so every vector type and
-- operator class below is schema-qualified and works without a search_path change.

create schema if not exists extensions;
create extension if not exists vector with schema extensions;

-- Read-only sources the brain ingests. `config` holds paths/filters only, never credentials.
create table public.sources (
  id             bigint generated always as identity primary key,
  kind           text not null
                   check (kind in ('obsidian', 'repo', 'email', 'finance_csv', 'manual')),
  name           text not null unique check (length(name) between 1 and 200),
  config         jsonb not null default '{}'::jsonb check (jsonb_typeof(config) = 'object'),
  enabled        boolean not null default true,
  last_synced_at timestamptz,
  created_at     timestamptz not null default now()
);

-- One row per source file/message. Deletions in the source are tombstoned so rebuilds and
-- search can reconcile them; content_hash drives change detection.
create table public.documents (
  id           bigint generated always as identity primary key,
  source_id    bigint not null references public.sources (id) on delete cascade,
  uri          text not null check (length(uri) between 1 and 2048),
  title        text not null default '',
  frontmatter  jsonb not null default '{}'::jsonb check (jsonb_typeof(frontmatter) = 'object'),
  tags         text[] not null default '{}',
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  deleted_at   timestamptz,
  updated_at   timestamptz not null default now(),
  created_at   timestamptz not null default now(),
  constraint documents_source_uri_key unique (source_id, uri)
);
create index documents_tags_idx on public.documents using gin (tags);

-- Heading-aware chunks. No embedding column: vectors live in versioned dimension tables.
create table public.chunks (
  id              bigint generated always as identity primary key,
  document_id     bigint not null references public.documents (id) on delete cascade,
  ordinal         integer not null check (ordinal >= 0),
  heading_path    text[] not null default '{}',
  content         text not null,
  content_hash    text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  token_count     integer not null check (token_count >= 0),
  chunker_version text not null check (length(chunker_version) between 1 and 64),
  metadata        jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  tsv             tsvector generated always as (to_tsvector('english', content)) stored,
  created_at      timestamptz not null default now(),
  constraint chunks_document_ordinal_key unique (document_id, ordinal)
);
create index chunks_tsv_idx on public.chunks using gin (tsv);

-- Graph edges. Every link keeps its target label (wikilink text, tag, import path), so deleting
-- the target document only unresolves the edge (to_document_id -> null); it never blocks the
-- delete or leaves a link with no target at all.
create table public.links (
  id               bigint generated always as identity primary key,
  from_document_id bigint not null references public.documents (id) on delete cascade,
  to_document_id   bigint references public.documents (id) on delete set null,
  to_title         text not null check (length(to_title) between 1 and 500),
  kind             text not null check (kind in ('wikilink', 'tag', 'mention', 'import')),
  created_at       timestamptz not null default now()
);
create index links_from_document_id_idx on public.links (from_document_id);
create index links_to_document_id_idx on public.links (to_document_id);

-- ADR 0002: each embedding model/prefix/chunker combination is a version. Supported
-- dimensions are registered here; adding one needs a migration and a new dimension table.
create table public.embedding_versions (
  id              bigint generated always as identity primary key,
  model           text not null check (length(model) between 1 and 128),
  model_digest    text not null check (model_digest ~ '^[0-9a-f]{64}$'),
  dimensions      integer not null check (dimensions in (768, 1024)),
  query_prefix    text not null default '',
  document_prefix text not null default '',
  chunker_version text not null check (length(chunker_version) between 1 and 64),
  status          text not null default 'building'
                    check (status in ('building', 'ready', 'active', 'retired', 'failed')),
  promoted_at     timestamptz,
  created_at      timestamptz not null default now(),
  -- Targets for composite foreign keys: rows must match their version's dimension, and the
  -- search config may only point at an active version.
  constraint embedding_versions_id_dimensions_key unique (id, dimensions),
  constraint embedding_versions_id_status_key unique (id, status),
  constraint embedding_versions_active_promoted
    check (status <> 'active' or promoted_at is not null)
);
-- At most one active version at any time.
create unique index embedding_versions_one_active_idx
  on public.embedding_versions ((true)) where status = 'active';

create table public.chunk_embeddings_1024 (
  embedding_version_id bigint not null,
  chunk_id             bigint not null references public.chunks (id) on delete cascade,
  dimensions           integer not null default 1024 check (dimensions = 1024),
  -- The chunk hash this vector was computed from; a mismatch with chunks.content_hash is stale.
  content_hash         text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  embedding            extensions.vector(1024) not null,
  created_at           timestamptz not null default now(),
  primary key (embedding_version_id, chunk_id),
  constraint chunk_embeddings_1024_version_fk foreign key (embedding_version_id, dimensions)
    references public.embedding_versions (id, dimensions) on delete cascade
);
create index chunk_embeddings_1024_chunk_id_idx on public.chunk_embeddings_1024 (chunk_id);
create index chunk_embeddings_1024_hnsw_idx
  on public.chunk_embeddings_1024 using hnsw (embedding extensions.vector_cosine_ops);

create table public.chunk_embeddings_768 (
  embedding_version_id bigint not null,
  chunk_id             bigint not null references public.chunks (id) on delete cascade,
  dimensions           integer not null default 768 check (dimensions = 768),
  content_hash         text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  embedding            extensions.vector(768) not null,
  created_at           timestamptz not null default now(),
  primary key (embedding_version_id, chunk_id),
  constraint chunk_embeddings_768_version_fk foreign key (embedding_version_id, dimensions)
    references public.embedding_versions (id, dimensions) on delete cascade
);
create index chunk_embeddings_768_chunk_id_idx on public.chunk_embeddings_768 (chunk_id);
create index chunk_embeddings_768_hnsw_idx
  on public.chunk_embeddings_768 using hnsw (embedding extensions.vector_cosine_ops);

-- Singleton pointing at the active version. The composite FK is deferred so a promotion can
-- retire the old version, activate the new one and repoint this row in one transaction.
create table public.search_config (
  id                          boolean primary key default true check (id),
  active_embedding_version_id bigint,
  active_status               text check (active_status = 'active'),
  updated_at                  timestamptz not null default now(),
  constraint search_config_active_pair
    check ((active_embedding_version_id is null) = (active_status is null)),
  constraint search_config_active_version_fk
    foreign key (active_embedding_version_id, active_status)
    references public.embedding_versions (id, status)
    deferrable initially deferred
);

-- Single-user app behind owner auth; RLS on so any accidental Supabase API exposure fails
-- closed. The server connects with a role that bypasses RLS.
alter table public.sources enable row level security;
alter table public.documents enable row level security;
alter table public.chunks enable row level security;
alter table public.links enable row level security;
alter table public.embedding_versions enable row level security;
alter table public.chunk_embeddings_1024 enable row level security;
alter table public.chunk_embeddings_768 enable row level security;
alter table public.search_config enable row level security;

-- Seed the singleton last: the insert queues a deferred FK check, and Postgres refuses ALTER
-- TABLE on a table with pending trigger events in the same transaction.
insert into public.search_config (id) values (true);
