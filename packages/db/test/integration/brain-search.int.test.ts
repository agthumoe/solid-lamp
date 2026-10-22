// #95: brain_search_candidates against a pinned version. Needs Postgres with pgvector (see
// brain-schema.int.test.ts); skips locally without AETHERION_TEST_DATABASE_URL.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { fuseRankings } from '@aetherion/brain';
import type { Sql } from 'postgres';

import { applyMigrations, withFreshDatabase } from '../support/fresh-database.ts';

const ADMIN_URL = process.env.AETHERION_TEST_DATABASE_URL;
const skip = ADMIN_URL
  ? false
  : 'AETHERION_TEST_DATABASE_URL not set: needs Postgres + pgvector (CI service, or local Docker)';

const hash = (text: string) => createHash('sha256').update(text).digest('hex');
// A unit vector pointing mostly along `axis`, so cosine order is predictable.
const vec = (dimensions: number, axis: number, lean = 0) =>
  `[${Array.from({ length: dimensions }, (_, i) => (i === axis ? 1 : i === axis + 1 ? lean : 0)).join(',')}]`;

const migrated = (name: string, run: (sql: Sql) => Promise<void>) =>
  test(name, { skip }, async () => {
    if (!ADMIN_URL) return;
    await withFreshDatabase(ADMIN_URL, async (sql) => {
      await applyMigrations(sql);
      await run(sql);
    });
  });

type Row = {
  chunk_id: string;
  vector_rank: number | null;
  lexical_rank: number | null;
  cosine: number | null;
  lexical: number | null;
  fused: number;
};

const corpus = async (sql: Sql, dimensions = 1024) => {
  const digest = hash(`m${dimensions}`);
  await sql`insert into embedding_profiles (id, model, model_digest, dimensions, num_ctx)
            values ('p', 'm', ${digest}, ${dimensions}, 2048)`;
  const [version] = await sql<{ id: string }[]>`
    insert into embedding_versions (model, model_digest, dimensions, chunker_version, status, profile_id)
    values ('m', ${digest}, ${dimensions}, 'c1', 'building', 'p') returning id`;
  const versionId = version?.id ?? '';
  const [source] = await sql<
    { id: string }[]
  >`insert into sources (kind, name) values ('obsidian', 'vault') returning id`;
  const [other] = await sql<
    { id: string }[]
  >`insert into sources (kind, name) values ('repo', 'code') returning id`;
  const chunkIds: Record<string, string> = {};

  // Publishes one document with the given chunks, each embedded along `axis` unless skipped.
  const note = async (
    uri: string,
    chunks: { key: string; text: string; axis?: number; staleVector?: boolean }[],
    options: { tags?: string[]; sourceId?: string } = {},
  ) => {
    const [doc] = await sql<{ id: string }[]>`
      insert into documents (source_id, uri, content_hash, tags)
      values (${options.sourceId ?? source?.id ?? ''}, ${uri}, ${hash(uri)}, ${options.tags ?? []}) returning id`;
    const documentId = doc?.id ?? '';
    const [revision] = await sql<{ id: string }[]>`
      insert into document_revisions (document_id, revision, kind, uri, content_hash, tags)
      values (${documentId}, 1, 'content', ${uri}, ${hash(uri)}, ${options.tags ?? []}) returning id`;
    const [set] = await sql<{ id: string }[]>`
      insert into chunk_sets (document_revision_id, document_id, chunker_version)
      values (${revision?.id ?? ''}, ${documentId}, 'c1') returning id`;
    for (const [ordinal, chunk] of chunks.entries()) {
      const [row] = await sql<{ id: string }[]>`
        insert into chunks (document_id, chunk_set_id, ordinal, content, content_hash, token_count, chunker_version, line_start, line_end)
        values (${documentId}, ${set?.id ?? ''}, ${ordinal}, ${chunk.text}, ${hash(chunk.text)}, 3, 'c1', ${ordinal + 1}, ${ordinal + 1})
        returning id`;
      chunkIds[chunk.key] = row?.id ?? '';
      if (chunk.axis !== undefined)
        await sql.unsafe(
          `insert into chunk_embeddings_${dimensions} (embedding_version_id, chunk_id, content_hash, embedding)
           values ($1, $2, $3, $4)`,
          [
            versionId,
            row?.id ?? '',
            chunk.staleVector ? hash('older text') : hash(chunk.text),
            vec(dimensions, chunk.axis, 0.1 * ordinal),
          ],
        );
    }
    await sql`select brain_publish_revision(${documentId}, null, ${revision?.id ?? ''})`;
    return { documentId, revisionId: revision?.id ?? '' };
  };
  return { versionId, sourceId: source?.id ?? '', otherSourceId: other?.id ?? '', chunkIds, note };
};

const search = (
  sql: Sql,
  versionId: string,
  options: {
    vector?: string | null;
    text?: string;
    sources?: string[];
    tags?: string[];
    tagsAll?: boolean;
    prefix?: string | null;
    branch?: number;
    limit?: number;
  } = {},
) =>
  sql<Row[]>`select chunk_id::text, vector_rank, lexical_rank, cosine, lexical, fused
    from brain_search_candidates(${versionId}, ${options.vector ?? null}, ${options.text ?? ''},
      ${options.sources ?? []}::bigint[], ${options.tags ?? []}::text[], ${options.tagsAll ?? false},
      ${options.prefix ?? null}, ${options.branch ?? 50}, ${options.limit ?? 50})`;

await migrated(
  'only the pinned selection on live current revisions is eligible; vectors need a matching hash',
  async (sql) => {
    const { versionId, chunkIds, note } = await corpus(sql);
    await note('notes/live.md', [{ key: 'live', text: 'orchard planting guide', axis: 0 }]);
    await note('notes/stale-vector.md', [
      { key: 'stale', text: 'orchard pruning guide', axis: 1, staleVector: true },
    ]);
    const deleted = await note('notes/deleted.md', [
      { key: 'deleted', text: 'orchard secrets', axis: 2 },
    ]);
    const edited = await note('notes/edited.md', [
      { key: 'old', text: 'orchard old text', axis: 3 },
    ]);
    // The deleted note is tombstoned; the edited note moves to revision 2 without a vector yet.
    const [tomb] = await sql<
      { id: string }[]
    >`insert into document_revisions (document_id, revision, kind, uri)
    values (${deleted.documentId}, 2, 'tombstone', 'notes/deleted.md') returning id`;
    await sql`select brain_publish_revision(${deleted.documentId}, ${deleted.revisionId}, ${tomb?.id ?? ''})`;
    const [r2] = await sql<
      { id: string }[]
    >`insert into document_revisions (document_id, revision, kind, uri, content_hash)
    values (${edited.documentId}, 2, 'content', 'notes/edited.md', ${hash('e2')}) returning id`;
    const [set2] = await sql<
      { id: string }[]
    >`insert into chunk_sets (document_revision_id, document_id, chunker_version)
    values (${r2?.id ?? ''}, ${edited.documentId}, 'c1') returning id`;
    const [fresh] = await sql<
      { id: string }[]
    >`insert into chunks (document_id, chunk_set_id, ordinal, content, content_hash, token_count, chunker_version)
    values (${edited.documentId}, ${set2?.id ?? ''}, 0, 'orchard new text', ${hash('orchard new text')}, 3, 'c1') returning id`;
    await sql`select brain_publish_revision(${edited.documentId}, ${edited.revisionId}, ${r2?.id ?? ''})`;

    const rows = await search(sql, versionId, { vector: vec(1024, 0), text: 'orchard' });
    const byId = new Map(rows.map((row) => [row.chunk_id, row]));
    assert.ok(byId.get(chunkIds.live ?? '')?.vector_rank === 1, 'live chunk is the top vector hit');
    assert.equal(byId.get(chunkIds.stale ?? '')?.vector_rank, null, 'stale vector never ranks');
    assert.ok(byId.get(chunkIds.stale ?? '')?.lexical_rank, 'its text still matches lexically');
    assert.equal(
      byId.has(chunkIds.deleted ?? ''),
      false,
      'deleted note excluded from both branches',
    );
    assert.equal(byId.has(chunkIds.old ?? ''), false, 'superseded revision excluded');
    assert.equal(byId.get(fresh?.id ?? '')?.vector_rank, null, 'new revision has no vector yet');
    assert.ok(byId.get(fresh?.id ?? '')?.lexical_rank, 'but is lexically searchable at once');

    // Another version selects nothing yet: no candidates at all.
    await sql`insert into embedding_profiles (id, model, model_digest, dimensions) values ('q', 'm', ${hash('q')}, 1024)`;
    const [other] = await sql<
      { id: string }[]
    >`insert into embedding_versions (model, model_digest, dimensions, chunker_version, profile_id)
    values ('m', ${hash('q')}, 1024, 'c9', 'q') returning id`;
    const none = await search(sql, other?.id ?? '', { vector: vec(1024, 0), text: 'orchard' });
    assert.equal(none.length, 0);
  },
);

await migrated(
  'filters apply before branch limits: sources, tags any/all, component-aware literal prefixes',
  async (sql) => {
    const { versionId, chunkIds, note, otherSourceId } = await corpus(sql);
    await note('Projects/plan.md', [{ key: 'plan', text: 'roadmap alpha', axis: 0 }], {
      tags: ['work', 'q4'],
    });
    await note('Projects-old/plan.md', [{ key: 'old', text: 'roadmap beta', axis: 1 }], {
      tags: ['work'],
    });
    await note('a_b/x.md', [{ key: 'literal', text: 'roadmap gamma', axis: 2 }]);
    await note('axb/x.md', [{ key: 'wild', text: 'roadmap delta', axis: 3 }]);
    await note('README.md', [{ key: 'code', text: 'roadmap epsilon', axis: 4 }], {
      sourceId: otherSourceId,
    });
    const ids = async (options: Parameters<typeof search>[2]) =>
      new Set(
        (await search(sql, versionId, { text: 'roadmap', vector: vec(1024, 0), ...options })).map(
          (r) => r.chunk_id,
        ),
      );

    assert.deepEqual(await ids({ prefix: 'Projects' }), new Set([chunkIds.plan]));
    assert.deepEqual(await ids({ prefix: 'Projects/plan.md' }), new Set([chunkIds.plan]));
    assert.deepEqual(await ids({ prefix: 'a_b' }), new Set([chunkIds.literal]), '_ is literal');
    assert.deepEqual(await ids({ tags: ['q4', 'missing'] }), new Set([chunkIds.plan]));
    assert.deepEqual(await ids({ tags: ['work', 'q4'], tagsAll: true }), new Set([chunkIds.plan]));
    assert.deepEqual(await ids({ tags: ['work'] }), new Set([chunkIds.plan, chunkIds.old]));
    assert.deepEqual(await ids({ sources: [otherSourceId] }), new Set([chunkIds.code]));
    // Disabling a source removes its already-indexed notes from an unfiltered search.
    await sql`update sources set enabled = false where id = ${otherSourceId}`;
    assert.equal((await ids({})).has(chunkIds.code ?? ''), false);
    await sql`update sources set enabled = true where id = ${otherSourceId}`;
    // A filter that excludes the best vector hit still fills the branch from what remains.
    const limited = await search(sql, versionId, {
      vector: vec(1024, 0),
      prefix: 'axb',
      branch: 1,
    });
    assert.deepEqual(
      limited.map((r) => r.chunk_id),
      [chunkIds.wild],
    );
  },
);

await migrated(
  'the SQL merge orders candidates exactly like the fuseRankings reference',
  async (sql) => {
    const { versionId, note } = await corpus(sql);
    const texts = [
      'fox den',
      'fox trail map',
      'river fox',
      'mountain trail',
      'den of lions',
      'fox fox fox',
      'quiet lake',
      'trail fox den',
    ];
    for (const [index, text] of texts.entries())
      await note(`n/${index}.md`, [{ key: `k${index}`, text, axis: index % 5 }]);
    const rows = await search(sql, versionId, {
      vector: vec(1024, 1, 0.3),
      text: 'fox den',
      limit: 50,
    });
    assert.ok(
      rows.some((r) => r.vector_rank !== null && r.lexical_rank !== null),
      'both branches overlap',
    );

    const vector = rows
      .filter((r) => r.vector_rank !== null)
      .sort((a, b) => (a.vector_rank ?? 0) - (b.vector_rank ?? 0))
      .map((r) => ({ chunkId: r.chunk_id, cosine: r.cosine ?? 0 }));
    const lexical = rows
      .filter((r) => r.lexical_rank !== null)
      .sort((a, b) => (a.lexical_rank ?? 0) - (b.lexical_rank ?? 0))
      .map((r) => ({ chunkId: r.chunk_id, score: r.lexical ?? 0 }));
    const reference = fuseRankings(vector, lexical, { limit: 50 });

    assert.deepEqual(
      rows.map((r) => r.chunk_id),
      reference.map((r) => r.chunkId),
    );
    for (const [index, row] of rows.entries())
      assert.ok(
        Math.abs(row.fused - (reference[index]?.fusedScore ?? 0)) < 1e-12,
        `fused ${index}`,
      );
  },
);

await migrated('lexical-only mode, a 768-dimension version and parameter bounds', async (sql) => {
  const { versionId, chunkIds, note } = await corpus(sql, 768);
  await note('a.md', [{ key: 'a', text: 'harvest moon apples', axis: 0 }]);
  await note('b.md', [{ key: 'b', text: 'winter pears', axis: 1 }]);

  const lexicalOnly = await search(sql, versionId, { vector: null, text: 'apples' });
  assert.deepEqual(
    lexicalOnly.map((r) => [r.chunk_id, r.vector_rank, r.lexical_rank]),
    [[chunkIds.a, null, 1]],
  );
  const hybrid = await search(sql, versionId, { vector: vec(768, 1), text: 'apples' });
  assert.equal(hybrid[0]?.chunk_id, chunkIds.a, 'both branches beat one');
  assert.equal(hybrid.find((r) => r.chunk_id === chunkIds.b)?.vector_rank, 1);

  for (const [branch, limit] of [
    [0, 8],
    [201, 8],
    [50, 0],
    [50, 51],
  ] as const)
    await assert.rejects(
      search(sql, versionId, { text: 'x', branch, limit }),
      /candidate limits out of range/,
    );
  await assert.rejects(
    search(sql, versionId, { vector: vec(1024, 0), text: 'x' }),
    /different vector dimensions|expected 768 dimensions/,
  );
});

await migrated('gates are immutable; the reader may search, public may not', async (sql) => {
  const { versionId } = await corpus(sql);
  await sql`insert into embedding_version_gates (embedding_version_id, gate_id, min_cosine, min_lexical)
            values (${versionId}, 'v.gates', 0.6, 0.1)`;
  await assert.rejects(
    sql`update embedding_version_gates set min_cosine = 0`,
    /embedding_version_gates rows are immutable/,
  );
  await assert.rejects(
    sql`insert into embedding_version_gates (embedding_version_id, gate_id, calibration_questions) values (${versionId}, 'g', 3)`,
    /duplicate key|embedding_version_gates_calibration/,
  );
  const [privileges] = await sql<{ reader: boolean; public_exec: boolean; writer: boolean }[]>`
    select has_function_privilege('aetherion_brain_reader', p.oid, 'execute') as reader,
           has_function_privilege('aetherion_brain_writer', p.oid, 'execute') as writer,
           has_function_privilege('public', p.oid, 'execute') as public_exec
    from pg_proc p where p.proname = 'brain_search_candidates'`;
  assert.deepEqual(privileges, { reader: true, writer: false, public_exec: false });
});
