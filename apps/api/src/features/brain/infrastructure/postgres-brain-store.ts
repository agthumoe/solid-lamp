// Postgres adapter for the brain ports (#95). Raw, parameterized SQL: hybrid retrieval lives in
// brain_search_candidates (supabase/migrations/20261022120000_brain_search.sql), and the other
// queries read the same eligibility rules (pinned selection, live document, current revision).
import { freezeGates } from '@aetherion/brain';
import type { Sql } from 'postgres';

import type { BrainStore, ChunkDetail } from '../application/ports.ts';

type DetailRow = {
  chunk_id: string;
  document_id: string;
  source_name: string;
  path: string;
  title: string;
  revision: string;
  revision_hash: string | null;
  heading_path: string[];
  heading_occurrence: string;
  line_start: number | null;
  line_end: number | null;
  content: string;
};

const toDetail = (row: DetailRow): ChunkDetail => ({
  chunkId: row.chunk_id,
  documentId: row.document_id,
  sourceName: row.source_name,
  path: row.path,
  title: row.title,
  revision: Number(row.revision),
  revisionHash: row.revision_hash ?? '',
  headingPath: row.heading_path,
  headingOccurrence: Number(row.heading_occurrence),
  lineStart: row.line_start,
  lineEnd: row.line_end,
  content: row.content,
});

// Citation fields for chunks: the indexed revision's path/title, and the duplicate-heading
// occurrence (a later section with the same heading path in the same set counts up). Ingestion
// stores the chunker's heading line and occurrence in chunks.metadata (#139); consecutive
// sections with identical headings are told apart by their heading line.
const detailSelect = (sql: Sql, where: ReturnType<Sql>) => sql<DetailRow[]>`
  with target as (
    select c.id, c.chunk_set_id from public.chunks c where ${where}
  ),
  sections as (
    select c.id, c.chunk_set_id, c.ordinal, c.heading_path,
           (c.heading_path is distinct from lag(c.heading_path) over w
            or (c.metadata ->> 'heading_line') is distinct from lag(c.metadata ->> 'heading_line') over w) as starts
    from public.chunks c
    where c.chunk_set_id in (select chunk_set_id from target)
    window w as (partition by c.chunk_set_id order by c.ordinal)
  ),
  numbered as (
    select id, heading_path,
           count(*) filter (where starts) over (
             partition by chunk_set_id, heading_path order by ordinal rows unbounded preceding) as occurrence
    from sections
  )
  select c.id::text as chunk_id, c.document_id::text as document_id, src.name as source_name,
         r.uri as path, r.title, r.revision::text as revision, r.content_hash as revision_hash,
         c.heading_path,
         -- The chunker's own section numbering when ingestion stored it; otherwise inferred from
         -- section starts (a new heading line or path).
         coalesce((c.metadata ->> 'heading_occurrence')::int, greatest(n.occurrence, 1))::text as heading_occurrence,
         c.line_start, c.line_end, c.content
  from target t
  join public.chunks c on c.id = t.id
  join numbered n on n.id = c.id
  join public.chunk_sets s on s.id = c.chunk_set_id
  join public.document_revisions r on r.id = s.document_revision_id
  join public.documents d on d.id = c.document_id
  join public.sources src on src.id = d.source_id`;

export const createPostgresBrainStore = (sql: Sql): BrainStore => ({
  pinActiveVersion: async () => {
    const [row] = await sql<
      {
        id: string;
        profile_id: string;
        digest: string;
        dimensions: number;
        chunker_version: string;
        promoted_at: Date;
        gate_id: string | null;
        min_cosine: number | null;
        min_lexical: number | null;
        calibration_questions: number | null;
        calibration_sha256: string | null;
        calibration_top_k: number | null;
      }[]
    >`
      select v.id::text, v.profile_id, p.model_digest as digest, v.dimensions, v.chunker_version,
             v.promoted_at, g.gate_id, g.min_cosine, g.min_lexical, g.calibration_questions,
             g.calibration_sha256, g.calibration_top_k
      from public.search_config cfg
      join public.embedding_versions v on v.id = cfg.active_embedding_version_id and v.status = 'active'
      join public.embedding_profiles p on p.id = v.profile_id
      left join public.embedding_version_gates g on g.embedding_version_id = v.id`;
    if (!row) return null;
    return {
      versionId: row.id,
      profileId: row.profile_id,
      profileDigest: row.digest,
      dimensions: row.dimensions,
      chunkerVersion: row.chunker_version,
      promotedAt: row.promoted_at,
      gates: row.gate_id
        ? freezeGates({
            id: row.gate_id,
            minCosine: row.min_cosine,
            minLexical: row.min_lexical,
            calibration:
              row.calibration_questions === null
                ? null
                : {
                    questions: row.calibration_questions,
                    sha256: row.calibration_sha256,
                    topK: row.calibration_top_k,
                  },
          })
        : null,
    };
  },

  sourceIdsByName: async (names) =>
    (
      await sql<{ id: string }[]>`
        select id::text from public.sources where enabled and name = any (${[...names]}::text[])`
    ).map((row) => row.id),

  searchCandidates: async (input) => {
    const rows = await sql<
      {
        chunk_id: string;
        vector_rank: number | null;
        lexical_rank: number | null;
        cosine: number | null;
        lexical: number | null;
        fused: number;
      }[]
    >`
      select chunk_id::text, vector_rank, lexical_rank, cosine, lexical, fused
      from public.brain_search_candidates(
        ${input.versionId}, ${input.queryVector ? `[${input.queryVector.join(',')}]` : null},
        ${input.queryText}, ${[...input.filters.sourceIds]}::bigint[], ${[...input.filters.tags]}::text[],
        ${input.filters.tagsAll}, ${input.filters.pathPrefix}, ${input.branchLimit}, ${input.resultLimit})`;
    return rows.map((row) => ({
      chunkId: row.chunk_id,
      vectorRank: row.vector_rank,
      lexicalRank: row.lexical_rank,
      cosine: row.cosine,
      lexical: row.lexical,
      fused: row.fused,
    }));
  },

  chunkDetails: async (chunkIds) => {
    if (!chunkIds.length) return [];
    const rows = await detailSelect(sql, sql`c.id = any (${[...chunkIds]}::bigint[])`);
    return rows.map(toDetail);
  },

  corpusComplete: async (versionId) => {
    const [row] = await sql<{ missing: boolean }[]>`
      select exists (
        select 1 from public.documents d
        where d.deleted_at is null and d.current_revision_id is not null
          and not exists (
            select 1 from public.embedding_version_selections sel
            join public.chunk_sets s on s.id = sel.chunk_set_id
            where sel.embedding_version_id = ${versionId} and sel.document_id = d.id
              and s.document_revision_id = d.current_revision_id)
      ) or exists (
        select 1 from public.embedding_version_selections sel
        join public.documents d on d.id = sel.document_id and d.deleted_at is null
        join public.chunks c on c.chunk_set_id = sel.chunk_set_id
        join public.embedding_versions v on v.id = sel.embedding_version_id
        where sel.embedding_version_id = ${versionId}
          and not exists (select 1 from public.chunk_embeddings_1024 e
                          where v.dimensions = 1024 and e.embedding_version_id = v.id
                            and e.chunk_id = c.id and e.content_hash = c.content_hash)
          and not exists (select 1 from public.chunk_embeddings_768 e
                          where v.dimensions = 768 and e.embedding_version_id = v.id
                            and e.chunk_id = c.id and e.content_hash = c.content_hash)
      ) as missing`;
    return row?.missing === false;
  },

  noteState: async (identity) => {
    if (
      !/^\d{1,18}$/.test(identity.chunkId) ||
      !/^\d{1,18}$/.test(identity.documentId) ||
      !/^\d{1,18}$/.test(identity.versionId)
    )
      return null;
    // The chunk must exist in the named document and enabled source, and belong to a set of the
    // named version's chunker. Current selection is not required: an edited note must answer
    // `stale`, not `not found`.
    const rows = await detailSelect(
      sql,
      sql`c.id = ${identity.chunkId} and c.document_id = ${identity.documentId}
          and exists (select 1 from public.documents d join public.sources src on src.id = d.source_id
                      where d.id = c.document_id and src.enabled and src.name = ${identity.sourceName})
          and exists (select 1 from public.embedding_versions v
                      where v.id = ${identity.versionId} and v.chunker_version = c.chunker_version)`,
    );
    const detail = rows[0];
    if (!detail) return null;
    const [current] = await sql<
      { deleted: boolean; revision: string; content_hash: string | null; uri: string }[]
    >`
      select d.deleted_at is not null as deleted, r.revision::text, r.content_hash, r.uri
      from public.documents d join public.document_revisions r on r.id = d.current_revision_id
      where d.id = ${identity.documentId}`;
    if (!current) return null;
    return {
      detail: toDetail(detail),
      deleted: current.deleted,
      currentRevision: Number(current.revision),
      currentRevisionHash: current.content_hash,
      currentPath: current.uri,
    };
  },

  stats: async () => {
    const [version] = await sql<
      { id: string; dimensions: number; chunker_version: string; promoted_at: Date }[]
    >`
      select v.id::text, v.dimensions, v.chunker_version, v.promoted_at
      from public.search_config cfg
      join public.embedding_versions v on v.id = cfg.active_embedding_version_id and v.status = 'active'`;
    const [counts] = await sql<{ documents: string; chunks: string; embedded: string }[]>`
      with live as (
        select d.id, d.current_revision_id from public.documents d
        where d.deleted_at is null and d.current_revision_id is not null
      ),
      selected as (
        select c.id, c.content_hash from live
        join public.embedding_version_selections sel on sel.document_id = live.id
          and sel.embedding_version_id = ${version?.id ?? null}
        join public.chunk_sets s on s.id = sel.chunk_set_id and s.document_revision_id = live.current_revision_id
        join public.chunks c on c.chunk_set_id = sel.chunk_set_id
      )
      select (select count(*) from live)::text as documents,
             (select count(*) from selected)::text as chunks,
             (select count(*) from selected c where exists (
                select 1 from public.chunk_embeddings_1024 e
                where e.embedding_version_id = ${version?.id ?? null} and e.chunk_id = c.id and e.content_hash = c.content_hash
                union all
                select 1 from public.chunk_embeddings_768 e
                where e.embedding_version_id = ${version?.id ?? null} and e.chunk_id = c.id and e.content_hash = c.content_hash))::text as embedded`;
    const sources = await sql<
      {
        name: string;
        documents: string;
        last_synced_at: Date | null;
        scan: 'complete' | 'incomplete' | 'never';
      }[]
    >`
      select src.name,
             (select count(*) from public.documents d where d.source_id = src.id and d.deleted_at is null
                and d.current_revision_id is not null)::text as documents,
             src.last_synced_at,
             case when st.last_scan_completed_at is null then 'never'
                  when st.last_scan_complete then 'complete' else 'incomplete' end as scan
      from public.sources src
      left join public.source_sync_state st on st.source_id = src.id
      where src.enabled
      order by src.name
      limit 64`;
    return {
      activeVersion: version
        ? {
            versionId: version.id,
            dimensions: version.dimensions,
            chunkerVersion: version.chunker_version,
            promotedAt: version.promoted_at,
          }
        : null,
      documents: Number(counts?.documents ?? 0),
      chunks: Number(counts?.chunks ?? 0),
      embeddedChunks: Number(counts?.embedded ?? 0),
      sources: sources.map((source) => ({
        name: source.name,
        documents: Number(source.documents),
        lastIngestAt: source.last_synced_at,
        lastScan: source.scan,
      })),
    };
  },
});
