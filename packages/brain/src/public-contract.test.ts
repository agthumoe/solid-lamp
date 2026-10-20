import assert from 'node:assert/strict';
import test from 'node:test';

import { chunkMarkdown, parseNote, resolveNoteLinks } from '@aetherion/brain';

await test('public parser/chunker contract preserves original citation lines across frontmatter and CRLF', () => {
  const text = '---\r\naliases: [Example]\r\n---\r\n# Topic\r\nA [[Target#Section|label]].\r\n';
  const parsed = parseNote({ sourceId: 'synthetic', path: 'Folder/Note.md', text });
  assert.ok(parsed.ok);
  const note = parsed.value;
  const chunks = chunkMarkdown(note);
  assert.equal(note.bodyStartLine, 4);
  assert.equal(chunks.length, 1);
  const chunk = chunks[0];
  assert.ok(chunk);
  assert.equal(chunk.lineStart, 4);
  assert.equal(chunk.lineEnd, 5);
  assert.equal(chunk.headingLine, 4);
  assert.deepEqual(chunk.headingPath, ['Topic']);
  assert.equal(
    text.slice(note.bodyStartOffset + chunk.startOffset, note.bodyStartOffset + chunk.endOffset),
    chunk.content,
  );
  const resolved = resolveNoteLinks(note, [
    { id: 'target', sourceId: 'synthetic', path: 'Folder/Target.md', aliases: [] },
    { id: 'other-source', sourceId: 'other', path: 'Folder/Target.md', aliases: [] },
  ]);
  assert.equal(resolved[0]?.documentId, 'target');
  assert.equal(resolved[0]?.link.heading, 'Section');
  assert.equal(resolved[0]?.link.line, 5);
});
