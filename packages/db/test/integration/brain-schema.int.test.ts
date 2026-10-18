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

const seedChunk = async (sql: Sql) => {
  const [source] = await sql<{ id: string }[]>`
    insert into sources (kind, name) values ('obsidian', 'vault') returning id`;
  const [document] = await sql<{ id: string }[]>`
    insert into documents (source_id, uri, content_hash)
    values (${source?.id ?? ''}, 'notes/a.md', ${hash('doc')}) returning id`;
  const [chunk] = await sql<{ id: string }[]>`
    insert into chunks (document_id, ordinal, content, content_hash, token_count, chunker_version)
    values (${document?.id ?? ''}, 0, 'The quick brown foxes jumped', ${hash('chunk')}, 5, 'c1')
    returning id`;
  return { documentId: document?.id ?? '', chunkId: chunk?.id ?? '' };
};

const version = async (sql: Sql, dimensions: number, status = 'building'): Promise<string> => {
  const [row] = await sql<{ id: string }[]>`
    insert into embedding_versions (model, model_digest, dimensions, chunker_version, status, promoted_at)
    values ('m', ${hash(`m${dimensions}${status}${Math.random()}`)}, ${dimensions}, 'c1', ${status},
            ${status === 'active' ? new Date() : null})
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
      'chunks',
      'documents',
      'embedding_versions',
      'links',
      'search_config',
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
    insert into chunks (document_id, ordinal, content, content_hash, token_count, chunker_version)
    select document_id, 1, 'second', ${hash('c2')}, 1, 'c1' from chunks where id = ${chunkId}
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
    sql`insert into embedding_versions (model, model_digest, dimensions, chunker_version)
        values ('m', ${hash('z')}, 512, 'c1')`,
    /embedding_versions_dimensions_check/,
  );
});

await migrated(
  'at most one version is active and an active version records its promotion',
  async (sql) => {
    await version(sql, 1024, 'active');

    await rejects(version(sql, 768, 'active'), /embedding_versions_one_active_idx/);
    await rejects(
      sql`insert into embedding_versions (model, model_digest, dimensions, chunker_version, status)
        values ('m', ${hash('p')}, 1024, 'c1', 'active')`,
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
    await client.db.insert(chunks).values({
      documentId: document.id,
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
  'links need a resolved target or a title; bad kinds and hashes are rejected',
  async (sql) => {
    const { documentId } = await seedChunk(sql);

    await sql`insert into links (from_document_id, to_title, kind) values (${documentId}, 'Later', 'wikilink')`;
    await rejects(
      sql`insert into links (from_document_id, kind) values (${documentId}, 'wikilink')`,
      /links_target_present/,
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
