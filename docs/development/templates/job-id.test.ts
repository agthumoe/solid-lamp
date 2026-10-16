// Template: tests for deterministic job IDs.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { deterministicJobId, ingestDocumentJobId, normalizeDocumentPath } from './job-id.ts';

const HASH = 'a'.repeat(64);
const doc = { sourceId: 'vault', path: 'Projects/aetherion.md', contentHash: HASH };

void describe('ingestDocumentJobId', () => {
  void it('produces an ID BullMQ accepts: no colon and not an integer', () => {
    const id = ingestDocumentJobId(doc);

    assert.equal(id.includes(':'), false);
    assert.equal(/^\d+$/.test(id), false);
    assert.match(id, /^ingest-document-[0-9a-f]{64}$/);
  });

  void it('gives distinct documents with identical contents distinct IDs', () => {
    const other = { ...doc, path: 'Archive/aetherion-copy.md' };

    assert.notEqual(ingestDocumentJobId(doc), ingestDocumentJobId(other));
  });

  void it('is stable for spellings that always name the same file', () => {
    const variants = [
      './Projects/aetherion.md',
      'Projects//aetherion.md',
      'Projects/./aetherion.md',
    ];

    for (const path of variants) {
      assert.equal(ingestDocumentJobId({ ...doc, path }), ingestDocumentJobId(doc));
    }
  });

  void it('changes when the content changes or the source differs', () => {
    assert.notEqual(
      ingestDocumentJobId({ ...doc, contentHash: 'b'.repeat(64) }),
      ingestDocumentJobId(doc),
    );
    assert.notEqual(ingestDocumentJobId({ ...doc, sourceId: 'repos' }), ingestDocumentJobId(doc));
  });

  void it('does not let field boundaries collide', () => {
    assert.notEqual(deterministicJobId('k', ['a-b', 'c']), deterministicJobId('k', ['a', 'b-c']));
  });

  void it('rejects a job kind containing a colon', () => {
    assert.throws(() => deterministicJobId('ingest:document', []), /invalid job kind/);
  });

  void it('keeps distinct Linux files distinct: Unicode form, case and backslash', () => {
    const nfc = { ...doc, path: 'Caf\u00e9.md' };
    const nfd = { ...doc, path: 'Cafe\u0301.md' };

    assert.notEqual(ingestDocumentJobId(nfc), ingestDocumentJobId(nfd));
    assert.notEqual(normalizeDocumentPath('Notes/A.md'), normalizeDocumentPath('notes/a.md'));
    assert.notEqual(normalizeDocumentPath('a\\b.md'), normalizeDocumentPath('a/b.md'));
  });

  void it('rejects absolute, parent-relative and empty paths', () => {
    assert.throws(() => normalizeDocumentPath('/etc/passwd'), /source-relative/);
    assert.throws(() => normalizeDocumentPath('Projects/../secret.md'), /'\.\.'/);
    assert.throws(() => normalizeDocumentPath('./'), /empty/);
  });
});
