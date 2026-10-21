// `pnpm run brain:watch-latency` (#93): detection latency on a synthetic temporary vault, from
// the end of a write (file closed) to its planned change (stable-write wait + batching +
// verified read + planning). Not the end-to-end write → searchable latency (needs #95).
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  createSourceReader,
  createVaultWatcher,
  observePaths,
  planChanges,
} from '@aetherion/brain';

const QUIET_MS = 300;
const percentile = (values: number[], p: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] ?? 0;
};
const summary = (values: number[]) => ({
  n: values.length,
  p50: Math.round(percentile(values, 50)),
  p95: Math.round(percentile(values, 95)),
  max: Math.round(Math.max(...values)),
});

const base = await mkdtemp(join(tmpdir(), 'aetherion-latency-'));
const root = join(base, 'vault');
await mkdir(join(root, 'notes'), { recursive: true });
const reader = await createSourceReader({
  root,
  includeExtensions: ['.md'],
  excludeDirs: ['.obsidian', '.trash', 'AI-Inbox'],
  maxFileBytes: 1024 * 1024,
});
const writtenAt = new Map<string, number>();
const detected = new Map<string, number>();
const indexed = new Map<string, string>();
const watcher = createVaultWatcher({
  root: reader.root,
  includeExtensions: ['.md'],
  excludeDirs: ['.obsidian', '.trash', 'AI-Inbox'],
  quietMs: QUIET_MS,
  onBatch: (paths) => {
    void observePaths(reader, paths).then((observations) => {
      const plan = planChanges(indexed, observations, { complete: false });
      const now = performance.now();
      for (const change of [...plan.added, ...plan.modified]) {
        indexed.set(change.path, change.revision);
        if (writtenAt.has(change.path) && !detected.has(change.path))
          detected.set(change.path, now);
      }
    });
  },
  onResyncRequired: () => undefined,
});
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const measure = async (paths: string[], spacingMs: number) => {
  writtenAt.clear();
  detected.clear();
  for (const path of paths) {
    await writeFile(
      join(root, path),
      `# ${path}\n${'synthetic text '.repeat(40)}\n${Math.random()}\n`,
    );
    writtenAt.set(path, performance.now());
    if (spacingMs) await wait(spacingMs);
  }
  for (let i = 0; i < 300 && detected.size < paths.length; i++) await wait(20);
  return paths.flatMap((path) => {
    const end = detected.get(path);
    const start = writtenAt.get(path);
    return end !== undefined && start !== undefined ? [end - start] : [];
  });
};

try {
  await wait(100);
  const idle = await measure(
    Array.from({ length: 20 }, (_, i) => `notes/idle-${i}.md`),
    900,
  );
  const burst = await measure(
    Array.from({ length: 100 }, (_, i) => `notes/burst-${i}.md`),
    0,
  );
  console.log(
    JSON.stringify(
      { quietMs: QUIET_MS, idleSingleEdit: summary(idle), burst100: summary(burst), unit: 'ms' },
      null,
      2,
    ),
  );
  if (idle.length < 20 || burst.length < 100) process.exitCode = 1;
} finally {
  watcher.close();
  await reader.close();
  await rm(base, { recursive: true, force: true });
}
