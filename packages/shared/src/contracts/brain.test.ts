import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import {
  brainNoteQuerySchema,
  brainNoteResponseSchema,
  brainSearchQuerySchema,
  brainSearchResponseSchema,
  brainStatsResponseSchema,
  type BrainCitation,
  type BrainSearchResult,
} from './index.ts';

const HASH = 'c'.repeat(64);

const citation: BrainCitation = {
  display: 'vault:Projects/Plan.md#Goals@L3-7',
  sourceId: 'vault',
  documentId: 'doc-1',
  revision: 2,
  contentHash: HASH,
  chunkId: 'chunk-1',
  versionId: 'v-1',
  path: 'Projects/Plan.md',
  headingPath: ['Goals'],
  headingOccurrence: 1,
  lineStart: 3,
  lineEnd: 7,
};

const result: BrainSearchResult = {
  chunkId: 'chunk-1',
  documentPath: 'Projects/Plan.md',
  title: 'Plan',
  headingPath: ['Goals'],
  lineStart: 3,
  lineEnd: 7,
  snippet: 'Ship the brain.',
  fusedScore: 0.032,
  vectorRank: 1,
  lexicalRank: null,
  cosineSimilarity: 0.71,
  lexicalScore: null,
  citation,
};

await test('search query: defaults, querystring coercion and repeated keys', () => {
  assert.deepEqual(brainSearchQuerySchema.parse({ q: '  roadmap  ' }), {
    q: 'roadmap',
    limit: 8,
    source: [],
    tag: [],
    tagMode: 'any',
    mode: 'hybrid',
  });
  const parsed = brainSearchQuerySchema.parse({
    q: 'x',
    limit: '20',
    source: 'vault',
    tag: ['work', 'Projects/Q4'],
    tagMode: 'all',
    pathPrefix: 'Projects',
    mode: 'lexical',
  });
  assert.equal(parsed.limit, 20);
  assert.deepEqual(parsed.source, ['vault']);
  assert.deepEqual(parsed.tag, ['work', 'Projects/Q4']);
});

await test('search query: every bound and unknown key is rejected', () => {
  const rejected: Record<string, unknown>[] = [
    {},
    { q: '   ' },
    { q: 'x'.repeat(1_001) },
    { q: 'x', limit: '0' },
    { q: 'x', limit: '51' },
    { q: 'x', limit: '2.5' },
    { q: 'x', limit: 'many' },
    { q: 'x', source: Array.from({ length: 9 }, (_, i) => `s${i}`) },
    { q: 'x', source: 'has space' },
    { q: 'x', tag: Array.from({ length: 17 }, (_, i) => `t${i}`) },
    { q: 'x', tag: 'a b' },
    { q: 'x', tagMode: 'none' },
    { q: 'x', pathPrefix: '../etc' },
    { q: 'x', pathPrefix: '/abs' },
    { q: 'x', pathPrefix: 'a//b' },
    { q: 'x', pathPrefix: 'a\\b' },
    { q: 'x', mode: 'vector' },
    { q: 'x', versionId: 'v-1' }, // callers never choose the version
  ];
  for (const query of rejected)
    assert.equal(brainSearchQuerySchema.safeParse(query).success, false, JSON.stringify(query));
});

await test('search response: statuses carry the right shapes', () => {
  const base = { corpus: 'complete', mode: 'hybrid', tookMs: 12 } as const;
  assert.ok(
    brainSearchResponseSchema.safeParse({
      status: 'ok',
      versionId: 'v-1',
      results: [result],
      ...base,
    }).success,
  );
  assert.ok(
    brainSearchResponseSchema.safeParse({
      status: 'no_match',
      versionId: 'v-1',
      results: [],
      ...base,
    }).success,
  );
  assert.ok(
    brainSearchResponseSchema.safeParse({
      status: 'not_indexed',
      versionId: null,
      results: [],
      ...base,
      corpus: 'incomplete',
    }).success,
  );
  const rejected: Record<string, unknown>[] = [
    { status: 'ok', versionId: 'v-1', results: [], ...base }, // ok needs results
    { status: 'no_match', versionId: 'v-1', results: [result], ...base },
    { status: 'not_indexed', versionId: 'v-1', results: [], ...base },
    { status: 'unavailable', versionId: null, results: [], ...base }, // a 503 envelope instead
    { status: 'ok', versionId: 'v-1', results: [result], ...base, mode: 'lexical' },
    { status: 'ok', versionId: 'v-1', results: Array.from({ length: 51 }, () => result), ...base },
    {
      status: 'ok',
      versionId: 'v-1',
      results: [{ ...result, snippet: 's'.repeat(1_201) }],
      ...base,
    },
    { status: 'ok', versionId: 'v-1', results: [{ ...result, lineStart: 9 }], ...base },
    { status: 'ok', versionId: 'v-1', results: [{ ...result, cosineSimilarity: 1.5 }], ...base },
    { status: 'ok', versionId: 'v-1', results: [{ ...result, vectorRank: 0 }], ...base },
    { status: 'ok', versionId: 'v-1', results: [{ ...result, extra: 1 }], ...base },
    {
      status: 'ok',
      versionId: 'v-1',
      results: [{ ...result, citation: { ...citation, path: '../x.md' } }],
      ...base,
    },
  ];
  for (const response of rejected)
    assert.equal(
      brainSearchResponseSchema.safeParse(response).success,
      false,
      JSON.stringify(response).slice(0, 120),
    );
});

await test('note: citation identity in, bounded excerpt or stale out', () => {
  const query = brainNoteQuerySchema.parse({
    sourceId: 'vault',
    documentId: 'doc-1',
    chunkId: 'chunk-1',
    versionId: 'v-1',
    revision: '2',
    contentHash: HASH,
    pathSha256: 'd'.repeat(64),
  });
  assert.equal(query.revision, 2);
  assert.equal(query.maxChars, 2_000);
  for (const bad of [
    { ...query, maxChars: '8001' },
    { ...query, revision: '-1' },
    { ...query, contentHash: 'C'.repeat(64) },
    { ...query, pathSha256: 'not-a-hash' },
    { ...query, path: 'Projects/Plan.md' }, // the path itself is never sent
    { ...query, lineStart: 1 },
  ])
    assert.equal(brainNoteQuerySchema.safeParse(bad).success, false, JSON.stringify(bad));

  assert.ok(
    brainNoteResponseSchema.safeParse({ status: 'ok', citation, excerpt: 'text', truncated: false })
      .success,
  );
  assert.ok(brainNoteResponseSchema.safeParse({ status: 'stale', reason: 'revision' }).success);
  for (const bad of [
    { status: 'ok', citation, excerpt: 'x'.repeat(8_001), truncated: true },
    { status: 'stale', reason: 'revision', excerpt: 'newer text' }, // stale never carries text
    { status: 'stale', reason: 'moved' },
    { status: 'not_found' },
  ])
    assert.equal(
      brainNoteResponseSchema.safeParse(bad).success,
      false,
      JSON.stringify(bad).slice(0, 80),
    );
});

await test('stats: an empty brain and an indexed one', () => {
  assert.ok(
    brainStatsResponseSchema.safeParse({
      activeVersion: null,
      documents: 0,
      chunks: 0,
      embeddedChunks: 0,
      corpus: 'empty',
      sources: [],
    }).success,
  );
  const indexed = {
    activeVersion: {
      id: 'v-1',
      embedRole: 'embed',
      dimensions: 1024,
      chunkerVersion: 'heading-v1',
      promotedAt: '2026-10-20T12:00:00Z',
    },
    documents: 40,
    chunks: 120,
    embeddedChunks: 120,
    corpus: 'complete',
    sources: [
      { id: 'vault', documents: 40, lastIngestAt: '2026-10-20T12:00:00Z', lastScan: 'complete' },
    ],
  };
  assert.ok(brainStatsResponseSchema.safeParse(indexed).success);
  for (const bad of [
    { ...indexed, activeVersion: { ...indexed.activeVersion, embedRole: 'qwen3-embedding:8b' } },
    { ...indexed, activeVersion: { ...indexed.activeVersion, promotedAt: '2026-10-20 12:00' } },
    { ...indexed, chunks: -1 },
    { ...indexed, model: 'x' },
  ])
    assert.equal(
      brainStatsResponseSchema.safeParse(bad).success,
      false,
      JSON.stringify(bad).slice(0, 80),
    );
});

await test('the package exports this entry as @aetherion/shared/contracts', () => {
  const manifest = JSON.parse(
    readFileSync(join(import.meta.dirname, '../../package.json'), 'utf8'),
  ) as { exports: Record<string, string> };
  assert.equal(manifest.exports['./contracts'], './src/contracts/index.ts');
});

await test('the contracts entry is browser-safe: zod and relative imports only', () => {
  const dir = import.meta.dirname;
  for (const file of readdirSync(dir).filter(
    (name) => name.endsWith('.ts') && !name.endsWith('.test.ts'),
  )) {
    const source = readFileSync(join(dir, file), 'utf8');
    const specifiers = [...source.matchAll(/(?:from|import)\s*\(?\s*'([^']+)'/g)].map((m) => m[1]);
    for (const specifier of specifiers)
      assert.ok(specifier === 'zod' || specifier?.startsWith('./'), `${file} imports ${specifier}`);
  }
});
