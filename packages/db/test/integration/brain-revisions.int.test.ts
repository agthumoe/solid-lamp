// ADR 0006 / #91: document revisions, immutable chunk sets, per-version selection, publication
// compare-and-set and coverage-checked promotion. Needs Postgres with pgvector (see
// brain-schema.int.test.ts); skips locally without AETHERION_TEST_DATABASE_URL.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import postgres, { type Sql } from 'postgres';

import { applyMigrations, withFreshDatabase } from '../support/fresh-database.ts';

const ADMIN_URL = process.env.AETHERION_TEST_DATABASE_URL;
const skip = ADMIN_URL
  ? false
  : 'AETHERION_TEST_DATABASE_URL not set: needs Postgres + pgvector (CI service, or local Docker)';
const PHASE1 = '20261018120000_brain_core.sql';
const REVISIONS = '20261021120000_brain_revisions.sql';

const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const vec = (value = 0.01) => `[${Array.from({ length: 1024 }, () => value).join(',')}]`;

const rejects = async (work: Promise<unknown>, pattern: RegExp) => {
  await assert.rejects(work, (error: Error) => {
    assert.match(error.message, pattern);
    return true;
  });
};

const migrated = (name: string, run: (sql: Sql, url: string) => Promise<void>) =>
  test(name, { skip }, async () => {
    if (!ADMIN_URL) return;
    await withFreshDatabase(ADMIN_URL, async (sql, url) => {
      await applyMigrations(sql);
      await run(sql, url);
    });
  });

const one = async <T>(rows: Promise<T[]>): Promise<T> => {
  const [row] = await rows;
  assert.ok(row);
  return row;
};

// --- fixtures (current schema) -------------------------------------------------------------

const newSource = async (sql: Sql) =>
  (
    await one(
      sql<
        { id: string }[]
      >`insert into sources (kind, name) values ('obsidian', ${`v${Math.random()}`}) returning id`,
    )
  ).id;

const newDocument = async (sql: Sql, sourceId: string, uri: string) =>
  (
    await one(
      sql<{ id: string }[]>`insert into documents (source_id, uri, content_hash)
        values (${sourceId}, ${uri}, ${hash(uri)}) returning id`,
    )
  ).id;

const newProfileVersion = async (sql: Sql, status = 'building', chunker = 'c1') => {
  const digest = hash(`m${Math.random()}`);
  const profileId = `p-${digest.slice(0, 12)}`;
  await sql`insert into embedding_profiles (id, model, model_digest, dimensions, num_ctx)
            values (${profileId}, 'm', ${digest}, 1024, 2048)`;
  return (
    await one(
      sql<{ id: string }[]>`insert into embedding_versions
        (model, model_digest, dimensions, chunker_version, status, profile_id)
        values ('m', ${digest}, 1024, ${chunker}, ${status}, ${profileId}) returning id`,
    )
  ).id;
};

type Revision = { revisionId: string; chunkSetIds: Record<string, string>; chunkIds: string[] };

// Inserts an immutable revision with one chunk set per chunker (text per chunk), not yet published.
const newRevision = async (
  sql: Sql,
  documentId: string,
  revision: number,
  chunks: readonly string[],
  chunkers: readonly string[] = ['c1'],
): Promise<Revision> => {
  const { id: revisionId } = await one(
    sql<
      { id: string }[]
    >`insert into document_revisions (document_id, revision, kind, uri, content_hash)
      select ${documentId}, ${revision}, 'content', uri, ${hash(`${documentId}:${revision}`)}
      from documents where id = ${documentId} returning id`,
  );
  const chunkSetIds: Record<string, string> = {};
  const chunkIds: string[] = [];
  for (const chunker of chunkers) {
    const { id: setId } = await one(
      sql<
        { id: string }[]
      >`insert into chunk_sets (document_revision_id, document_id, chunker_version)
        values (${revisionId}, ${documentId}, ${chunker}) returning id`,
    );
    chunkSetIds[chunker] = setId;
    for (const [ordinal, content] of chunks.entries()) {
      const { id } = await one(
        sql<{ id: string }[]>`insert into chunks
          (document_id, chunk_set_id, ordinal, content, content_hash, token_count, chunker_version, line_start, line_end)
          values (${documentId}, ${setId}, ${ordinal}, ${content}, ${hash(content)}, 3, ${chunker}, ${ordinal + 1}, ${ordinal + 1})
          returning id`,
      );
      chunkIds.push(id);
    }
  }
  return { revisionId, chunkSetIds, chunkIds };
};

const newTombstone = async (sql: Sql, documentId: string, revision: number) =>
  (
    await one(
      sql<{ id: string }[]>`insert into document_revisions (document_id, revision, kind, uri)
        select ${documentId}, ${revision}, 'tombstone', uri from documents where id = ${documentId}
        returning id`,
    )
  ).id;

const publish = async (sql: Sql, documentId: string, expected: string | null, revisionId: string) =>
  (
    await one(
      sql<
        { ok: boolean }[]
      >`select brain_publish_revision(${documentId}, ${expected}, ${revisionId}) as ok`,
    )
  ).ok;

const embedAll = async (sql: Sql, versionId: string, chunkIds: readonly string[]) => {
  for (const chunkId of chunkIds)
    await sql`insert into chunk_embeddings_1024 (embedding_version_id, chunk_id, content_hash, embedding)
              select ${versionId}, id, content_hash, ${vec()} from chunks where id = ${chunkId}`;
};

const selection = async (sql: Sql, versionId: string, documentId: string) =>
  (
    await sql<{ chunk_set_id: string }[]>`select chunk_set_id from embedding_version_selections
      where embedding_version_id = ${versionId} and document_id = ${documentId}`
  )[0]?.chunk_set_id ?? null;

// --- upgrade -----------------------------------------------------------------------------------

await test(
  'upgrade: Phase 1 rows are preserved and backfilled into revisions, sets and selections',
  { skip },
  async () => {
    if (!ADMIN_URL) return;
    await withFreshDatabase(ADMIN_URL, async (sql) => {
      await applyMigrations(sql, { through: PHASE1 });
      // Phase 1 fixture: a live note with two chunks under two chunkers, a deleted note, an active
      // version with every vector and a building version on the second chunker.
      const sourceId = (
        await one(
          sql<
            { id: string }[]
          >`insert into sources (kind, name) values ('obsidian', 'vault') returning id`,
        )
      ).id;
      const live = (
        await one(sql<
          { id: string }[]
        >`insert into documents (source_id, uri, title, tags, content_hash)
      values (${sourceId}, 'notes/live.md', 'Live', '{work}', ${hash('live')}) returning id`)
      ).id;
      const gone = (
        await one(sql<
          { id: string }[]
        >`insert into documents (source_id, uri, content_hash, deleted_at)
      values (${sourceId}, 'notes/gone.md', ${hash('gone')}, now()) returning id`)
      ).id;
      const chunkRows = await sql<{ id: string }[]>`
      insert into chunks (document_id, ordinal, content, content_hash, token_count, chunker_version) values
        (${live}, 0, 'alpha', ${hash('alpha')}, 1, 'c1'),
        (${live}, 1, 'beta', ${hash('beta')}, 1, 'c1'),
        (${live}, 2, 'alpha beta', ${hash('ab')}, 2, 'c2'), -- Phase 1 could not repeat ordinals per chunker (F2)
        (${gone}, 0, 'gamma', ${hash('gamma')}, 1, 'c1')
      returning id`;
      const active = (
        await one(sql<{ id: string }[]>`insert into embedding_versions
      (model, model_digest, dimensions, chunker_version, status, promoted_at)
      values ('m', ${hash('m1')}, 1024, 'c1', 'active', now()) returning id`)
      ).id;
      const building = (
        await one(sql<{ id: string }[]>`insert into embedding_versions
      (model, model_digest, dimensions, chunker_version) values ('m2', ${hash('m2')}, 1024, 'c2') returning id`)
      ).id;
      await sql`update search_config set active_embedding_version_id = ${active}, active_status = 'active'`;
      await sql`insert into chunk_embeddings_1024 (embedding_version_id, chunk_id, content_hash, embedding)
              select ${active}, id, content_hash, ${vec()} from chunks where chunker_version = 'c1'`;
      const before =
        await sql`select id, document_id, ordinal, content, content_hash from chunks order by id`;

      await applyMigrations(sql, { from: REVISIONS });

      const after =
        await sql`select id, document_id, ordinal, content, content_hash from chunks order by id`;
      assert.deepEqual([...after], [...before], 'chunk rows unchanged');
      const revisions = await sql<
        { document_id: string; revision: string; kind: string; uri: string }[]
      >`
      select document_id, revision::text, kind, uri from document_revisions order by document_id, revision`;
      assert.deepEqual(
        revisions.map((r) => [r.document_id, r.revision, r.kind]),
        [
          [live, '1', 'content'],
          [gone, '1', 'content'],
          [gone, '2', 'tombstone'],
        ],
      );
      const current = await sql<{ id: string; revision: string }[]>`
      select d.id, r.revision::text from documents d join document_revisions r on r.id = d.current_revision_id order by d.id`;
      assert.deepEqual(
        current.map((r) => [r.id, r.revision]),
        [
          [live, '1'],
          [gone, '2'],
        ],
      );
      const sets = await sql<{ document_id: string; chunker_version: string; chunks: string }[]>`
      select s.document_id, s.chunker_version, count(c.id)::text as chunks
      from chunk_sets s join chunks c on c.chunk_set_id = s.id group by 1, 2 order by 1, 2`;
      assert.deepEqual(
        sets.map((s) => [s.document_id, s.chunker_version, s.chunks]),
        [
          [live, 'c1', '2'],
          [live, 'c2', '1'],
          [gone, 'c1', '1'],
        ],
      );
      const selections = await sql<
        { embedding_version_id: string; document_id: string; chunker_version: string }[]
      >`
      select embedding_version_id, document_id, chunker_version from embedding_version_selections order by 1, 2`;
      assert.deepEqual(
        selections.map((s) => [s.embedding_version_id, s.document_id, s.chunker_version]),
        [
          [active, live, 'c1'],
          [building, live, 'c2'],
        ],
      );
      const versions = await sql<
        { id: string; profile_id: string; status: string; num_ctx: number | null }[]
      >`
      select v.id, v.profile_id, v.status, p.num_ctx from embedding_versions v
      join embedding_profiles p on p.id = v.profile_id order by v.id`;
      assert.deepEqual(
        versions.map((v) => [v.profile_id, v.status, v.num_ctx]),
        [
          [`legacy-v${active}`, 'active', null],
          [`legacy-v${building}`, 'building', null],
        ],
      );
      // The preserved active version still covers the corpus: re-promotion passes the coverage check.
      await sql`select brain_promote_version(${active})`;
      assert.equal(chunkRows.length, 4);
    });
  },
);

// --- immutability and composite keys ----------------------------------------------------------

await migrated('revisions, chunk sets, chunks and profiles are immutable', async (sql) => {
  const doc = await newDocument(sql, await newSource(sql), 'a.md');
  const { revisionId, chunkSetIds, chunkIds } = await newRevision(sql, doc, 1, ['x']);
  await newProfileVersion(sql);

  await rejects(
    sql`update document_revisions set title = 't' where id = ${revisionId}`,
    /document_revisions rows are immutable/,
  );
  await rejects(
    sql`update chunk_sets set chunker_version = 'c9' where id = ${chunkSetIds.c1 ?? ''}`,
    /chunk_sets rows are immutable/,
  );
  await rejects(
    sql`update chunks set content = 'y' where id = ${chunkIds[0] ?? ''}`,
    /chunks rows are immutable/,
  );
  await rejects(
    sql`update embedding_profiles set num_ctx = 1`,
    /embedding_profiles rows are immutable/,
  );
  // Deletion (cleanup, cascades) stays possible.
  await sql`delete from documents where id = ${doc}`;
  assert.equal((await sql`select 1 from chunk_sets`).length, 0);
});

await migrated(
  'composite keys keep documents, revisions, sets, chunkers and versions consistent',
  async (sql) => {
    const source = await newSource(sql);
    const a = await newDocument(sql, source, 'a.md');
    const b = await newDocument(sql, source, 'b.md');
    const ra = await newRevision(sql, a, 1, ['x']);
    const rb = await newRevision(sql, b, 1, ['y']);
    const v1 = await newProfileVersion(sql, 'building', 'c1');

    await rejects(
      sql`insert into chunk_sets (document_revision_id, document_id, chunker_version) values (${ra.revisionId}, ${b}, 'c2')`,
      /chunk_sets_revision_fk/,
    );
    await rejects(
      sql`insert into chunks (document_id, chunk_set_id, ordinal, content, content_hash, token_count, chunker_version)
        values (${a}, ${ra.chunkSetIds.c1 ?? ''}, 5, 'z', ${hash('z')}, 1, 'c2')`,
      /chunks_set_chunker_fk/,
    );
    await rejects(
      sql`insert into chunks (document_id, chunk_set_id, ordinal, content, content_hash, token_count, chunker_version)
        values (${b}, ${ra.chunkSetIds.c1 ?? ''}, 5, 'z', ${hash('z')}, 1, 'c1')`,
      /chunks_set_document_fk/,
    );
    await rejects(
      sql`insert into chunks (document_id, chunk_set_id, ordinal, content, content_hash, token_count, chunker_version, line_start, line_end)
        values (${a}, ${ra.chunkSetIds.c1 ?? ''}, 6, 'z', ${hash('z')}, 1, 'c1', 9, 3)`,
      /chunks_line_range/,
    );
    await rejects(
      sql`insert into embedding_version_selections (embedding_version_id, document_id, chunk_set_id, chunker_version)
        values (${v1}, ${a}, ${rb.chunkSetIds.c1 ?? ''}, 'c1')`,
      /selections_set_document_fk/,
    );
    const c2 = await newRevision(sql, a, 2, ['x2'], ['c2']);
    await rejects(
      sql`insert into embedding_version_selections (embedding_version_id, document_id, chunk_set_id, chunker_version)
        values (${v1}, ${a}, ${c2.chunkSetIds.c2 ?? ''}, 'c2')`,
      /selections_version_fk/,
    );
    // A document's current revision must be its own (deferred check at commit).
    await rejects(
      sql.begin(
        (tx) => tx`update documents set current_revision_id = ${rb.revisionId} where id = ${a}`,
      ),
      /documents_current_revision_fk/,
    );
    // A version's dimensions/digest must be its profile's.
    const p = await one(
      sql<{ id: string }[]>`select profile_id as id from embedding_versions where id = ${v1}`,
    );
    await rejects(
      sql`insert into embedding_versions (model, model_digest, dimensions, chunker_version, profile_id)
        values ('m', ${hash('other')}, 1024, 'c1', ${p.id})`,
      /embedding_versions_profile_fk/,
    );
  },
);

// --- publication -------------------------------------------------------------------------------

await migrated(
  'publication is compare-and-set on the current revision; numbers only grow',
  async (sql) => {
    const doc = await newDocument(sql, await newSource(sql), 'notes/a.md');
    const r1 = await newRevision(sql, doc, 1, ['one']);
    const r2 = await newRevision(sql, doc, 2, ['two']);

    assert.equal(await publish(sql, doc, null, r1.revisionId), true);
    // A job planned against "no revision yet" is now stale.
    assert.equal(await publish(sql, doc, null, r2.revisionId), false);
    assert.equal(await publish(sql, doc, r1.revisionId, r2.revisionId), true);
    // An older revision can never be published over a newer one.
    await rejects(
      publish(sql, doc, r2.revisionId, r1.revisionId),
      /revision numbers must increase/,
    );
    const other = await newDocument(sql, await newSource(sql), 'b.md');
    const foreign = await newRevision(sql, other, 1, ['b']);
    await rejects(
      publish(sql, doc, r2.revisionId, foreign.revisionId),
      /does not belong to document/,
    );
    const [state] = await sql<{ current_revision_id: string; content_hash: string }[]>`
    select current_revision_id, content_hash from documents where id = ${doc}`;
    assert.equal(state?.current_revision_id, r2.revisionId);
    assert.equal(state?.content_hash, hash(`${doc}:2`));
  },
);

await migrated('a delete wins over a late edit: no stale resurrection', async (sql) => {
  const doc = await newDocument(sql, await newSource(sql), 'notes/a.md');
  const active = await newProfileVersion(sql, 'building');
  const r1 = await newRevision(sql, doc, 1, ['one']);
  assert.equal(await publish(sql, doc, null, r1.revisionId), true);
  assert.equal(await selection(sql, active, doc), r1.chunkSetIds.c1);

  // An edit job reads r1, then the file is deleted before the job finishes.
  const late = await newRevision(sql, doc, 3, ['late edit']);
  const tomb = await newTombstone(sql, doc, 2);
  assert.equal(await publish(sql, doc, r1.revisionId, tomb), true);
  assert.equal(await publish(sql, doc, r1.revisionId, late.revisionId), false);

  const [state] = await sql<{ deleted: boolean; current: string }[]>`
    select deleted_at is not null as deleted, current_revision_id as current from documents where id = ${doc}`;
  assert.deepEqual(state, { deleted: true, current: tomb });
  assert.equal(await selection(sql, active, doc), null, 'tombstone drops selections');

  // Recreating the file later is a new revision on top of the tombstone.
  const r4 = await newRevision(sql, doc, 4, ['back']);
  assert.equal(await publish(sql, doc, tomb, r4.revisionId), true);
  assert.equal(
    (
      await one(
        sql<
          { deleted: boolean }[]
        >`select deleted_at is not null as deleted from documents where id = ${doc}`,
      )
    ).deleted,
    false,
  );
  assert.equal(await selection(sql, active, doc), r4.chunkSetIds.c1);
});

await migrated(
  'publication repoints selections of non-retired versions with a matching chunker only',
  async (sql) => {
    const doc = await newDocument(sql, await newSource(sql), 'a.md');
    const c1Building = await newProfileVersion(sql, 'building', 'c1');
    const c2Ready = await newProfileVersion(sql, 'ready', 'c2');
    const c1Retired = await newProfileVersion(sql, 'retired', 'c1');
    const r1 = await newRevision(sql, doc, 1, ['x'], ['c1', 'c2']);
    await publish(sql, doc, null, r1.revisionId);
    assert.equal(await selection(sql, c1Building, doc), r1.chunkSetIds.c1);
    assert.equal(await selection(sql, c2Ready, doc), r1.chunkSetIds.c2);
    assert.equal(await selection(sql, c1Retired, doc), null);

    // A failed rechunk: revision 2 only has a c1 set; the c2 version keeps its old (stale) set,
    // which promotion's coverage check then rejects instead of serving a mixed state.
    const r2 = await newRevision(sql, doc, 2, ['x2'], ['c1']);
    await publish(sql, doc, r1.revisionId, r2.revisionId);
    assert.equal(await selection(sql, c1Building, doc), r2.chunkSetIds.c1);
    assert.equal(await selection(sql, c2Ready, doc), r1.chunkSetIds.c2);
  },
);

// --- promotion ---------------------------------------------------------------------------------

await migrated(
  'promotion requires complete current coverage, then switches atomically',
  async (sql) => {
    const source = await newSource(sql);
    const a = await newDocument(sql, source, 'a.md');
    const b = await newDocument(sql, source, 'b.md');
    const old = await newProfileVersion(sql, 'ready');
    const next = await newProfileVersion(sql, 'building');
    const ra = await newRevision(sql, a, 1, ['a1', 'a2']);
    const rb = await newRevision(sql, b, 1, ['b1']);
    await publish(sql, a, null, ra.revisionId);
    await publish(sql, b, null, rb.revisionId);
    await embedAll(sql, old, [...ra.chunkIds, ...rb.chunkIds]);
    await sql`select brain_promote_version(${old})`;

    await rejects(sql`select brain_promote_version(${next})`, /is building, not ready/);
    await sql`update embedding_versions set status = 'ready' where id = ${next}`;
    await embedAll(sql, next, ra.chunkIds);
    await rejects(
      sql`select brain_promote_version(${next})`,
      /0 documents without a current selection, 1 chunks without a matching vector/,
    );
    // A vector computed from different text does not count.
    await sql`insert into chunk_embeddings_1024 (embedding_version_id, chunk_id, content_hash, embedding)
            values (${next}, ${rb.chunkIds[0] ?? ''}, ${hash('stale text')}, ${vec()})`;
    await rejects(sql`select brain_promote_version(${next})`, /1 chunks without a matching vector/);
    await sql`delete from chunk_embeddings_1024 where embedding_version_id = ${next} and chunk_id = ${rb.chunkIds[0] ?? ''}`;
    await embedAll(sql, next, rb.chunkIds);
    // Deleted documents do not need coverage.
    await publish(sql, b, rb.revisionId, await newTombstone(sql, b, 2));

    await sql`select brain_promote_version(${next})`;
    const states = await sql<
      { id: string; status: string }[]
    >`select id, status from embedding_versions order by id`;
    assert.deepEqual(
      states.map((s) => [s.id, s.status]),
      [
        [old, 'retired'],
        [next, 'active'],
      ],
    );
    const [config] = await sql<
      { id: string }[]
    >`select active_embedding_version_id as id from search_config`;
    assert.equal(config?.id, next);
  },
);

await migrated(
  'rollback to a stale retired version is rejected until it covers current content',
  async (sql) => {
    const doc = await newDocument(sql, await newSource(sql), 'a.md');
    const old = await newProfileVersion(sql, 'ready');
    const r1 = await newRevision(sql, doc, 1, ['one']);
    await publish(sql, doc, null, r1.revisionId);
    await embedAll(sql, old, r1.chunkIds);
    await sql`select brain_promote_version(${old})`;
    const next = await newProfileVersion(sql, 'ready');
    // Backfill the new version's selection for existing content, as a build would.
    await sql`insert into embedding_version_selections (embedding_version_id, document_id, chunk_set_id, chunker_version)
            values (${next}, ${doc}, ${r1.chunkSetIds.c1 ?? ''}, 'c1')`;
    await embedAll(sql, next, r1.chunkIds);
    await sql`select brain_promote_version(${next})`;

    // An edit arrives while `old` is retired: only the active/building/ready versions follow it.
    const r2 = await newRevision(sql, doc, 2, ['two']);
    await publish(sql, doc, r1.revisionId, r2.revisionId);
    await embedAll(sql, next, r2.chunkIds);
    await rejects(
      sql`select brain_promote_version(${old})`,
      /1 documents without a current selection/,
    );
    const [active] = await sql<
      { id: string }[]
    >`select id from embedding_versions where status = 'active'`;
    assert.equal(active?.id, next);
  },
);

await migrated(
  'promotion waits for an in-flight publication instead of checking a moving corpus',
  async (sql, url) => {
    const doc = await newDocument(sql, await newSource(sql), 'a.md');
    const version = await newProfileVersion(sql, 'ready');
    const r1 = await newRevision(sql, doc, 1, ['one']);
    await publish(sql, doc, null, r1.revisionId);
    await embedAll(sql, version, r1.chunkIds);
    const r2 = await newRevision(sql, doc, 2, ['two']);

    const publisher = postgres(url, { max: 1, onnotice: () => undefined });
    const promoter = postgres(url, { max: 1, onnotice: () => undefined });
    try {
      let release: () => void = () => undefined;
      const held = new Promise<void>((resolve) => (release = resolve));
      let published: () => void = () => undefined;
      const inside = new Promise<void>((resolve) => (published = resolve));
      // Publication holds the shared lock in an open transaction...
      const tx = publisher.begin(async (t) => {
        await t`select brain_publish_revision(${doc}, ${r1.revisionId}, ${r2.revisionId})`;
        published();
        await held;
      });
      await inside;
      // ...so promotion cannot take the exclusive lock until it commits.
      await rejects(
        promoter.begin(async (t) => {
          await t`set local lock_timeout = '300ms'`;
          await t`select brain_promote_version(${version})`;
        }),
        /lock timeout/,
      );
      release();
      await tx;
      // After the edit commits, the check sees it: r2 has no vectors yet.
      await rejects(
        promoter`select brain_promote_version(${version})`,
        /1 chunks without a matching vector/,
      );
      await embedAll(sql, version, r2.chunkIds);
      await promoter`select brain_promote_version(${version})`;
    } finally {
      await publisher.end({ timeout: 5 });
      await promoter.end({ timeout: 5 });
    }
  },
);

// --- durable work -------------------------------------------------------------------------------

await migrated('ingest events, builds and leases enforce their state rules', async (sql) => {
  const source = await newSource(sql);
  const doc = await newDocument(sql, source, 'a.md');
  const { id: first } = await one(
    sql<{ id: string }[]>`insert into ingest_events (source_id, document_id, kind, path_hash)
      values (${source}, ${doc}, 'changed', ${hash('a.md')}) returning id`,
  );
  const { id: second } = await one(
    sql<
      { id: string }[]
    >`insert into ingest_events (source_id, kind) values (${source}, 'resync') returning id`,
  );
  assert.ok(BigInt(second) > BigInt(first), 'the event id is a monotonic watermark');

  await rejects(
    sql`insert into ingest_events (source_id, kind) values (${source}, 'changed')`,
    /ingest_events_target|ingest_events_path_hash/,
  );
  await rejects(
    sql`insert into ingest_events (source_id, document_id, kind, path_hash) values (${source}, ${doc}, 'resync', null)`,
    /ingest_events_target/,
  );
  await rejects(
    sql`update ingest_events set status = 'leased' where id = ${first}`,
    /ingest_events_lease/,
  );
  await sql`update ingest_events set status = 'leased', lease_owner = 'worker-1', lease_expires_at = now() + interval '1 minute' where id = ${first}`;
  await rejects(
    sql`update ingest_events set status = 'done', lease_owner = null, lease_expires_at = null where id = ${first}`,
    /ingest_events_processed/,
  );
  await sql`update ingest_events set status = 'done', lease_owner = null, lease_expires_at = null, processed_at = now() where id = ${first}`;
  const pending =
    await sql`select id from ingest_events where status in ('pending', 'leased') order by next_attempt_at, id`;
  assert.deepEqual(
    pending.map((row) => (row as { id: string }).id),
    [second],
  );

  const version = await newProfileVersion(sql);
  await sql`insert into embedding_builds (embedding_version_id, total_chunks) values (${version}, 10)`;
  await rejects(
    sql`insert into embedding_builds (embedding_version_id) values (${version})`,
    /embedding_builds_one_open_idx/,
  );
  await rejects(sql`update embedding_builds set embedded_chunks = 11`, /embedding_builds_progress/);
  await rejects(
    sql`update embedding_builds set status = 'completed'`,
    /embedding_builds_completed/,
  );
  await sql`update embedding_builds set status = 'completed', embedded_chunks = 10, completed_at = now()`;
  await sql`insert into embedding_builds (embedding_version_id) values (${version})`;

  await sql`insert into embedding_version_leases (embedding_version_id, holder, expires_at)
            values (${version}, 'api:req-1', now() + interval '30 seconds')`;
  await rejects(
    sql`insert into embedding_version_leases (embedding_version_id, holder, expires_at)
        values (${version}, 'api:req-2', now() + interval '1 hour')`,
    /embedding_version_leases_bounded/,
  );
});

// --- privileges --------------------------------------------------------------------------------

await migrated(
  'functions are invoker-only with an empty search path; roles are least privilege',
  async (sql) => {
    const functions = await sql<
      { proname: string; prosecdef: boolean; proconfig: string[] | null; public_exec: boolean }[]
    >`
    select p.proname, p.prosecdef, p.proconfig,
           has_function_privilege('public', p.oid, 'execute') as public_exec
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'brain\\_%' order by 1`;
    assert.deepEqual(
      functions.map((f) => f.proname),
      ['brain_promote_version', 'brain_publish_revision', 'brain_reject_update'],
    );
    for (const f of functions) {
      assert.equal(f.prosecdef, false, `${f.proname} must not be security definer`);
      assert.deepEqual(f.proconfig, ['search_path=""'], `${f.proname} search_path`);
      assert.equal(f.public_exec, false, `${f.proname} executable by public`);
    }
    const roles = await sql<
      {
        rolname: string;
        rolcanlogin: boolean;
        rolcreatedb: boolean;
        rolsuper: boolean;
        rolbypassrls: boolean;
      }[]
    >`
    select rolname, rolcanlogin, rolcreatedb, rolsuper, rolbypassrls from pg_roles
    where rolname in ('aetherion_brain_reader', 'aetherion_brain_writer') order by 1`;
    assert.deepEqual(
      roles.map((r) => [r.rolname, r.rolcanlogin, r.rolcreatedb, r.rolsuper, r.rolbypassrls]),
      [
        ['aetherion_brain_reader', false, false, false, false],
        ['aetherion_brain_writer', false, false, false, false],
      ],
    );

    const doc = await newDocument(sql, await newSource(sql), 'a.md');
    const r1 = await newRevision(sql, doc, 1, ['one']);
    const version = await newProfileVersion(sql, 'ready');
    // The test login may not be a superuser (Supabase's postgres is not), so it joins the roles first.
    await sql`grant aetherion_brain_reader, aetherion_brain_writer to current_user`;
    const asRole = <T>(role: string, work: (tx: Sql) => Promise<T>) =>
      sql.begin(async (tx) => {
        await tx.unsafe(`set local role ${role}`);
        return work(tx as unknown as Sql);
      });

    // The reader sees rows through its RLS policy, takes leases, and writes nothing else.
    const visible = await asRole(
      'aetherion_brain_reader',
      (tx) => tx`select count(*)::int as n from documents`,
    );
    assert.equal((visible[0] as { n: number }).n, 1);
    await asRole(
      'aetherion_brain_reader',
      (tx) => tx`insert into embedding_version_leases (embedding_version_id, holder, expires_at)
    values (${version}, 'api:r', now() + interval '10 seconds')`,
    );
    await rejects(
      asRole(
        'aetherion_brain_reader',
        (tx) =>
          tx`insert into ingest_events (source_id, kind) select source_id, 'resync' from documents`,
      ),
      /permission denied/,
    );
    await rejects(
      asRole(
        'aetherion_brain_reader',
        (tx) => tx`select brain_publish_revision(${doc}, null, ${r1.revisionId})`,
      ),
      /permission denied/,
    );

    // The writer publishes through the compare-and-set function but cannot promote or touch profiles.
    const ok = await asRole(
      'aetherion_brain_writer',
      (tx) => tx`select brain_publish_revision(${doc}, null, ${r1.revisionId}) as ok`,
    );
    assert.equal((ok[0] as { ok: boolean }).ok, true);
    await rejects(
      asRole('aetherion_brain_writer', (tx) => tx`select brain_promote_version(${version})`),
      /permission denied/,
    );
    await rejects(
      asRole(
        'aetherion_brain_writer',
        (tx) =>
          tx`insert into embedding_profiles (id, model, model_digest, dimensions) values ('x', 'm', ${hash('x')}, 1024)`,
      ),
      /permission denied/,
    );
    await rejects(
      asRole('aetherion_brain_writer', (tx) => tx`update search_config set updated_at = now()`),
      /permission denied/,
    );
  },
);
