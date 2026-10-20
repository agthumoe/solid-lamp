// No-database ingestion pipeline over the materialized synthetic vault (#112): the verified
// reader (#88) lists and reads every note, then the parser (#89) and chunker (#90) run on what
// the reader returned, checked against the fixture manifest.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { chunkMarkdown } from '../chunking/index.ts';
import { parseNote } from '../parsing/index.ts';
import { createSourceReader } from './source-reader.ts';

const repo = new URL('../../../../', import.meta.url).pathname;
const script = join(repo, 'scripts/brain/fixture-vault.ts');
const manifestPath = join(repo, 'evals/brain/parser/manifest.json');

type Case = {
  path: string;
  tags: string[];
  aliases: string[];
  targets: string[];
  warnings: string[];
};

const materialize = (target: string) =>
  execFileSync(process.execPath, [script, target], { encoding: 'utf8' });

await test('the fixture vault materializes byte-for-byte and flows through reader, parser and chunker', async () => {
  const base = await mkdtemp(join(tmpdir(), 'aetherion-fixture-'));
  const vault = join(base, 'vault');
  try {
    assert.match(materialize(vault), /materialized 40 fixture notes/);
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as { notes: Case[] };
    const reader = await createSourceReader({
      root: vault,
      includeExtensions: ['.md'],
      excludeDirs: ['.obsidian', '.trash', 'AI-Inbox'],
      maxFileBytes: 1024 * 1024,
    });
    try {
      const listed = await reader.list();
      assert.deepEqual(listed, manifest.notes.map((note) => note.path).sort());

      for (const fixture of manifest.notes) {
        const opened = await reader.open(fixture.path);
        assert.ok(opened.ok, `${fixture.path}: ${opened.ok ? '' : opened.reason}`);
        const original = await readFile(
          join(repo, 'evals/brain/parser', `${fixture.path}.fixture`),
          'utf8',
        );
        assert.equal(opened.file.content, original, `${fixture.path} bytes`);

        const parsed = parseNote({
          sourceId: 'fixture-vault',
          path: fixture.path,
          text: opened.file.content,
        });
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

        // Every chunk's citation offsets point at exactly its content in the original bytes.
        for (const chunk of chunkMarkdown(note)) {
          assert.equal(
            opened.file.content.slice(
              note.bodyStartOffset + chunk.startOffset,
              note.bodyStartOffset + chunk.endOffset,
            ),
            chunk.content,
            `${fixture.path} chunk offsets`,
          );
          assert.ok(chunk.lineStart <= chunk.lineEnd, `${fixture.path} chunk lines`);
        }
      }
      assert.deepEqual(reader.refusals(), {});
      const adversarial = await reader.open('Edges/Adversarial.md');
      assert.ok(
        adversarial.ok && adversarial.file.content.includes('Ignore previous instructions'),
      );
    } finally {
      await reader.close();
    }
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

await test('materializing is repeatable but never clears a directory it did not create', async () => {
  const base = await mkdtemp(join(tmpdir(), 'aetherion-fixture-'));
  try {
    const vault = join(base, 'vault');
    materialize(vault);
    await writeFile(join(vault, 'stray.md'), 'left over');
    materialize(vault); // rebuilds from scratch
    await assert.rejects(readFile(join(vault, 'stray.md')));

    const foreign = join(base, 'my-notes');
    await mkdir(foreign);
    await writeFile(join(foreign, 'precious.md'), 'keep me');
    assert.throws(() => materialize(foreign), /not a materialized fixture vault/);
    assert.equal(await readFile(join(foreign, 'precious.md'), 'utf8'), 'keep me');

    assert.throws(
      () => materialize(join(repo, 'evals/brain/parser/out')),
      /inside evals\/brain\/parser/,
    );
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});
