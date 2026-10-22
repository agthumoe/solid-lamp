import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { freezeGates } from '@aetherion/brain';
import { appError, err, ok } from '@aetherion/shared';
import { brainNoteQuerySchema, brainSearchQuerySchema } from '@aetherion/shared/contracts';

import { getNote } from './get-note.ts';
import type { BrainStore, Candidate, ChunkDetail, PinnedVersion, QueryEmbedder } from './ports.ts';
import { searchBrain } from './search-brain.ts';

const HASH = 'a'.repeat(64);
const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');
const signal = () => AbortSignal.timeout(1_000);

const version = (overrides: Partial<PinnedVersion> = {}): PinnedVersion => ({
  versionId: '7',
  profileId: 'ep-0123456789abcdef01234567',
  profileDigest: 'd'.repeat(64),
  dimensions: 3,
  chunkerVersion: 'c1',
  promotedAt: new Date('2026-10-21T00:00:00Z'),
  gates: freezeGates({ id: 'v7.gates', minCosine: 0.6, minLexical: 0.1, calibration: null }),
  ...overrides,
});

const detail = (chunkId: string, overrides: Partial<ChunkDetail> = {}): ChunkDetail => ({
  chunkId,
  documentId: '11',
  sourceName: 'vault',
  path: 'Projects/Plan.md',
  title: 'Plan',
  revision: 2,
  revisionHash: HASH,
  headingPath: ['Goals'],
  headingOccurrence: 1,
  lineStart: 3,
  lineEnd: 5,
  content: `chunk ${chunkId} text`,
  ...overrides,
});

const candidate = (chunkId: string, cosine: number | null, lexical: number | null): Candidate => ({
  chunkId,
  vectorRank: cosine === null ? null : 1,
  lexicalRank: lexical === null ? null : 1,
  cosine,
  lexical,
  fused: 0.03,
});

const fakeStore = (options: {
  pinned?: PinnedVersion | null;
  candidates?: Candidate[];
  details?: ChunkDetail[];
  complete?: boolean;
  sources?: Record<string, string>;
}) => {
  const calls: { searches: Parameters<BrainStore['searchCandidates']>[0][] } = { searches: [] };
  const store: BrainStore = {
    pinActiveVersion: () =>
      Promise.resolve(options.pinned === undefined ? version() : options.pinned),
    sourceIdsByName: (names) =>
      Promise.resolve(
        names.flatMap((name) => (options.sources?.[name] ? [options.sources[name]] : [])),
      ),
    searchCandidates: (input) => {
      calls.searches.push(input);
      // Honour the bound like the SQL function does.
      return Promise.resolve((options.candidates ?? []).slice(0, input.resultLimit));
    },
    chunkDetails: (ids) =>
      Promise.resolve((options.details ?? []).filter((d) => ids.includes(d.chunkId))),
    corpusComplete: () => Promise.resolve(options.complete ?? true),
    noteState: () => Promise.resolve(null),
    stats: () => Promise.reject(new Error('unused')),
  };
  return { store, calls };
};

const embedder = (identity: Partial<Parameters<typeof ok>[0]> = {}) => {
  const seen: string[] = [];
  const embed: QueryEmbedder = (query, profileId) => {
    seen.push(profileId);
    return Promise.resolve(
      ok({
        vector: [0.1, 0.2, 0.3],
        profileId,
        digest: 'd'.repeat(64),
        dimensions: 3,
        ...identity,
      }),
    );
  };
  return { embed, seen };
};

const query = (input: Record<string, unknown> = {}) =>
  brainSearchQuerySchema.parse({ q: 'plan', ...input });

await test('no active version is not_indexed, without embedding', async () => {
  const { embed, seen } = embedder();
  const result = await searchBrain(
    { store: fakeStore({ pinned: null }).store, embed },
    query(),
    signal(),
  );
  assert.ok(result.ok);
  assert.equal(result.value.status, 'not_indexed');
  assert.equal(result.value.versionId, null);
  assert.deepEqual(seen, []);
});

await test('an uncalibrated version fails closed instead of returning ungated results', async () => {
  const { embed } = embedder();
  const result = await searchBrain(
    { store: fakeStore({ pinned: version({ gates: null }) }).store, embed },
    query(),
    signal(),
  );
  assert.equal(result.ok ? null : result.error.code, 'UNAVAILABLE');
});

await test('the query is embedded with the pinned profile and a mismatched identity is refused', async () => {
  const { store, calls } = fakeStore({});
  const good = embedder();
  assert.ok((await searchBrain({ store, embed: good.embed }, query(), signal())).ok);
  assert.deepEqual(good.seen, ['ep-0123456789abcdef01234567']);

  for (const wrong of [
    { profileId: 'ep-ffffffffffffffffffffffff' },
    { digest: 'e'.repeat(64) }, // same dimensions, different artifact
    { dimensions: 4 },
    { vector: [0.1, 0.2] },
  ]) {
    const result = await searchBrain({ store, embed: embedder(wrong).embed }, query(), signal());
    assert.equal(result.ok ? null : result.error.code, 'UNAVAILABLE', JSON.stringify(wrong));
  }
  const down: QueryEmbedder = () => Promise.resolve(err(appError('UNAVAILABLE', 'down')));
  const failed = await searchBrain({ store, embed: down }, query(), signal());
  assert.equal(failed.ok ? null : failed.error.code, 'UNAVAILABLE');
  assert.equal(calls.searches.length, 1, 'refused queries never search');
});

await test('lexical mode never embeds, is labelled, and uses only the lexical gate', async () => {
  const { store, calls } = fakeStore({
    candidates: [candidate('1', 0.95, null), candidate('2', null, 0.2)],
    details: [detail('1'), detail('2')],
  });
  const down: QueryEmbedder = () => Promise.reject(new Error('must not embed'));
  const result = await searchBrain({ store, embed: down }, query({ mode: 'lexical' }), signal());
  assert.ok(result.ok);
  assert.equal(result.value.mode, 'lexical_only');
  assert.deepEqual(
    result.value.results.map((r) => r.chunkId),
    ['2'],
  );
  assert.equal(calls.searches[0]?.queryVector, null);
});

await test('gates decide what is returned; nothing passing is no_match', async () => {
  const unrelated = fakeStore({ candidates: [candidate('1', 0.41, null)], details: [detail('1')] });
  const none = await searchBrain(
    { store: unrelated.store, embed: embedder().embed },
    query(),
    signal(),
  );
  assert.ok(none.ok);
  assert.equal(none.value.status, 'no_match');
  assert.deepEqual(none.value.results, []);

  const related = fakeStore({
    candidates: [candidate('1', 0.7, null), candidate('2', 0.4, 0.05), candidate('3', null, 0.3)],
    details: [
      detail('1'),
      detail('2'),
      detail('3', { headingPath: ['Goals'], headingOccurrence: 2 }),
    ],
    complete: false,
  });
  const result = await searchBrain(
    { store: related.store, embed: embedder().embed },
    query(),
    signal(),
  );
  assert.ok(result.ok);
  assert.equal(result.value.status, 'ok');
  assert.equal(result.value.corpus, 'incomplete');
  assert.deepEqual(
    result.value.results.map((r) => r.chunkId),
    ['1', '3'],
  );
  assert.equal(result.value.results[1]?.citation.display, 'vault:Projects/Plan.md#Goals~2@L3-5');
  assert.equal(result.value.results[0]?.citation.versionId, '7');
});

await test('filters reach the store; an unknown source matches nothing; uncitable chunks are dropped', async () => {
  const { store, calls } = fakeStore({
    sources: { vault: '42' },
    candidates: [candidate('1', 0.9, null), candidate('2', 0.8, null)],
    details: [
      detail('1', { lineStart: null, lineEnd: null }),
      detail('2', { content: 'x'.repeat(5_000) }),
    ],
  });
  const result = await searchBrain(
    { store, embed: embedder().embed },
    query({ source: 'vault', tag: ['a', 'b'], tagMode: 'all', pathPrefix: 'Projects', limit: '5' }),
    signal(),
  );
  assert.ok(result.ok);
  assert.deepEqual(calls.searches[0]?.filters, {
    sourceIds: ['42'],
    tags: ['a', 'b'],
    tagsAll: true,
    pathPrefix: 'Projects',
  });
  assert.equal(calls.searches[0]?.resultLimit, 50, 'a fixed pool; the limit applies after gating');
  assert.deepEqual(
    result.value.results.map((r) => r.chunkId),
    ['2'],
    'a chunk without lines is not cited',
  );
  assert.equal(result.value.results[0]?.snippet.length, 1_200);

  const unknown = await searchBrain(
    { store, embed: embedder().embed },
    query({ source: 'nope' }),
    signal(),
  );
  assert.ok(unknown.ok);
  assert.equal(unknown.value.status, 'no_match');
  assert.equal(calls.searches.length, 1, 'an unknown source never searches every source');
});

const noteQuery = (overrides: Record<string, unknown> = {}) =>
  brainNoteQuerySchema.parse({
    sourceId: 'vault',
    documentId: '11',
    chunkId: '1',
    versionId: '7',
    revision: '2',
    contentHash: HASH,
    pathSha256: sha256('Projects/Plan.md'),
    ...overrides,
  });

const noteStore = (state: Awaited<ReturnType<BrainStore['noteState']>>): BrainStore => ({
  ...fakeStore({}).store,
  noteState: () => Promise.resolve(state),
});

const current = {
  detail: detail('1', { content: 'é'.repeat(10) + '🍎' }),
  deleted: false,
  currentRevision: 2,
  currentRevisionHash: HASH,
  currentPath: 'Projects/Plan.md',
};

await test('note returns a bounded excerpt only for the exact identity', async () => {
  const result = await getNote(noteStore(current), noteQuery({ maxChars: '11' }), signal());
  assert.ok(result.ok && result.value.status === 'ok');
  assert.equal(result.value.excerpt, 'é'.repeat(10), 'never splits a surrogate pair');
  assert.equal(result.value.truncated, true);
  assert.equal(result.value.citation.display, 'vault:Projects/Plan.md#Goals@L3-5');
});

await test('note reports stale reasons with no text, and one NOT_FOUND for unknown or forged', async () => {
  const cases: [Partial<typeof current>, string][] = [
    [{ deleted: true }, 'deleted'],
    [{ currentRevision: 3 }, 'revision'],
    [{ currentRevisionHash: 'b'.repeat(64) }, 'content'],
    [{ currentPath: 'Archive/Plan.md' }, 'path'],
  ];
  for (const [patch, reason] of cases) {
    const result = await getNote(noteStore({ ...current, ...patch }), noteQuery(), signal());
    assert.deepEqual(result, { ok: true, value: { status: 'stale', reason } }, reason);
  }
  for (const [state, q] of [
    [null, noteQuery()],
    [current, noteQuery({ revision: '1' })], // forged revision number
    [current, noteQuery({ contentHash: 'c'.repeat(64) })],
  ] as const) {
    const result = await getNote(noteStore(state), q, signal());
    assert.equal(result.ok ? null : result.error.code, 'NOT_FOUND');
  }
});

await test('the requested limit applies after gating: a rejected top candidate hides nothing', async () => {
  // A ranks first by fusion but fails the gates; B ranks second and passes.
  const { store } = fakeStore({
    candidates: [
      { chunkId: 'A', vectorRank: 2, lexicalRank: 1, cosine: 0.2, lexical: 0.01, fused: 0.033 },
      { chunkId: 'B', vectorRank: 1, lexicalRank: null, cosine: 0.8, lexical: null, fused: 0.016 },
    ],
    details: [detail('A'), detail('B')],
  });
  for (const limit of ['1', '2']) {
    const result = await searchBrain(
      { store, embed: embedder().embed },
      query({ limit }),
      signal(),
    );
    assert.ok(result.ok);
    assert.deepEqual(
      result.value.results.map((r) => r.chunkId),
      ['B'],
      `limit ${limit}`,
    );
  }
});
