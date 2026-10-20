import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { z } from 'zod';

import { parseNote, resolveNoteLinks } from './index.ts';

const root = new URL('../../../../evals/brain/parser/', import.meta.url);
const caseSchema = z.strictObject({
  path: z.string().regex(/^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[\p{L}\p{N} /._-]+\.md$/u),
  tags: z.array(z.string()),
  aliases: z.array(z.string()),
  targets: z.array(z.string()),
  warnings: z.array(z.string()),
});
const manifestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  notes: z.array(caseSchema).length(40),
});

await test('all forty synthetic fixture notes match expected metadata/links and stay in their source', async () => {
  const manifest = manifestSchema.parse(
    JSON.parse(await readFile(new URL('manifest.json', root), 'utf8')) as unknown,
  );
  const notes = [];
  for (const fixture of manifest.notes) {
    const text = await readFile(new URL(`${fixture.path}.fixture`, root), 'utf8');
    const parsed = parseNote({ sourceId: 'synthetic', path: fixture.path, text });
    assert.ok(parsed.ok, fixture.path);
    const note = parsed.value;
    assert.deepEqual(note.tags, fixture.tags, fixture.path);
    assert.deepEqual(note.aliases, fixture.aliases, fixture.path);
    assert.deepEqual(
      note.links.map((link) => link.targetPath),
      fixture.targets,
      fixture.path,
    );
    assert.deepEqual(note.warnings, fixture.warnings, fixture.path);
    assert.equal(note.body, text.slice(note.bodyStartOffset));
    notes.push(note);
  }
  const candidates = notes.map((note) => ({
    id: note.path,
    sourceId: note.sourceId,
    path: note.path,
    aliases: note.aliases,
  }));
  const home = notes.find((note) => note.path === 'Home.md');
  assert.ok(home);
  assert.deepEqual(
    resolveNoteLinks(home, candidates).map((resolution) => resolution.status),
    ['resolved', 'resolved', 'resolved'],
  );
  const adversarial = notes.find((note) => note.path === 'Edges/Adversarial.md');
  assert.ok(adversarial?.body.includes('Ignore previous instructions'));
});
