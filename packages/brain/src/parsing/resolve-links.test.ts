import assert from 'node:assert/strict';
import test from 'node:test';

import { parseNote, resolveNoteLinks, type LinkCandidate } from './index.ts';

const candidate = (
  id: string,
  path: string,
  aliases: readonly string[] = [],
  sourceId = 'vault',
): LinkCandidate => ({ id, path, aliases, sourceId });
const resolve = (text: string, candidates: readonly LinkCandidate[]) => {
  const parsed = parseNote({ sourceId: 'vault', path: 'Folder/Current.md', text });
  assert.ok(parsed.ok);
  return resolveNoteLinks(parsed.value, candidates);
};

await test('source-local path wins before filename and destination aliases', () => {
  const results = resolve('[[Target]] [[Unique]] [[Nickname]]', [
    candidate('local', 'Folder/Target.md'),
    candidate('root', 'Target.md'),
    candidate('unique', 'Elsewhere/Unique.md'),
    candidate('alias', 'Different.md', ['Nickname']),
  ]);
  assert.deepEqual(
    results.map((result) => [result.status, result.documentId, result.via]),
    [
      ['resolved', 'local', 'path'],
      ['resolved', 'unique', 'filename'],
      ['resolved', 'alias', 'alias'],
    ],
  );
});

await test('self-heading links and safe relative paths resolve in the current source', () => {
  const results = resolve('[[#Part]] [[../Target#Heading]]', [
    candidate('self', 'Folder/Current.md'),
    candidate('target', 'Target.md'),
  ]);
  assert.deepEqual(
    results.map((result) => result.documentId),
    ['self', 'target'],
  );
});

await test('duplicate filenames and aliases remain explicitly ambiguous', () => {
  const results = resolve('[[Same]] [[Nickname]]', [
    candidate('a', 'One/Same.md', ['Nickname']),
    candidate('b', 'Two/Same.md', ['Nickname']),
  ]);
  assert.deepEqual(
    results.map((result) => result.status),
    ['ambiguous', 'ambiguous'],
  );
  assert.ok(results.every((result) => result.documentId === undefined));
});

await test('other sources, escaping/absolute/external targets and explicit-path misses do not fallback', () => {
  const results = resolve(
    '[[Foreign]] [[../../Secret]] [[/Secret]] [[https://example.invalid/Secret]] [[Missing/Target]]',
    [
      candidate('foreign', 'Foreign.md', [], 'another'),
      candidate('secret', 'Secret.md'),
      candidate('target', 'Elsewhere/Target.md'),
    ],
  );
  assert.deepEqual(
    results.map((result) => result.status),
    Array.from({ length: 5 }, () => 'unresolved'),
  );
});

await test('display aliases never choose the destination; attachment candidates are not opened', () => {
  const results = resolve('[[Missing|Nickname]] ![[Image.png]]', [
    candidate('alias', 'Other.md', ['Nickname']),
    candidate('image', 'Folder/Image.png'),
  ]);
  assert.equal(results[0]?.status, 'unresolved');
  assert.equal(results[1]?.documentId, 'image');
  assert.equal(results[1]?.link.kind, 'import');
});

await test('case/Unicode filesystem identity is preserved and duplicate path candidates are ambiguous', () => {
  const results = resolve('[[Case]] [[café]] [[Exact]]', [
    candidate('lower', 'case.md'),
    candidate('nfd', 'cafe\u0301.md'),
    candidate('one', 'Folder/Exact.md'),
    candidate('two', 'Folder/Exact.md'),
  ]);
  assert.deepEqual(
    results.map((result) => result.status),
    ['unresolved', 'unresolved', 'ambiguous'],
  );
});

await test('explicit note paths may contain dots without being mistaken for attachment extensions', () => {
  const results = resolve('[[Other/2026.10.18]]', [
    candidate('dated', 'Folder/Other/2026.10.18.md'),
  ]);
  assert.equal(results[0]?.documentId, 'dated');
});
