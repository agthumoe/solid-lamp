-- 20261022120000_brain_search.sql
-- Why: hybrid retrieval for the brain routes (docs/specs/brain.md → Search contract; issue #95):
-- per-version frozen evidence gates, a path-prefix index and brain_search_candidates, which
-- reads only a pinned version's selection with the same eligibility rules as promotion (#91).
-- Spec: docs/specs/brain-search.md.
-- Compatibility: additive (one table, one index, one function). Locks: CREATE INDEX on documents
-- takes a SHARE lock briefly; the table is small before real ingestion.
-- Rollback/forward-fix: drop the function, index and table (no data is migrated).

set local lock_timeout = '10s';

-- Evidence gates calibrated for one version and frozen with it (@aetherion/brain retrieval).
-- Written by the owner/maintenance role after calibration; immutable afterwards. A version without
-- gates is not searchable (the api fails closed rather than return ungated results).
create table public.embedding_version_gates (
  embedding_version_id  bigint primary key references public.embedding_versions (id) on delete cascade,
  gate_id               text not null check (gate_id ~ '^[A-Za-z0-9_.-]{1,96}$'),
  min_cosine            double precision check (min_cosine between -1 and 1),
  min_lexical           double precision check (min_lexical >= 0),
  calibration_questions integer check (calibration_questions >= 1),
  calibration_sha256    text check (calibration_sha256 ~ '^[0-9a-f]{64}$'),
  calibration_top_k     integer check (calibration_top_k between 1 and 50),
  created_at            timestamptz not null default now(),
  constraint embedding_version_gates_calibration check (
    (calibration_questions is null) = (calibration_sha256 is null)
    and (calibration_questions is null) = (calibration_top_k is null))
);
create trigger embedding_version_gates_immutable before update on public.embedding_version_gates
  for each row execute function public.brain_reject_update();
alter table public.embedding_version_gates enable row level security;
create policy embedding_version_gates_brain_reader on public.embedding_version_gates
  for select to aetherion_brain_reader using (true);
create policy embedding_version_gates_brain_writer on public.embedding_version_gates
  for select to aetherion_brain_writer using (true);
grant select on public.embedding_version_gates to aetherion_brain_reader, aetherion_brain_writer;

-- Component-aware path-prefix filters (`uri = p or uri like p/%`) use this index.
create index documents_uri_pattern_idx on public.documents (uri text_pattern_ops);

-- Candidates for one query against one pinned version. Both branches read only chunks of the
-- version's selected set on each live document's current revision; the vector branch also requires
-- a vector whose content_hash matches the chunk. Filters apply before each branch's bounded
-- candidate selection. The merge is reciprocal rank fusion (k = 60) ordered exactly like the
-- @aetherion/brain reference: fused score, best single-branch rank, chunk ID as text in code-unit
-- order. A null query vector means lexical-only (the caller labels that mode).
create function public.brain_search_candidates(
  p_version_id   bigint,
  p_query_vector text,
  p_query_text   text,
  p_source_ids   bigint[],
  p_tags         text[],
  p_tags_all     boolean,
  p_path_prefix  text,
  p_branch_limit integer,
  p_result_limit integer
) returns table (
  chunk_id     bigint,
  vector_rank  integer,
  lexical_rank integer,
  cosine       double precision,
  lexical      double precision,
  fused        double precision
)
  language plpgsql
  stable
  security invoker
  set search_path = ''
as $$
declare
  v_dimensions integer;
  v_like text;
  v_tsquery tsquery;
begin
  if p_branch_limit not between 1 and 200 or p_result_limit not between 1 and 50 then
    raise exception 'candidate limits out of range' using errcode = 'invalid_parameter_value';
  end if;
  select dimensions into v_dimensions from public.embedding_versions where id = p_version_id;
  if not found then
    raise exception 'embedding version % does not exist', p_version_id using errcode = 'no_data_found';
  end if;
  -- LIKE metacharacters in the prefix are literal; the separator makes the match component-aware.
  v_like := pg_catalog.replace(pg_catalog.replace(pg_catalog.replace(
    p_path_prefix, '\', '\\'), '%', '\%'), '_', '\_') || '/%';
  v_tsquery := pg_catalog.websearch_to_tsquery('pg_catalog.english'::regconfig, coalesce(p_query_text, ''));

  return query
  with eligible as materialized (
    select c.id, c.tsv, c.content_hash
    from public.embedding_version_selections sel
    join public.documents d on d.id = sel.document_id and d.deleted_at is null
    -- A disabled source leaves search at once, even for notes it already indexed.
    join public.sources src on src.id = d.source_id and src.enabled
    join public.chunk_sets s on s.id = sel.chunk_set_id and s.document_revision_id = d.current_revision_id
    join public.chunks c on c.chunk_set_id = sel.chunk_set_id
    where sel.embedding_version_id = p_version_id
      and (coalesce(pg_catalog.cardinality(p_source_ids), 0) = 0 or d.source_id = any (p_source_ids))
      and (coalesce(pg_catalog.cardinality(p_tags), 0) = 0
           or (p_tags_all and d.tags operator(pg_catalog.@>) p_tags)
           or (not p_tags_all and d.tags operator(pg_catalog.&&) p_tags))
      and (p_path_prefix is null or d.uri = p_path_prefix or d.uri like v_like escape '\')
  ),
  -- Untyped casts: a typmod cast would be constant-folded and fail in the branch that does not
  -- run. A dimension mismatch still fails in the branch that does.
  vec as (
    select e.chunk_id as id,
           1 - (e.embedding operator(extensions.<=>) p_query_vector::extensions.vector) as cosine
    from public.chunk_embeddings_1024 e
    join eligible el on el.id = e.chunk_id and el.content_hash = e.content_hash
    where v_dimensions = 1024 and p_query_vector is not null and e.embedding_version_id = p_version_id
    union all
    select e.chunk_id,
           1 - (e.embedding operator(extensions.<=>) p_query_vector::extensions.vector)
    from public.chunk_embeddings_768 e
    join eligible el on el.id = e.chunk_id and el.content_hash = e.content_hash
    where v_dimensions = 768 and p_query_vector is not null and e.embedding_version_id = p_version_id
  ),
  vec_ranked as (
    select v.id, v.cosine,
           (pg_catalog.row_number() over (order by v.cosine desc, v.id::text collate "C"))::integer as rank
    from vec v
    order by v.cosine desc, v.id::text collate "C"
    limit p_branch_limit
  ),
  lex_ranked as (
    select el.id,
           pg_catalog.ts_rank_cd(el.tsv, v_tsquery)::double precision as score,
           (pg_catalog.row_number() over (
             order by pg_catalog.ts_rank_cd(el.tsv, v_tsquery) desc, el.id::text collate "C"))::integer as rank
    from eligible el
    where el.tsv operator(pg_catalog.@@) v_tsquery
    order by score desc, el.id::text collate "C"
    limit p_branch_limit
  )
  select coalesce(v.id, l.id),
         v.rank,
         l.rank,
         v.cosine,
         l.score,
         -- double precision, like the reference's JavaScript numbers.
         coalesce(1::double precision / (60 + v.rank), 0) + coalesce(1::double precision / (60 + l.rank), 0)
  from vec_ranked v
  full join lex_ranked l on l.id = v.id
  order by 6 desc,
           least(coalesce(v.rank, 2147483647), coalesce(l.rank, 2147483647)),
           coalesce(v.id, l.id)::text collate "C"
  limit p_result_limit;
end;
$$;
revoke all on function public.brain_search_candidates(bigint, text, text, bigint[], text[], boolean, text, integer, integer) from public;
grant execute on function public.brain_search_candidates(bigint, text, text, bigint[], text[], boolean, text, integer, integer)
  to aetherion_brain_reader;
