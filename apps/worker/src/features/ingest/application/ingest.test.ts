import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import type { OpenResult, SourceReader } from '@aetherion/brain';

import { embedMissing } from './embed-missing.ts';
import { ingestDocument } from './ingest-document.ts';
import type {
  ChangeEvent,
  DocumentEmbedder,
  IngestStore,
  MissingVector,
  NewRevision,
  ScanRecord,
  VersionTarget,
} from './ports.ts';
import { resyncSource } from './resync-source.ts';

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');
const signal = () => AbortSignal.timeout(2_000);

// In-memory store with the same semantics as the Postgres one: revisions grow, publication is a
// compare-and-set on the current revision, tombstones mark deletion, vectors are per version.
const memoryStore = (targets: VersionTarget[] = []) => {
  type Doc = {
    id: string;
    path: string;
    current: string | null;
    revision: number;
    hash: string | null;
    deleted: boolean;
    chunks: { id: string; content: string; contentHash: string }[];
  };
  const docs = new Map<string, Doc>();
  const vectors = new Map<string, Set<string>>(); // version -> chunk ids
  const events: (ChangeEvent & { id: string; done: boolean })[] = [];
  const scans: ScanRecord[] = [];
  const resyncs: string[] = [];
  const published: NewRevision[] = [];
  let ids = 0;
  const next = () => String(++ids);
  const store: IngestStore = {
    ensureSource: (name) => Promise.resolve(`src:${name}`),
    documentState: (_source, path) => {
      const doc = docs.get(path);
      return Promise.resolve(
        doc
          ? {
              documentId: doc.id,
              currentRevisionId: doc.current,
              currentRevision: doc.revision,
              currentHash: doc.hash,
              deleted: doc.deleted,
            }
          : null,
      );
    },
    publish: (revision) => {
      const doc = docs.get(revision.path) ?? {
        id: next(),
        path: revision.path,
        current: null,
        revision: 0,
        hash: null,
        deleted: false,
        chunks: [],
      };
      docs.set(revision.path, doc);
      if (doc.current !== revision.expectedRevisionId || revision.revision <= doc.revision)
        return Promise.resolve('superseded' as const);
      published.push(revision);
      doc.current = next();
      doc.revision = revision.revision;
      if (revision.kind === 'tombstone') {
        doc.deleted = true;
        doc.chunks = [];
      } else {
        doc.deleted = false;
        doc.hash = revision.contentHash;
        doc.chunks = revision.chunks.map((chunk) => ({
          id: next(),
          content: chunk.content,
          contentHash: chunk.contentHash,
        }));
      }
      return Promise.resolve('published' as const);
    },
    indexedPaths: () =>
      Promise.resolve(
        new Map(
          [...docs.values()].filter((d) => !d.deleted && d.hash).map((d) => [d.path, d.hash ?? '']),
        ),
      ),
    recordEvents: (_source, recorded) => {
      for (const event of recorded) events.push({ ...event, id: next(), done: false });
      return Promise.resolve(recorded.length);
    },
    requestResync: (source) => {
      resyncs.push(source);
      return Promise.resolve();
    },
    eventWatermark: () => Promise.resolve(String(ids)),
    completeDocument: (_source, path, upTo) => {
      for (const event of events)
        if (event.path === path && Number(event.id) <= Number(upTo)) event.done = true;
      return Promise.resolve();
    },
    completeResync: () => Promise.resolve(),
    recordScan: (_source, scan) => {
      scans.push(scan);
      return Promise.resolve();
    },
    embeddingTargets: () => Promise.resolve(targets),
    missingVectors: (versionId, limit, documentId) => {
      const have = vectors.get(versionId) ?? new Set();
      const rows: MissingVector[] = [...docs.values()]
        .filter((d) => !d.deleted && (documentId === null || d.id === documentId))
        .flatMap((d) => d.chunks)
        .filter((chunk) => !have.has(chunk.id))
        .slice(0, limit)
        .map((chunk) => ({
          chunkId: chunk.id,
          content: chunk.content,
          contentHash: chunk.contentHash,
        }));
      return Promise.resolve(rows);
    },
    storeVectors: (target, rows) => {
      const set = vectors.get(target.versionId) ?? new Set<string>();
      for (const row of rows) set.add(row.chunkId);
      vectors.set(target.versionId, set);
      return Promise.resolve();
    },
  };
  return { store, docs, vectors, events, scans, resyncs, published };
};

const fakeReader = (files: Record<string, string>, refused: Record<string, OpenResult> = {}) => {
  const reader: SourceReader = {
    root: '/vault',
    open: (path: string): Promise<OpenResult> => {
      if (refused[path]) return Promise.resolve(refused[path]);
      const content = files[path];
      return Promise.resolve(
        content === undefined
          ? { ok: false, reason: 'not_found', relativePath: path }
          : {
              ok: true,
              file: {
                relativePath: path,
                content,
                size: content.length,
                mtimeMs: 1,
                dev: 1,
                ino: 1,
              },
            },
      );
    },
    list: () => Promise.resolve(Object.keys(files).sort()),
    close: () => Promise.resolve(),
    refusals: () => ({}),
  };
  return reader;
};

const target: VersionTarget = {
  versionId: 'v1',
  profileId: 'ep-0123456789abcdef01234567',
  dimensions: 3,
};
const embedder = (
  override: Partial<{
    profileId: string;
    dimensions: number;
    fail: 'transient' | 'permanent';
  }> = {},
) => {
  const calls: { texts: readonly string[]; profileId: string }[] = [];
  const embed: DocumentEmbedder = (texts, profileId) => {
    calls.push({ texts, profileId });
    if (override.fail)
      return Promise.resolve({
        ok: false,
        retryable: override.fail === 'transient',
        message: 'down',
      });
    const dimensions = override.dimensions ?? 3;
    return Promise.resolve({
      ok: true,
      value: {
        vectors: texts.map(() => Array.from({ length: dimensions }, () => 0.5)),
        profileId: override.profileId ?? profileId,
        dimensions,
      },
    });
  };
  return { embed, calls };
};

const note = '---\ntags: [work]\n---\n# Plan\nGoals for the quarter.\n\n## Budget\nCosts.\n';

await test('a new note is parsed, chunked, published and embedded with the version profile', async () => {
  const memory = memoryStore([target]);
  const { embed, calls } = embedder();
  const result = await ingestDocument(
    {
      store: memory.store,
      readers: (name) =>
        Promise.resolve(name === 'vault' ? fakeReader({ 'Plan.md': note }) : undefined),
      embed,
    },
    { sourceId: 'vault', path: 'Plan.md' },
    signal(),
  );
  assert.deepEqual(result, { ok: true, value: 'published' });
  const revision = memory.published[0];
  assert.ok(revision?.kind === 'content');
  assert.equal(revision.contentHash, sha256(note), 'the exact source bytes are the revision hash');
  assert.deepEqual(revision.tags, ['work']);
  assert.ok(revision.chunks.length >= 2);
  assert.ok(
    revision.chunks.every((chunk) => chunk.lineStart >= 1 && chunk.lineEnd >= chunk.lineStart),
  );
  assert.deepEqual(
    calls.map((c) => c.profileId),
    [target.profileId],
  );
  assert.equal(memory.vectors.get('v1')?.size, revision.chunks.length);
});

await test('unchanged bytes do not create a revision but still complete missing vectors', async () => {
  const memory = memoryStore([target]);
  const readers = () => Promise.resolve(fakeReader({ 'Plan.md': note }));
  const failing = embedder({ fail: 'transient' });
  const first = await ingestDocument(
    { store: memory.store, readers, embed: failing.embed },
    { sourceId: 'vault', path: 'Plan.md' },
    signal(),
  );
  assert.equal(first.ok ? null : first.error.code, 'RETRYABLE', 'inference down is retried');
  assert.equal(memory.published.length, 1, 'publication happened before embedding');

  const retry = await ingestDocument(
    { store: memory.store, readers, embed: embedder().embed },
    { sourceId: 'vault', path: 'Plan.md' },
    signal(),
  );
  assert.deepEqual(retry, { ok: true, value: 'unchanged' });
  assert.equal(memory.published.length, 1);
  assert.ok((memory.vectors.get('v1')?.size ?? 0) > 0);
});

await test('a frontmatter-only edit is a new revision; a deleted or ineligible file is tombstoned', async () => {
  const memory = memoryStore();
  const files: Record<string, string> = { 'Plan.md': note };
  const refused: Record<string, OpenResult> = {};
  const deps = {
    store: memory.store,
    readers: () => Promise.resolve(fakeReader(files, refused)),
    embed: embedder().embed,
  };
  await ingestDocument(deps, { sourceId: 'vault', path: 'Plan.md' }, signal());
  files['Plan.md'] = note.replace('tags: [work]', 'tags: [work, q4]');
  assert.deepEqual(await ingestDocument(deps, { sourceId: 'vault', path: 'Plan.md' }, signal()), {
    ok: true,
    value: 'published',
  });
  assert.equal(memory.docs.get('Plan.md')?.revision, 2);

  delete files['Plan.md'];
  assert.deepEqual(await ingestDocument(deps, { sourceId: 'vault', path: 'Plan.md' }, signal()), {
    ok: true,
    value: 'tombstoned',
  });
  assert.equal(memory.docs.get('Plan.md')?.deleted, true);
  // A second delete event finds nothing live to remove.
  assert.deepEqual(await ingestDocument(deps, { sourceId: 'vault', path: 'Plan.md' }, signal()), {
    ok: true,
    value: 'skipped',
  });

  files['Big.md'] = note;
  await ingestDocument(deps, { sourceId: 'vault', path: 'Big.md' }, signal());
  refused['Big.md'] = { ok: false, reason: 'too_large', relativePath: 'Big.md' };
  assert.deepEqual(await ingestDocument(deps, { sourceId: 'vault', path: 'Big.md' }, signal()), {
    ok: true,
    value: 'tombstoned',
  });
});

await test('a late job loses the compare-and-set and never overwrites a newer revision', async () => {
  const memory = memoryStore();
  const files: Record<string, string> = { 'Plan.md': note };
  const deps = {
    store: memory.store,
    readers: () => Promise.resolve(fakeReader(files)),
    embed: embedder().embed,
  };
  await ingestDocument(deps, { sourceId: 'vault', path: 'Plan.md' }, signal());
  // Simulate a concurrent publication between this job's read and its publish.
  const original = memory.store.documentState;
  let raced = false;
  const racing: typeof memory.store = {
    ...memory.store,
    documentState: async (source, path, s) => {
      const state = await original(source, path, s);
      if (!raced && state) {
        raced = true;
        await memory.store.publish(
          {
            sourceId: source,
            path,
            expectedRevisionId: state.currentRevisionId,
            revision: state.currentRevision + 1,
            kind: 'tombstone',
          },
          s,
        );
      }
      return state;
    },
  };
  files['Plan.md'] = `${note}\nmore`;
  const result = await ingestDocument(
    { ...deps, store: racing },
    { sourceId: 'vault', path: 'Plan.md' },
    signal(),
  );
  assert.equal(result.ok ? null : result.error.code, 'RETRYABLE', 'a lost publication is retried');
  assert.equal(memory.docs.get('Plan.md')?.deleted, true, 'the newer tombstone stands');
});

await test('an unknown or disabled source is a permanent failure that reads nothing', async () => {
  const memory = memoryStore();
  const result = await ingestDocument(
    { store: memory.store, readers: () => Promise.resolve(undefined), embed: embedder().embed },
    { sourceId: 'vault', path: 'a.md' },
    signal(),
  );
  assert.equal(result.ok ? null : result.error.code, 'PERMANENT');
  assert.equal(memory.published.length, 0);
});

await test('an embedding from another profile is refused and never stored', async () => {
  for (const wrong of [{ profileId: 'ep-ffffffffffffffffffffffff' }, { dimensions: 4 }]) {
    const memory = memoryStore([target]);
    await memory.store.publish(
      {
        sourceId: 's',
        path: 'a.md',
        expectedRevisionId: null,
        revision: 1,
        kind: 'content',
        title: '',
        tags: [],
        frontmatter: {},
        contentHash: sha256('a'),
        chunkerVersion: 'c',
        chunks: [
          {
            ordinal: 0,
            content: 'x',
            contentHash: sha256('x'),
            headingPath: [],
            tokenCount: 1,
            lineStart: 1,
            lineEnd: 1,
            headingLine: null,
            headingOccurrence: 1,
          },
        ],
        links: [],
      },
      signal(),
    );
    const outcome = await embedMissing(
      { store: memory.store, embed: embedder(wrong).embed },
      null,
      signal(),
    );
    assert.deepEqual(outcome, {
      ok: false,
      retryable: false,
      message: 'embedding identity does not match the version profile',
    });
    assert.equal(memory.vectors.size, 0, JSON.stringify(wrong));
  }
});

await test('resync plans adds, edits, renames and deletes only from a complete scan', async () => {
  const memory = memoryStore();
  const files: Record<string, string> = { 'a.md': 'alpha', 'b.md': 'beta', 'c.md': 'gamma' };
  const deps = {
    store: memory.store,
    readers: () => Promise.resolve(fakeReader(files)),
    embed: embedder().embed,
  };
  for (const path of Object.keys(files))
    await ingestDocument(deps, { sourceId: 'vault', path }, signal());

  files['a.md'] = 'alpha edited';
  files['d.md'] = 'brand new';
  files['moved/c.md'] = files['c.md'] ?? '';
  delete files['c.md'];
  delete files['b.md'];
  const result = await resyncSource(deps, { sourceId: 'vault', scanId: '1' }, signal());
  assert.deepEqual(result, { ok: true, value: { complete: true, events: 5 } });
  assert.deepEqual(
    memory.events.map((e) => [e.kind, e.path]).sort(),
    [
      ['changed', 'a.md'],
      ['changed', 'd.md'],
      ['changed', 'moved/c.md'],
      ['deleted', 'b.md'],
      ['deleted', 'c.md'],
    ].sort(),
  );
  assert.equal(memory.scans.at(-1)?.complete, true);

  // A failed listing records an incomplete scan and plans nothing (no mass delete).
  const broken = fakeReader(files);
  (broken as { list: () => Promise<string[]> }).list = () =>
    Promise.reject(new Error('mount gone'));
  const before = memory.events.length;
  const failed = await resyncSource(
    { ...deps, readers: () => Promise.resolve(broken) },
    { sourceId: 'vault', scanId: '2' },
    signal(),
  );
  assert.deepEqual(failed, { ok: true, value: { complete: false, events: 0 } });
  assert.equal(memory.events.length, before);
  assert.deepEqual(memory.scans.at(-1), {
    complete: false,
    seen: 0,
    indexed: 0,
    skipped: 0,
    errorCode: 'SCAN_INCOMPLETE',
  });
});

await test('only events up to the read watermark complete; a later event stays pending', async () => {
  const memory = memoryStore();
  const files: Record<string, string> = { 'a.md': 'one' };
  await memory.store.recordEvents(
    'src:vault',
    [{ kind: 'changed', path: 'a.md', observedHash: sha256('one') }],
    signal(),
  );
  const reader = fakeReader(files);
  const open = reader.open.bind(reader);
  // A newer edit is observed while the job reads the file, i.e. after its watermark.
  (reader as { open: typeof open }).open = async (path) => {
    await memory.store.recordEvents(
      'src:vault',
      [{ kind: 'changed', path: 'a.md', observedHash: sha256('two') }],
      signal(),
    );
    return open(path);
  };
  const readers = () => Promise.resolve(reader);
  await ingestDocument(
    { store: memory.store, readers, embed: embedder().embed },
    { sourceId: 'vault', path: 'a.md' },
    signal(),
  );
  assert.deepEqual(
    memory.events.map((e) => e.done),
    [true, false],
  );
});

await test('transient read failures never tombstone and leave the event open', async () => {
  for (const reason of ['timeout', 'unreadable', 'root_changed', 'outside_root'] as const) {
    const memory = memoryStore();
    const files: Record<string, string> = { 'a.md': 'alpha' };
    const refused: Record<string, OpenResult> = {};
    const deps = {
      store: memory.store,
      readers: () => Promise.resolve(fakeReader(files, refused)),
      embed: embedder().embed,
    };
    await ingestDocument(deps, { sourceId: 'vault', path: 'a.md' }, signal());
    await memory.store.recordEvents(
      'src:vault',
      [{ kind: 'changed', path: 'a.md', observedHash: sha256('alpha2') }],
      signal(),
    );
    refused['a.md'] = { ok: false, reason, relativePath: 'a.md' };
    const result = await ingestDocument(deps, { sourceId: 'vault', path: 'a.md' }, signal());
    assert.equal(result.ok ? null : result.error.code, 'RETRYABLE', reason);
    assert.equal(memory.docs.get('a.md')?.deleted, false, `${reason}: no tombstone`);
    assert.equal(memory.published.length, 1, `${reason}: nothing published`);
    assert.deepEqual(
      memory.events.map((e) => e.done),
      [false],
      `${reason}: event stays open`,
    );
  }
});

await test('a job holding newer bytes that loses the race to an older snapshot retries and wins', async () => {
  const memory = memoryStore();
  const files: Record<string, string> = { 'a.md': 'A' };
  const deps = {
    store: memory.store,
    readers: () => Promise.resolve(fakeReader(files)),
    embed: embedder().embed,
  };
  await ingestDocument(deps, { sourceId: 'vault', path: 'a.md' }, signal());
  await memory.store.recordEvents(
    'src:vault',
    [{ kind: 'changed', path: 'a.md', observedHash: sha256('C') }],
    signal(),
  );
  // This job reads C, but an older job holding B publishes first.
  files['a.md'] = 'C';
  const publish = memory.store.publish;
  let raced = false;
  const racing = {
    ...memory.store,
    publish: async (revision: NewRevision, s: AbortSignal) => {
      if (!raced) {
        raced = true;
        await publish(
          {
            ...revision,
            kind: 'content',
            contentHash: sha256('B'),
            chunks: [],
            links: [],
            title: '',
            tags: [],
            frontmatter: {},
            chunkerVersion: 'c',
          },
          s,
        );
      }
      return publish(revision, s);
    },
  };
  const lost = await ingestDocument(
    { ...deps, store: racing },
    { sourceId: 'vault', path: 'a.md' },
    signal(),
  );
  assert.equal(lost.ok ? null : lost.error.code, 'RETRYABLE');
  assert.equal(memory.docs.get('a.md')?.hash, sha256('B'));
  assert.deepEqual(
    memory.events.map((e) => e.done),
    [false],
    'the newer observation is not acknowledged',
  );
  const retried = await ingestDocument(deps, { sourceId: 'vault', path: 'a.md' }, signal());
  assert.deepEqual(retried, { ok: true, value: 'published' });
  assert.equal(memory.docs.get('a.md')?.hash, sha256('C'));
  assert.deepEqual(
    memory.events.map((e) => e.done),
    [true],
  );
});

await test('a large unchanged document reaches full coverage without another edit', async () => {
  const memory = memoryStore([target]);
  const big = Array.from(
    { length: 2_050 },
    (_, i) => `# S${i}
x
`,
  ).join('');
  const files: Record<string, string> = { 'big.md': big };
  const readers = () => Promise.resolve(fakeReader(files));
  const down = await ingestDocument(
    { store: memory.store, readers, embed: embedder({ fail: 'transient' }).embed },
    { sourceId: 'vault', path: 'big.md' },
    signal(),
  );
  assert.equal(down.ok ? null : down.error.code, 'RETRYABLE');
  const chunkCount =
    (memory.published[0]?.kind === 'content' && memory.published[0].chunks.length) || 0;
  assert.ok(chunkCount >= 2_050, String(chunkCount));
  const done = await ingestDocument(
    { store: memory.store, readers, embed: embedder().embed },
    { sourceId: 'vault', path: 'big.md' },
    signal(),
  );
  assert.deepEqual(done, { ok: true, value: 'unchanged' });
  assert.equal(memory.vectors.get('v1')?.size, chunkCount, 'every chunk embedded');
});

await test('a corpus-wide embedding run that hits its cap reports retryable, not success', async () => {
  const memory = memoryStore([target]);
  const chunks = Array.from({ length: 64 * 32 + 2 }, (_, i) => ({
    ordinal: i,
    content: `c${i}`,
    contentHash: sha256(`c${i}`),
    headingPath: [],
    tokenCount: 1,
    lineStart: i + 1,
    lineEnd: i + 1,
    headingLine: null,
    headingOccurrence: 1,
  }));
  await memory.store.publish(
    {
      sourceId: 's',
      path: 'x.md',
      expectedRevisionId: null,
      revision: 1,
      kind: 'content',
      title: '',
      tags: [],
      frontmatter: {},
      contentHash: sha256('x'),
      chunkerVersion: 'c',
      chunks,
      links: [],
    },
    signal(),
  );
  const outcome = await embedMissing(
    { store: memory.store, embed: embedder().embed },
    null,
    signal(),
  );
  assert.deepEqual(outcome, {
    ok: false,
    retryable: true,
    message: 'embedding cap reached; continuing later',
  });
});
