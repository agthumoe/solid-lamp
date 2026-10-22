// Postgres adapter for ingestion (#139). Raw, parameterized SQL against the revision schema
// (supabase/migrations 20261021120000_brain_revisions.sql, 20261023120000_brain_ingest.sql).
// Publication always goes through brain_publish_revision, in the same transaction as the
// immutable rows it publishes.
import { createHash } from 'node:crypto';

import type { Sql, TransactionSql } from 'postgres';

import { INGEST_DOCUMENT, INGEST_RESYNC } from '../../../jobs/contracts.ts';
import type { PendingEvent, PendingEventStore } from '../../../dispatch/pending-events.ts';
import type { IngestStore, NewRevision } from '../application/ports.ts';

const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
// Thrown inside the publish transaction when the compare-and-set loses, to roll it back.
class SupersededError extends Error {}

// Relay leases: a dispatched event that no handler completes within this window is re-sent.
const LEASE = '15 minutes';

const insertContent = async (
  tx: TransactionSql,
  documentId: string,
  revision: Extract<NewRevision, { kind: 'content' }>,
) => {
  const [rev] = await tx<{ id: string }[]>`
    insert into public.document_revisions (document_id, revision, kind, uri, title, frontmatter, tags, content_hash)
    values (${documentId}, ${revision.revision}, 'content', ${revision.path}, ${revision.title},
            ${tx.json(revision.frontmatter as never)}, ${[...revision.tags]}, ${revision.contentHash})
    returning id`;
  const revisionId = rev?.id ?? '';
  const [set] = await tx<{ id: string }[]>`
    insert into public.chunk_sets (document_revision_id, document_id, chunker_version)
    values (${revisionId}, ${documentId}, ${revision.chunkerVersion}) returning id`;
  for (const chunk of revision.chunks)
    await tx`
      insert into public.chunks (document_id, chunk_set_id, ordinal, heading_path, content, content_hash,
                                 token_count, chunker_version, line_start, line_end, metadata)
      values (${documentId}, ${set?.id ?? ''}, ${chunk.ordinal}, ${[...chunk.headingPath]}, ${chunk.content},
              ${chunk.contentHash}, ${chunk.tokenCount}, ${revision.chunkerVersion}, ${chunk.lineStart}, ${chunk.lineEnd},
              ${tx.json({ heading_line: chunk.headingLine, heading_occurrence: chunk.headingOccurrence })})`;
  return revisionId;
};

export const createPostgresIngestStore = (sql: Sql): IngestStore => ({
  ensureSource: async (name) => {
    const [row] = await sql<{ id: string }[]>`
      with inserted as (
        insert into public.sources (kind, name) values ('obsidian', ${name})
        on conflict (name) do nothing returning id
      )
      select id::text from inserted
      union all
      select id::text from public.sources where name = ${name}
      limit 1`;
    return row?.id ?? '';
  },

  documentState: async (sourceId, path) => {
    const [row] = await sql<
      {
        id: string;
        current: string | null;
        revision: string | null;
        hash: string | null;
        deleted: boolean;
      }[]
    >`
      select d.id::text, d.current_revision_id::text as current, r.revision::text, r.content_hash as hash,
             d.deleted_at is not null as deleted
      from public.documents d
      left join public.document_revisions r on r.id = d.current_revision_id
      where d.source_id = ${sourceId} and d.uri = ${path}`;
    if (!row) return null;
    return {
      documentId: row.id,
      currentRevisionId: row.current,
      currentRevision: Number(row.revision ?? 0),
      currentHash: row.hash,
      deleted: row.deleted,
    };
  },

  publish: async (revision) =>
    sql
      .begin(async (tx) => {
        const [doc] = await tx<{ id: string }[]>`
        with inserted as (
          insert into public.documents (source_id, uri, content_hash)
          values (${revision.sourceId}, ${revision.path},
                  ${revision.kind === 'content' ? revision.contentHash : sha256(revision.path)})
          on conflict (source_id, uri) do nothing returning id
        )
        select id::text from inserted
        union all
        select id::text from public.documents where source_id = ${revision.sourceId} and uri = ${revision.path}
        limit 1`;
        const documentId = doc?.id ?? '';
        // A revision number that is already taken means another job published concurrently.
        const [taken] = await tx<{ n: number }[]>`
        select count(*)::int as n from public.document_revisions
        where document_id = ${documentId} and revision = ${revision.revision}`;
        if ((taken?.n ?? 0) > 0) return 'superseded' as const;
        const revisionId =
          revision.kind === 'content'
            ? await insertContent(tx, documentId, revision)
            : ((
                await tx<{ id: string }[]>`
                insert into public.document_revisions (document_id, revision, kind, uri)
                values (${documentId}, ${revision.revision}, 'tombstone', ${revision.path}) returning id`
              )[0]?.id ?? '');
        const [result] = await tx<{ ok: boolean }[]>`
        select public.brain_publish_revision(${documentId}, ${revision.expectedRevisionId}, ${revisionId}) as ok`;
        if (!result?.ok) {
          // Compare-and-set lost: roll back the unpublished rows rather than leave orphans.
          throw new SupersededError();
        }
        if (revision.kind === 'content') {
          await tx`delete from public.links where from_document_id = ${documentId}`;
          for (const link of revision.links)
            await tx`
            insert into public.links (from_document_id, to_document_id, to_title, kind)
            values (${documentId},
                    (select id from public.documents
                     where source_id = ${revision.sourceId} and uri = ${link.targetPath} and deleted_at is null),
                    ${link.toTitle}, ${link.kind})`;
        }
        return 'published' as const;
      })
      .catch((error: unknown) => {
        if (error instanceof SupersededError) return 'superseded' as const;
        throw error;
      }),

  indexedPaths: async (sourceId) => {
    const rows = await sql<{ uri: string; hash: string }[]>`
      select d.uri, r.content_hash as hash from public.documents d
      join public.document_revisions r on r.id = d.current_revision_id
      where d.source_id = ${sourceId} and d.deleted_at is null and r.content_hash is not null`;
    return new Map(rows.map((row) => [row.uri, row.hash]));
  },

  recordEvents: async (sourceId, events) => {
    let recorded = 0;
    for (const event of events) {
      // A changed path needs a document row (the durable path record) before it is published.
      const rows =
        event.kind === 'changed'
          ? await sql<{ id: string }[]>`
              with doc as (
                insert into public.documents (source_id, uri, content_hash)
                values (${sourceId}, ${event.path}, ${event.observedHash})
                on conflict (source_id, uri) do update set updated_at = public.documents.updated_at
                returning id, current_revision_id
              )
              insert into public.ingest_events (source_id, document_id, kind, path_hash, base_revision_id, observed_hash)
              select ${sourceId}, doc.id, 'changed', ${sha256(event.path)}, doc.current_revision_id, ${event.observedHash}
              from doc
              on conflict (document_id, kind, coalesce(observed_hash, ''))
                where status in ('pending', 'leased') and document_id is not null
              do nothing
              returning id::text`
          : await sql<{ id: string }[]>`
              insert into public.ingest_events (source_id, document_id, kind, path_hash, base_revision_id)
              select ${sourceId}, d.id, 'deleted', ${sha256(event.path)}, d.current_revision_id
              from public.documents d
              where d.source_id = ${sourceId} and d.uri = ${event.path} and d.deleted_at is null
              on conflict (document_id, kind, coalesce(observed_hash, ''))
                where status in ('pending', 'leased') and document_id is not null
              do nothing
              returning id::text`;
      recorded += rows.length;
    }
    return recorded;
  },

  requestResync: async (sourceId) => {
    await sql`
      insert into public.ingest_events (source_id, kind) values (${sourceId}, 'resync')
      on conflict (source_id) where status in ('pending', 'leased') and kind = 'resync' do nothing`;
  },

  eventWatermark: async () => {
    const [row] = await sql<
      { id: string }[]
    >`select coalesce(max(id), 0)::text as id from public.ingest_events`;
    return row?.id ?? '0';
  },

  completeDocument: async (sourceId, path, upToEventId) => {
    await sql`
      update public.ingest_events e set status = 'done', processed_at = now(), lease_owner = null,
             lease_expires_at = null
      from public.documents d
      where e.document_id = d.id and d.source_id = ${sourceId} and d.uri = ${path}
        and e.status in ('pending', 'leased') and e.id <= ${upToEventId}`;
  },

  completeResync: async (eventId) => {
    if (!/^\d{1,18}$/.test(eventId)) return;
    await sql`
      update public.ingest_events set status = 'done', processed_at = now(), lease_owner = null,
             lease_expires_at = null
      where id = ${eventId} and kind = 'resync' and status in ('pending', 'leased')`;
  },

  recordScan: async (sourceId, scan) => {
    await sql`
      insert into public.source_sync_state as st
        (source_id, last_scan_started_at, last_scan_completed_at, last_scan_complete, files_seen,
         files_indexed, files_skipped, last_error_code, updated_at)
      values (${sourceId}, now(), now(), ${scan.complete}, ${scan.seen}, ${scan.indexed}, ${scan.skipped},
              ${scan.errorCode}, now())
      on conflict (source_id) do update set
        last_scan_started_at = excluded.last_scan_started_at,
        last_scan_completed_at = excluded.last_scan_completed_at,
        last_scan_complete = excluded.last_scan_complete,
        files_seen = excluded.files_seen,
        files_indexed = excluded.files_indexed,
        files_skipped = excluded.files_skipped,
        last_error_code = excluded.last_error_code,
        updated_at = excluded.updated_at`;
    if (scan.complete)
      await sql`update public.sources set last_synced_at = now() where id = ${sourceId}`;
  },

  embeddingTargets: async () =>
    (
      await sql<{ id: string; profile_id: string; dimensions: number }[]>`
        select id::text, profile_id, dimensions from public.embedding_versions
        where status in ('building', 'ready', 'active') order by id`
    ).map((row) => ({ versionId: row.id, profileId: row.profile_id, dimensions: row.dimensions })),

  missingVectors: async (versionId, limit, documentId) =>
    (
      await sql<{ id: string; content: string; content_hash: string }[]>`
        select c.id::text, c.content, c.content_hash
        from public.embedding_version_selections sel
        join public.documents d on d.id = sel.document_id and d.deleted_at is null
        join public.chunk_sets s on s.id = sel.chunk_set_id and s.document_revision_id = d.current_revision_id
        join public.chunks c on c.chunk_set_id = sel.chunk_set_id
        join public.embedding_versions v on v.id = sel.embedding_version_id
        where sel.embedding_version_id = ${versionId}
          and (${documentId}::bigint is null or d.id = ${documentId}::bigint)
          and not exists (select 1 from public.chunk_embeddings_1024 e
                          where v.dimensions = 1024 and e.embedding_version_id = v.id
                            and e.chunk_id = c.id and e.content_hash = c.content_hash)
          and not exists (select 1 from public.chunk_embeddings_768 e
                          where v.dimensions = 768 and e.embedding_version_id = v.id
                            and e.chunk_id = c.id and e.content_hash = c.content_hash)
        order by c.id
        limit ${limit}`
    ).map((row) => ({ chunkId: row.id, content: row.content, contentHash: row.content_hash })),

  storeVectors: async (target, rows) => {
    const table = target.dimensions === 768 ? 'chunk_embeddings_768' : 'chunk_embeddings_1024';
    for (const row of rows)
      await sql`
        insert into ${sql(table)} (embedding_version_id, chunk_id, content_hash, embedding)
        values (${target.versionId}, ${row.chunkId}, ${row.contentHash}, ${`[${row.vector.join(',')}]`})
        on conflict (embedding_version_id, chunk_id) do nothing`;
  },
});

/** The outbox side: pending (or lease-expired) events as jobs, leased when enqueued. */
export const createPostgresPendingEventStore = (sql: Sql): PendingEventStore => ({
  pending: async (limit) => {
    const rows = await sql<
      {
        id: string;
        kind: 'changed' | 'deleted' | 'resync';
        source: string;
        uri: string | null;
        hash: string | null;
        base: string | null;
      }[]
    >`
      select e.id::text, e.kind, s.name as source, d.uri, e.observed_hash as hash, r.content_hash as base
      from public.ingest_events e
      join public.sources s on s.id = e.source_id
      left join public.documents d on d.id = e.document_id
      left join public.document_revisions r on r.id = e.base_revision_id
      where (e.status = 'pending' and e.next_attempt_at <= now())
         or (e.status = 'leased' and e.lease_expires_at < now())
      order by e.id
      limit ${limit}`;
    return rows.flatMap((row): PendingEvent[] => {
      if (row.kind === 'resync')
        return [
          { id: row.id, name: INGEST_RESYNC, payload: { sourceId: row.source, scanId: row.id } },
        ];
      if (!row.uri) return [];
      // A delete has no observed bytes: the job identity uses the last indexed revision (or the path).
      const revision = row.hash ?? row.base ?? sha256(`deleted:${row.uri}`);
      return [
        {
          id: row.id,
          name: INGEST_DOCUMENT,
          payload: { sourceId: row.source, path: row.uri, revision, eventId: row.id },
        },
      ];
    });
  },
  markDispatched: async (ids) => {
    if (!ids.length) return;
    await sql`
      update public.ingest_events
      set status = 'leased', lease_owner = 'relay', lease_expires_at = now() + ${LEASE}::interval,
          attempts = least(attempts + 1, 100)
      where id = any (${[...ids]}::bigint[]) and status in ('pending', 'leased')`;
  },
});
