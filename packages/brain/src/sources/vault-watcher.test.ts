import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { planChanges } from './change-plan.ts';
import { observePaths, scanSource } from './observe.ts';
import { createSourceReader } from './source-reader.ts';
import {
  createVaultWatcher,
  type FileSignature,
  type ResyncReason,
  type WatchEventSource,
} from './vault-watcher.ts';

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// A controllable event source standing in for fs.watch.
const fakeSource = () => {
  let emit: (filename: string | null) => void = () => undefined;
  let fail: (error: Error) => void = () => undefined;
  const state = { closed: false };
  const source: WatchEventSource = {
    onEvent: (listener) => (emit = listener),
    onError: (listener) => (fail = listener),
    close: () => (state.closed = true),
  };
  return { source, emit: (name: string | null) => emit(name), fail: (e: Error) => fail(e), state };
};

const setup = (signatures: Map<string, FileSignature> = new Map(), extra = {}) => {
  const fake = fakeSource();
  const batches: string[][] = [];
  const resyncs: ResyncReason[] = [];
  const watcher = createVaultWatcher({
    root: '/vault',
    includeExtensions: ['.md'],
    excludeDirs: ['.obsidian', '.trash', 'AI-Inbox'],
    onBatch: (paths) => batches.push([...paths]),
    onResyncRequired: (reason) => resyncs.push(reason),
    quietMs: 20,
    batchMs: 10,
    maxSettleMs: 400,
    source: () => fake.source,
    signature: (path) => Promise.resolve(signatures.get(path) ?? 'missing'),
    ...extra,
  });
  return { fake, watcher, batches, resyncs, signatures };
};

await test('a burst of events on one path becomes a single emission after the write settles', async () => {
  const { fake, watcher, batches } = setup(new Map([['notes/a.md', { size: 5, mtimeMs: 1 }]]));
  try {
    for (let i = 0; i < 10; i++) fake.emit('notes/a.md');
    await wait(150);

    assert.deepEqual(batches, [['notes/a.md']]);
  } finally {
    watcher.close();
  }
});

await test('an unstable size delays emission until two checks agree', async () => {
  const signatures = new Map<string, FileSignature>([['grow.md', { size: 1, mtimeMs: 1 }]]);
  const { fake, watcher, batches } = setup(signatures);
  try {
    fake.emit('grow.md');
    await wait(30);
    signatures.set('grow.md', { size: 2, mtimeMs: 2 });
    await wait(30);
    signatures.set('grow.md', { size: 3, mtimeMs: 3 });
    assert.deepEqual(batches, []);
    await wait(120);

    assert.deepEqual(batches, [['grow.md']]);
  } finally {
    watcher.close();
  }
});

await test('a path that never settles is released after maxSettleMs', async () => {
  let n = 0;
  const { fake, watcher, batches } = setup(new Map(), {
    signature: () => Promise.resolve({ size: n++, mtimeMs: n } satisfies FileSignature),
  });
  try {
    fake.emit('busy.md');
    await wait(250);
    assert.deepEqual(batches, []);
    await wait(300);

    assert.deepEqual(batches, [['busy.md']]);
  } finally {
    watcher.close();
  }
});

await test('a disappearing file is still emitted so the reader can confirm the deletion', async () => {
  const { fake, watcher, batches } = setup();
  try {
    fake.emit('deleted.md');
    await wait(120);

    assert.deepEqual(batches, [['deleted.md']]);
  } finally {
    watcher.close();
  }
});

await test('excluded and unsafe paths are ignored; folder-like and nameless events request one resync', async () => {
  const { fake, watcher, batches, resyncs } = setup();
  try {
    fake.emit('.obsidian/workspace.json');
    fake.emit('AI-Inbox/draft.md');
    fake.emit('../escape.md');
    fake.emit('/abs.md');
    assert.deepEqual(resyncs, []);

    fake.emit('projects');
    fake.emit('projects-renamed');
    fake.emit(null);
    await wait(60);

    assert.deepEqual(batches, []);
    assert.equal(resyncs.length, 1);
  } finally {
    watcher.close();
  }
});

await test('a watch error requests resync and stops watching', async () => {
  const { fake, watcher, resyncs, batches } = setup(new Map([['a.md', { size: 1, mtimeMs: 1 }]]));
  try {
    fake.emit('a.md');
    fake.fail(new Error('ENOSPC'));
    await wait(80);

    assert.deepEqual(resyncs, ['watch_error']);
    assert.equal(fake.state.closed, true);
    assert.deepEqual(batches, []);
  } finally {
    watcher.close();
  }
});

await test('close() clears pending work', async () => {
  const { fake, watcher, batches } = setup(new Map([['a.md', { size: 1, mtimeMs: 1 }]]));
  fake.emit('a.md');
  watcher.close();
  await wait(80);

  assert.deepEqual(batches, []);
  assert.equal(watcher.pendingCount(), 0);
});

await test('real filesystem: edits, a rename and a deletion become the expected plan', async () => {
  const base = await mkdtemp(join(tmpdir(), 'aetherion-watch-'));
  const root = join(base, 'vault');
  await mkdir(join(root, 'notes'), { recursive: true });
  await mkdir(join(root, 'archive'));
  await writeFile(join(root, 'notes', 'keep.md'), 'keep\n');
  await writeFile(join(root, 'notes', 'edit.md'), 'v1\n');
  await writeFile(join(root, 'notes', 'move.md'), 'moving\n');
  await writeFile(join(root, 'notes', 'drop.md'), 'drop\n');
  const reader = await createSourceReader({
    root,
    includeExtensions: ['.md'],
    excludeDirs: ['.obsidian', '.trash', 'AI-Inbox'],
    maxFileBytes: 1024,
  });
  const initial = await scanSource(reader);
  assert.ok(initial.complete);
  const indexed = new Map(
    initial.observations.flatMap((o) =>
      o.kind === 'present' ? [[o.path, o.revision] as const] : [],
    ),
  );

  const seen = new Set<string>();
  const resyncs: ResyncReason[] = [];
  const watcher = createVaultWatcher({
    root: reader.root,
    includeExtensions: ['.md'],
    excludeDirs: ['.obsidian', '.trash', 'AI-Inbox'],
    onBatch: (paths) => paths.forEach((path) => seen.add(path)),
    onResyncRequired: (reason) => resyncs.push(reason),
    quietMs: 40,
    batchMs: 20,
  });
  try {
    await wait(50);
    await writeFile(join(root, 'notes', 'edit.md'), '---\ntitle: v2\n---\nv1\n');
    await rename(join(root, 'notes', 'move.md'), join(root, 'archive', 'move.md'));
    await rm(join(root, 'notes', 'drop.md'));
    await writeFile(join(root, 'notes', 'new.md'), 'fresh\n');
    for (let i = 0; i < 50 && seen.size < 5; i++) await wait(40);

    const plan = planChanges(indexed, await observePaths(reader, [...seen]), { complete: false });

    assert.deepEqual(plan.added, [
      { path: 'notes/new.md', revision: plan.added[0]?.revision ?? '' },
    ]);
    assert.deepEqual(
      plan.modified.map((entry) => entry.path),
      ['notes/edit.md'],
    );
    assert.deepEqual(
      plan.renamed.map((entry) => [entry.from, entry.to]),
      [['notes/move.md', 'archive/move.md']],
    );
    assert.deepEqual(
      plan.deleted.map((entry) => entry.path),
      ['notes/drop.md'],
    );
    assert.ok(!seen.has('notes/keep.md'));
  } finally {
    watcher.close();
    await reader.close();
    await rm(base, { recursive: true, force: true });
  }
});

await test('a failed scan is incomplete and cannot authorize deletions', async () => {
  const result = await scanSource({
    open: () => Promise.reject(new Error('unused')),
    list: () => Promise.reject(new Error('source changed during listing')),
  });

  assert.deepEqual(result, { complete: false, error: 'source changed during listing' });
});
