// Replays the whole migration history into a fresh database and checks the ADR 0002 and brain
// invariants plus Drizzle parity. Needs Postgres with pgvector: CI provides a service
// container; locally set AETHERION_TEST_DATABASE_URL once Docker runs.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { getTableConfig, type PgTable } from 'drizzle-orm/pg-core';
import type { Sql } from 'postgres';

import { brainTables, chunks, createDatabaseClient, documents, sources } from '../../src/index.ts';
import { applyMigrations, withFreshDatabase } from '../support/fresh-database.ts';

const ADMIN_URL = process.env.AETHERION_TEST_DATABASE_URL;
const skip = ADMIN_URL
  ? false
  : 'AETHERION_TEST_DATABASE_URL not set: needs Postgres + pgvector (CI service, or local Docker)';

const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const vec = (dimensions: number, value = 0.01) =>
  `[${Array.from({ length: dimensions }, () => value).join(',')}]`;

const rejects = async (work: Promise<unknown>, pattern: RegExp) => {
  await assert.rejects(work, (error: Error) => {
    assert.match(error.message, pattern);
    return true;
  });
};

// One fresh, migrated database per test keeps tests independent (testing.md).
const migrated = (name: string, run: (sql: Sql, url: string) => Promise<void>) =>
  test(name, { skip }, async () => {
    if (!ADMIN_URL) return;
    await withFreshDatabase(ADMIN_URL, async (sql, url) => {
      await applyMigrations(sql);
      await run(sql, url);
    });
  });

// Phase 2 (#91): a chunk belongs to a chunk set on a document revision.
const seedSet = async (sql: Sql, documentId: string, chunker = 'c1') => {
  const [revision] = await sql<{ id: string }[]>`
    insert into document_revisions (document_id, revision, kind, uri, content_hash)
    select id, coalesce((select max(revision) from document_revisions where document_id = ${documentId}), 0) + 1,
           'content', uri, content_hash
    from documents where id = ${documentId} returning id`;
  const [set] = await sql<{ id: string }[]>`
    insert into chunk_sets (document_revision_id, document_id, chunker_version)
    values (${revision?.id ?? ''}, ${documentId}, ${chunker}) returning id`;
  return { revisionId: revision?.id ?? '', chunkSetId: set?.id ?? '' };
};

const seedChunk = async (sql: Sql) => {
  const [source] = await sql<{ id: string }[]>`
    insert into sources (kind, name) values ('obsidian', 'vault') returning id`;
  const [document] = await sql<{ id: string }[]>`
    insert into documents (source_id, uri, content_hash)
    values (${source?.id ?? ''}, 'notes/a.md', ${hash('doc')}) returning id`;
  const documentId = document?.id ?? '';
  const { chunkSetId } = await seedSet(sql, documentId);
  const [chunk] = await sql<{ id: string }[]>`
    insert into chunks (document_id, chunk_set_id, ordinal, content, content_hash, token_count, chunker_version)
    values (${documentId}, ${chunkSetId}, 0, 'The quick brown foxes jumped', ${hash('chunk')}, 5, 'c1')
    returning id`;
  return { documentId, chunkSetId, chunkId: chunk?.id ?? '' };
};

// Each version gets its own immutable profile (ADR 0006).
const profile = async (sql: Sql, dimensions: number) => {
  const digest = hash(`m${dimensions}${Math.random()}`);
  const [row] = await sql<{ id: string }[]>`
    insert into embedding_profiles (id, model, model_digest, dimensions, num_ctx)
    values (${`p-${digest.slice(0, 12)}`}, 'm', ${digest}, ${dimensions}, 2048) returning id`;
  return { id: row?.id ?? '', digest };
};

const version = async (
  sql: Sql,
  dimensions: number,
  status = 'building',
  chunker = 'c1',
): Promise<string> => {
  const p = await profile(sql, dimensions);
  const [row] = await sql<{ id: string }[]>`
    insert into embedding_versions (model, model_digest, dimensions, chunker_version, status, promoted_at, profile_id)
    values ('m', ${p.digest}, ${dimensions}, ${chunker}, ${status},
            ${status === 'active' ? new Date() : null}, ${p.id})
    returning id`;
  return row?.id ?? '';
};

await migrated('the full history replays into an empty database', async (sql) => {
  const tables = await sql<{ table_name: string }[]>`
    select table_name from information_schema.tables where table_schema = 'public' order by 1`;
  const [vector] = await sql<{ nspname: string }[]>`
    select n.nspname from pg_extension e join pg_namespace n on n.oid = e.extnamespace
    where e.extname = 'vector'`;

  assert.deepEqual(
    tables.map((row) => row.table_name),
    [
      'chunk_embeddings_1024',
      'chunk_embeddings_768',
      'chunk_sets',
      'chunks',
      'document_revisions',
      'documents',
      'embedding_builds',
      'embedding_profiles',
      'embedding_version_gates',
      'embedding_version_leases',
      'embedding_version_selections',
      'embedding_versions',
      'ingest_events',
      'links',
      'search_config',
      'source_sync_state',
      'sources',
    ],
  );
  assert.equal(vector?.nspname, 'extensions');
});

await migrated('Drizzle columns, types and nullability match the database', async (sql) => {
  const normalize = (type: string) =>
    ({
      bigint: 'int8',
      integer: 'int4',
      boolean: 'bool',
      'timestamp with time zone': 'timestamptz',
      'text[]': '_text',
      'double precision': 'float8',
    })[type] ?? type.replace(/\(\d+\)$/, '');
  for (const table of Object.values(brainTables) as PgTable[]) {
    const config = getTableConfig(table);
    const expected = config.columns
      .map(
        (column) =>
          `${column.name}:${normalize(column.getSQLType())}:${column.notNull ? 'NO' : 'YES'}`,
      )
      .sort();
    const rows = await sql<{ column_name: string; udt_name: string; is_nullable: string }[]>`
      select column_name, udt_name, is_nullable from information_schema.columns
      where table_schema = 'public' and table_name = ${config.name}`;
    const actual = rows
      .map((row) => `${row.column_name}:${row.udt_name}:${row.is_nullable}`)
      .sort();

    assert.deepEqual(actual, expected, `drift in ${config.name}`);
  }
});

await migrated('vectors must match their version dimension table and be finite', async (sql) => {
  const { chunkId } = await seedChunk(sql);
  const v1024 = await version(sql, 1024);
  const v768 = await version(sql, 768);

  await sql`insert into chunk_embeddings_1024 (embedding_version_id, chunk_id, content_hash, embedding)
            values (${v1024}, ${chunkId}, ${hash('chunk')}, ${vec(1024)})`;
  await sql`insert into chunk_embeddings_768 (embedding_version_id, chunk_id, content_hash, embedding)
            values (${v768}, ${chunkId}, ${hash('chunk')}, ${vec(768)})`;

  await rejects(
    sql`insert into chunk_embeddings_768 (embedding_version_id, chunk_id, content_hash, embedding)
        values (${v1024}, ${chunkId}, ${hash('chunk')}, ${vec(768)})`,
    /chunk_embeddings_768_version_fk/,
  );
  await rejects(
    sql`insert into chunk_embeddings_1024 (embedding_version_id, chunk_id, content_hash, embedding)
        values (${v1024}, ${chunkId}, ${hash('x')}, ${vec(768)})`,
    /expected 1024 dimensions|duplicate key/,
  );
  const [other] = await sql<{ id: string }[]>`
    insert into chunks (document_id, chunk_set_id, ordinal, content, content_hash, token_count, chunker_version)
    select document_id, chunk_set_id, 1, 'second', ${hash('c2')}, 1, 'c1' from chunks where id = ${chunkId}
    returning id`;
  await rejects(
    sql`insert into chunk_embeddings_1024 (embedding_version_id, chunk_id, content_hash, embedding)
        values (${v1024}, ${other?.id ?? ''}, ${hash('c2')}, ${vec(768)})`,
    /expected 1024 dimensions/,
  );
  await rejects(
    sql`insert into chunk_embeddings_1024 (embedding_version_id, chunk_id, content_hash, embedding)
        values (${v1024}, ${other?.id ?? ''}, ${hash('c2')}, ${`[NaN${',0'.repeat(1023)}]`})`,
    /NaN not allowed/,
  );
  await rejects(
    sql`insert into chunk_embeddings_1024 (embedding_version_id, chunk_id, content_hash, embedding)
        values (${v1024}, ${chunkId}, ${hash('chunk')}, ${vec(1024, 0.02)})`,
    /duplicate key/,
  );
  await rejects(
    sql`insert into embedding_profiles (id, model, model_digest, dimensions)
        values ('p-512', 'm', ${hash('z')}, 512)`,
    /embedding_profiles_dimensions_check/,
  );
});

await migrated(
  'at most one version is active and an active version records its promotion',
  async (sql) => {
    await version(sql, 1024, 'active');

    await rejects(version(sql, 768, 'active'), /embedding_versions_one_active_idx/);
    const p = await profile(sql, 1024);
    await rejects(
      sql`insert into embedding_versions (model, model_digest, dimensions, chunker_version, status, profile_id)
        values ('m', ${p.digest}, 1024, 'c1', 'active', ${p.id})`,
      /embedding_versions_active_promoted|embedding_versions_one_active_idx/,
    );
  },
);

await migrated(
  'search config is a singleton that can only point at the active version',
  async (sql) => {
    const building = await version(sql, 1024);

    await rejects(sql`insert into search_config (id) values (false)`, /search_config_id_check/);
    await rejects(sql`insert into search_config (id) values (true)`, /search_config_pkey/);
    await rejects(
      sql.begin(
        (tx) => tx`update search_config set active_embedding_version_id = ${building},
                 active_status = 'active'`,
      ),
      /search_config_active_version_fk/,
    );
  },
);

await migrated(
  'promotion swaps the active version atomically; a dangling pointer cannot commit',
  async (sql) => {
    const first = await version(sql, 1024, 'active');
    await sql`update search_config set active_embedding_version_id = ${first}, active_status = 'active'`;
    const second = await version(sql, 1024, 'ready');

    await sql.begin(async (tx) => {
      await tx`update embedding_versions set status = 'retired' where id = ${first}`;
      await tx`update embedding_versions set status = 'active', promoted_at = now() where id = ${second}`;
      await tx`update search_config set active_embedding_version_id = ${second}`;
    });
    const [config] = await sql<
      { active_embedding_version_id: string }[]
    >`select * from search_config`;
    assert.equal(config?.active_embedding_version_id, second);

    await rejects(
      sql.begin((tx) => tx`update embedding_versions set status = 'retired' where id = ${second}`),
      /search_config_active_version_fk/,
    );
  },
);

await migrated('the generated tsvector is searchable and deletes cascade', async (sql, url) => {
  const client = createDatabaseClient({ url });
  try {
    const [source] = await client.db
      .insert(sources)
      .values({ kind: 'repo', name: 'code' })
      .returning({ id: sources.id });
    assert.ok(source);
    const [document] = await client.db
      .insert(documents)
      .values({ sourceId: source.id, uri: 'README.md', contentHash: hash('readme') })
      .returning({ id: documents.id });
    assert.ok(document);
    const { chunkSetId } = await seedSet(sql, String(document.id));
    await client.db.insert(chunks).values({
      documentId: document.id,
      chunkSetId: Number(chunkSetId),
      ordinal: 0,
      content: 'Running local foxes through the gate',
      contentHash: hash('c'),
      tokenCount: 6,
      chunkerVersion: 'c1',
    });
    const v = await version(sql, 1024);
    await sql`insert into chunk_embeddings_1024 (embedding_version_id, chunk_id, content_hash, embedding)
              select ${v}, id, content_hash, ${vec(1024)} from chunks`;

    const found = await sql`select id from chunks where tsv @@ to_tsquery('english', 'fox & run')`;
    assert.equal(found.length, 1);

    await sql`delete from documents where id = ${document.id}`;
    const [left] = await sql<{ chunks: string; vectors: string }[]>`
      select (select count(*) from chunks) as chunks,
             (select count(*) from chunk_embeddings_1024) as vectors`;
    assert.deepEqual(left, { chunks: '0', vectors: '0' });
  } finally {
    await client.close();
  }
});

await migrated(
  'links always keep a target label; deleting the target only unresolves them',
  async (sql) => {
    const { documentId } = await seedChunk(sql);
    const [other] = await sql<{ id: string }[]>`
    insert into sources (kind, name) values ('repo', 'code') returning id`;
    const [target] = await sql<{ id: string }[]>`
    insert into documents (source_id, uri, content_hash)
    values (${other?.id ?? ''}, 'README.md', ${hash('readme')}) returning id`;
    await sql`insert into links (from_document_id, to_document_id, to_title, kind)
            values (${documentId}, ${target?.id ?? ''}, 'README', 'wikilink')`;

    // Cross-source cascade: deleting the target's source must succeed and unresolve the edge.
    await sql`delete from sources where id = ${other?.id ?? ''}`;
    const links = await sql<{ to_document_id: string | null; to_title: string }[]>`
    select to_document_id, to_title from links`;

    assert.deepEqual([...links], [{ to_document_id: null, to_title: 'README' }]);
    await rejects(
      sql`insert into links (from_document_id, to_document_id, kind)
        values (${documentId}, ${documentId}, 'wikilink')`,
      /null value in column "to_title"/,
    );
    await rejects(
      sql`insert into links (from_document_id, to_title, kind) values (${documentId}, 'x', 'hyperlink')`,
      /links_kind_check/,
    );
    await rejects(
      sql`insert into documents (source_id, uri, content_hash)
        select source_id, 'b.md', 'not-a-hash' from documents limit 1`,
      /documents_content_hash_check/,
    );
  },
);

await migrated('row level security is enabled on every table', async (sql) => {
  const rows = await sql<{ relname: string; relrowsecurity: boolean }[]>`
    select c.relname, c.relrowsecurity from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'`;

  assert.ok(rows.length >= 8);
  assert.ok(
    rows.every((row) => row.relrowsecurity),
    'RLS disabled on a table',
  );
});
