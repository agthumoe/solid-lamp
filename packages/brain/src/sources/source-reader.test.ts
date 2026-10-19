import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { promises as fsPromises } from 'node:fs';
import { link, mkdir, mkdtemp, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { mock } from 'node:test';

import {
  createSourceReader,
  isSafeRelativePath,
  isWithin,
  UnsupportedSourceError,
  type SourceReaderOptions,
} from './source-reader.ts';

const SECRET = 'OUTSIDE-SECRET';

// base/vault (the root), base/vault-evil and base/outside (must never be read).
const fixture = async () => {
  const base = await mkdtemp(join(tmpdir(), 'aetherion-source-'));
  const root = join(base, 'vault');
  await mkdir(join(root, 'notes'), { recursive: true });
  await mkdir(join(root, '.obsidian'), { recursive: true });
  await mkdir(join(base, 'outside'), { recursive: true });
  await mkdir(join(base, 'vault-evil'), { recursive: true });
  await writeFile(join(root, 'notes', 'a.md'), '# A\nhello\n');
  await writeFile(join(root, 'top.md'), 'top\n');
  await writeFile(join(root, '.obsidian', 'config.md'), 'settings\n');
  await writeFile(join(root, 'image.png'), 'png');
  await writeFile(join(base, 'outside', 'a.md'), SECRET);
  await writeFile(join(base, 'vault-evil', 'x.md'), SECRET);
  const reader = (extra: Partial<SourceReaderOptions> = {}) =>
    createSourceReader({
      root,
      includeExtensions: ['.md'],
      excludeDirs: ['.obsidian', '.trash', 'AI-Inbox'],
      maxFileBytes: 1024,
      ...extra,
    });
  return { base, root, reader, cleanup: () => rm(base, { recursive: true, force: true }) };
};

await test('path shape: only safe root-relative POSIX paths', () => {
  for (const ok of ['a.md', 'notes/a.md', 'a b/c.d.md'])
    assert.equal(isSafeRelativePath(ok), true, ok);
  for (const bad of [
    '',
    '/etc/passwd',
    '../x.md',
    'a/../../x.md',
    'a/./b.md',
    'a//b.md',
    'a\\b.md',
    'a\0.md',
  ])
    assert.equal(isSafeRelativePath(bad), false, JSON.stringify(bad));
});

await test('containment compares whole segments (sibling-prefix confusion)', () => {
  assert.equal(isWithin('/data/vault', '/data/vault/a.md'), true);
  assert.equal(isWithin('/data/vault', '/data/vault-evil/x.md'), false);
  assert.equal(isWithin('/data/vault', '/data/vaultx'), false);
});

await test('a normal note is read with its identity', async () => {
  const { reader, cleanup } = await fixture();
  try {
    const result = await (await reader()).open('notes/a.md');

    assert.ok(result.ok);
    assert.equal(result.file.content, '# A\nhello\n');
    assert.equal(result.file.size, 10);
  } finally {
    await cleanup();
  }
});

await test('invalid paths, excluded folders and other extensions never touch the filesystem', async () => {
  const { reader, root, cleanup } = await fixture();
  try {
    const r = await reader();
    // Remove the root: a refusal that reached the filesystem would now say root_changed.
    await rm(root, { recursive: true });

    for (const [path, reason] of [
      ['../outside/a.md', 'invalid_path'],
      ['/etc/hostname', 'invalid_path'],
      ['notes/../../outside/a.md', 'invalid_path'],
      ['.obsidian/config.md', 'excluded'],
      ['deep/AI-Inbox/x.md', 'excluded'],
      ['image.png', 'extension'],
    ] as const) {
      const result = await r.open(path);
      assert.deepEqual(result, { ok: false, reason, relativePath: path });
    }
  } finally {
    await cleanup();
  }
});

await test('a final symlink, even to a file inside the root, is refused', async () => {
  const { reader, root, base, cleanup } = await fixture();
  try {
    await symlink(join(base, 'outside', 'a.md'), join(root, 'out.md'));
    await symlink(join(root, 'top.md'), join(root, 'alias.md'));
    await symlink(join(base, 'vault-evil', 'x.md'), join(root, 'evil.md'));
    const r = await reader();

    for (const path of ['out.md', 'alias.md', 'evil.md']) {
      const result = await r.open(path);
      assert.equal(result.ok ? null : result.reason, 'symlink', path);
    }
  } finally {
    await cleanup();
  }
});

await test('an ancestor directory symlinked outside the root is refused', async () => {
  const { reader, root, base, cleanup } = await fixture();
  try {
    await symlink(join(base, 'outside'), join(root, 'linked'));
    const r = await reader();

    const result = await r.open('linked/a.md');

    assert.deepEqual(result, { ok: false, reason: 'symlink', relativePath: 'linked/a.md' });
  } finally {
    await cleanup();
  }
});

await test('an ancestor symlink into an excluded folder inside the root is refused', async () => {
  const { reader, root, cleanup } = await fixture();
  try {
    await mkdir(join(root, 'AI-Inbox'));
    await mkdir(join(root, 'private'));
    for (const dir of ['.obsidian', 'AI-Inbox', 'private'])
      await writeFile(join(root, dir, 'Secret.md'), SECRET);
    await symlink(join(root, '.obsidian'), join(root, 'Alias'));
    await symlink('AI-Inbox', join(root, 'Inbox'));
    await symlink(join(root, 'private'), join(root, 'notes', 'Mine'));
    const r = await reader({ excludeDirs: ['.obsidian', '.trash', 'AI-Inbox', 'private'] });

    for (const path of ['Alias/Secret.md', 'Inbox/Secret.md', 'notes/Mine/Secret.md']) {
      const result = await r.open(path);
      assert.deepEqual(result, { ok: false, reason: 'symlink', relativePath: path });
    }
  } finally {
    await cleanup();
  }
});

await test('a root swapped for a symlink after creation is refused', async () => {
  const { reader, root, base, cleanup } = await fixture();
  try {
    const r = await reader();
    await rename(root, join(base, 'vault-moved'));
    await symlink(join(base, 'outside'), root);

    const result = await r.open('a.md');

    assert.equal(result.ok, false);
    assert.equal(result.ok ? null : result.reason, 'root_changed');
  } finally {
    await cleanup();
  }
});

await test('racing directory/symlink swaps never yield outside content', async () => {
  const { reader, root, base, cleanup } = await fixture();
  try {
    const r = await reader();
    await mkdir(join(root, 'swap'));
    await writeFile(join(root, 'swap', 'a.md'), 'inside\n');
    const real = join(root, 'swap-real');
    const stop = { done: false };
    // Flip `swap` between a real directory and a symlink to outside as fast as possible.
    const yieldTurn = () => new Promise((resolve) => setImmediate(resolve));
    const flipper = (async () => {
      await rename(join(root, 'swap'), real);
      while (!stop.done) {
        // Real directory for a moment, then a symlink to outside for a moment.
        await rename(real, join(root, 'swap')).catch(() => undefined);
        await yieldTurn();
        await rename(join(root, 'swap'), real).catch(() => undefined);
        await symlink(join(base, 'outside'), join(root, 'swap')).catch(() => undefined);
        await yieldTurn();
        await rm(join(root, 'swap'), { force: true }).catch(() => undefined);
      }
    })();
    const reasons = new Map<string, number>();
    for (let i = 0; i < 600; i++) {
      const result = await r.open('swap/a.md');
      if (result.ok) assert.equal(result.file.content, 'inside\n');
      const key = result.ok ? 'read-inside' : result.reason;
      reasons.set(key, (reasons.get(key) ?? 0) + 1);
    }
    stop.done = true;
    await flipper;

    // Every read returned inside content (asserted above); the swap must also have been hit,
    // or this test proves nothing about the race.
    assert.equal(
      [...reasons.values()].reduce((a, b) => a + b),
      600,
    );
    assert.ok(
      (reasons.get('symlink') ?? 0) + (reasons.get('not_found') ?? 0) > 0,
      JSON.stringify([...reasons]),
    );
    assert.ok((reasons.get('read-inside') ?? 0) > 0, JSON.stringify([...reasons]));
  } finally {
    await cleanup();
  }
});

await test('a FIFO is refused without blocking', async () => {
  const { reader, root, cleanup } = await fixture();
  try {
    execFileSync('mkfifo', [join(root, 'pipe.md')]);
    const r = await reader();

    const result = await r.open('pipe.md');

    assert.equal(result.ok ? null : result.reason, 'not_regular_file');
  } finally {
    await cleanup();
  }
});

await test('oversized, hardlinked and non-UTF-8 files are refused', async () => {
  const { reader, root, cleanup } = await fixture();
  try {
    await writeFile(join(root, 'big.md'), 'x'.repeat(2048));
    await writeFile(join(root, 'orig.md'), 'shared\n');
    await link(join(root, 'orig.md'), join(root, 'hard.md'));
    await writeFile(join(root, 'bad.md'), Buffer.from([0xc3, 0x28]));
    const r = await reader();

    assert.equal(((await r.open('big.md')) as { reason?: string }).reason, 'too_large');
    assert.equal(((await r.open('hard.md')) as { reason?: string }).reason, 'hardlink');
    assert.equal(((await r.open('bad.md')) as { reason?: string }).reason, 'invalid_encoding');
    assert.equal(((await r.open('missing.md')) as { reason?: string }).reason, 'not_found');
    assert.deepEqual(r.refusals(), {
      too_large: 1,
      hardlink: 1,
      invalid_encoding: 1,
      not_found: 1,
    });
  } finally {
    await cleanup();
  }
});

await test('unsupported filesystems (such as 9p /mnt/c) are refused at creation', async () => {
  const { reader, cleanup } = await fixture();
  try {
    await assert.rejects(
      reader({ filesystemType: () => Promise.resolve(0x01021997) }),
      UnsupportedSourceError,
    );
  } finally {
    await cleanup();
  }
});

await test('listing is sorted, skips symlinks, excluded folders and other extensions, and is bounded', async () => {
  const { reader, root, base, cleanup } = await fixture();
  try {
    await symlink(join(base, 'outside'), join(root, 'linked'));
    await symlink(join(base, 'outside', 'a.md'), join(root, 'link.md'));
    await mkdir(join(root, 'notes', 'AI-Inbox'), { recursive: true });
    await writeFile(join(root, 'notes', 'AI-Inbox', 'draft.md'), 'draft');
    const r = await reader();

    assert.deepEqual(await r.list(), ['notes/a.md', 'top.md']);
    await assert.rejects((await reader({ maxListEntries: 3 })).list(), /entry limit/);
  } finally {
    await cleanup();
  }
});

await test('a depth-limited listing throws instead of looking complete', async () => {
  const { reader, root, cleanup } = await fixture();
  try {
    await rm(join(root, 'notes'), { recursive: true });
    await mkdir(join(root, 'Deep'));
    await writeFile(join(root, 'Deep', 'Note.md'), 'deep\n');

    await assert.rejects((await reader({ maxDepth: 0 })).list(), /depth limit/);
    assert.deepEqual(await (await reader({ maxDepth: 1 })).list(), ['Deep/Note.md', 'top.md']);
  } finally {
    await cleanup();
  }
});

// Interposes the builtin `open` used by the reader: `beforeOpen` runs once, just before the
// first open whose path ends with `suffix`, then the real open proceeds.
const interposeOpen = (suffix: string, beforeOpen: () => Promise<void>) => {
  const real = fsPromises.open;
  let fired = false;
  mock.method(fsPromises, 'open', async (...args: Parameters<typeof real>) => {
    if (!fired && String(args[0]).endsWith(suffix)) {
      fired = true;
      await beforeOpen();
    }
    return real(...args);
  });
  syncBuiltinESMExports();
  return () => {
    mock.restoreAll();
    syncBuiltinESMExports();
  };
};

await test('a root replaced between the root check and the open is never read', async () => {
  for (const path of ['top.md', 'notes/a.md']) {
    const { reader, root, base, cleanup } = await fixture();
    const replacement = join(base, 'replacement');
    await mkdir(join(replacement, 'notes'), { recursive: true });
    await writeFile(join(replacement, 'top.md'), SECRET);
    await writeFile(join(replacement, 'notes', 'a.md'), SECRET);
    const r = await reader();
    const restore = interposeOpen(path.split('/')[0] ?? path, async () => {
      await rename(root, join(base, 'vault-aside'));
      await rename(replacement, root);
    });
    try {
      const result = await r.open(path);

      assert.deepEqual(result, { ok: false, reason: 'root_changed', relativePath: path });
    } finally {
      restore();
      await r.close();
      await cleanup();
    }
  }
});
