// Debounced vault watcher (#93, docs/specs/vault-watcher.md). Events are hints: each
// candidate waits for a stable write, then the caller confirms it through the verified reader.
// Anything the watcher cannot interpret precisely becomes a coalesced resync request.
import { watch as fsWatch } from 'node:fs';
import { stat as fsStat } from 'node:fs/promises';
import { join } from 'node:path';

import { isSafeRelativePath } from './source-reader.ts';

export type WatchEventSource = {
  readonly onEvent: (listener: (filename: string | null) => void) => void;
  readonly onError: (listener: (error: Error) => void) => void;
  readonly close: () => void;
};

export type FileSignature = { readonly size: number; readonly mtimeMs: number } | 'missing';

export type ResyncReason = 'unknown_path' | 'non_file_change' | 'watch_error';

export type VaultWatcherOptions = {
  readonly root: string;
  readonly includeExtensions: readonly string[];
  readonly excludeDirs: readonly string[];
  readonly onBatch: (paths: readonly string[]) => void;
  readonly onResyncRequired: (reason: ResyncReason) => void;
  readonly quietMs?: number;
  readonly maxSettleMs?: number;
  readonly batchMs?: number;
  readonly maxBatch?: number;
  // Injected in tests; default to recursive fs.watch and stat under the root.
  readonly source?: (root: string) => WatchEventSource;
  readonly signature?: (path: string) => Promise<FileSignature>;
};

const nodeWatchSource = (root: string): WatchEventSource => {
  const watcher = fsWatch(root, { recursive: true, persistent: true });
  return {
    onEvent: (listener) =>
      watcher.on('change', (_type, filename) =>
        listener(filename === null ? null : String(filename)),
      ),
    onError: (listener) => watcher.on('error', listener),
    close: () => watcher.close(),
  };
};

const extensionOf = (path: string) => {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot).toLowerCase() : '';
};

export const createVaultWatcher = (options: VaultWatcherOptions) => {
  const quietMs = options.quietMs ?? 300;
  const maxSettleMs = options.maxSettleMs ?? 10_000;
  const batchMs = options.batchMs ?? 100;
  const maxBatch = options.maxBatch ?? 500;
  const excluded = new Set(options.excludeDirs);
  const included = new Set(options.includeExtensions.map((ext) => ext.toLowerCase()));
  const signature =
    options.signature ??
    (async (path: string): Promise<FileSignature> => {
      try {
        const info = await fsStat(join(options.root, path));
        return { size: info.size, mtimeMs: info.mtimeMs };
      } catch {
        return 'missing';
      }
    });

  // `generation` changes on every event, so a signature check started before a newer event
  // cannot schedule a second timer for the same path.
  type Pending = {
    timer: NodeJS.Timeout;
    firstSeen: number;
    generation: number;
    last?: FileSignature;
  };
  const pending = new Map<string, Pending>();
  const ready = new Set<string>();
  let batchTimer: NodeJS.Timeout | undefined;
  let resyncTimer: NodeJS.Timeout | undefined;
  let resyncReason: ResyncReason | undefined;
  let closed = false;

  const flush = () => {
    batchTimer = undefined;
    if (closed || ready.size === 0) return;
    const batch = [...ready].sort().slice(0, maxBatch);
    for (const path of batch) ready.delete(path);
    options.onBatch(batch);
    if (ready.size) batchTimer = setTimeout(flush, batchMs);
  };

  const markReady = (path: string) => {
    pending.delete(path);
    ready.add(path);
    if (ready.size >= maxBatch) {
      clearTimeout(batchTimer);
      flush();
    } else batchTimer ??= setTimeout(flush, batchMs);
  };

  const requestResync = (reason: ResyncReason) => {
    if (closed) return;
    // Coalesce bursts (a folder move fires many events) into one request.
    resyncReason = reason === 'watch_error' ? reason : (resyncReason ?? reason);
    resyncTimer ??= setTimeout(() => {
      resyncTimer = undefined;
      const fired = resyncReason ?? 'unknown_path';
      resyncReason = undefined;
      options.onResyncRequired(fired);
    }, batchMs);
  };

  // A write is stable after `quietMs` without events and an unchanged size/mtime between two
  // checks; a path that never settles is released after `maxSettleMs`.
  // Wait `quietMs`, but never past the settle deadline: continuous events must not postpone
  // the maxSettleMs release indefinitely.
  const nextCheck = (entry: Pending) =>
    Math.min(quietMs, Math.max(0, entry.firstSeen + maxSettleMs - Date.now()));

  const settle = (path: string) => {
    const entry = pending.get(path);
    if (!entry || closed) return;
    const generation = entry.generation;
    void signature(path).then((current) => {
      const now = pending.get(path);
      if (!now || now !== entry || now.generation !== generation || closed) return;
      const same =
        now.last !== undefined &&
        (current === 'missing'
          ? now.last === 'missing'
          : now.last !== 'missing' &&
            now.last.size === current.size &&
            now.last.mtimeMs === current.mtimeMs);
      if (same || Date.now() - now.firstSeen >= maxSettleMs) return markReady(path);
      now.last = current;
      now.timer = setTimeout(() => settle(path), nextCheck(now));
    });
  };

  const onEvent = (filename: string | null) => {
    if (closed) return;
    if (filename === null) return requestResync('unknown_path');
    const path = filename.split('\\').join('/');
    if (!isSafeRelativePath(path)) return;
    const parts = path.split('/');
    if (parts.some((part) => excluded.has(part))) return;
    if (!included.has(extensionOf(path))) return requestResync('non_file_change');
    const existing = pending.get(path);
    if (existing) {
      clearTimeout(existing.timer);
      delete existing.last;
      existing.generation += 1;
      existing.timer = setTimeout(() => settle(path), nextCheck(existing));
    } else
      pending.set(path, {
        timer: setTimeout(() => settle(path), quietMs),
        firstSeen: Date.now(),
        generation: 0,
      });
  };

  const source = (options.source ?? nodeWatchSource)(options.root);
  source.onEvent(onEvent);
  source.onError(() => {
    requestResync('watch_error');
    // Stop watching; the caller resyncs and recreates the watcher.
    stopWatching();
  });

  const stopWatching = () => {
    source.close();
    for (const entry of pending.values()) clearTimeout(entry.timer);
    pending.clear();
  };

  return {
    close: () => {
      closed = true;
      stopWatching();
      clearTimeout(batchTimer);
      clearTimeout(resyncTimer);
      ready.clear();
    },
    pendingCount: () => pending.size + ready.size,
  };
};

export type VaultWatcher = ReturnType<typeof createVaultWatcher>;
