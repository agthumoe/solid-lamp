// Recovery gate orchestration (#87, docs/specs/recovery-gate.md). Exported for the
// integration test; backup.ts and restore-verify.ts are the CLI entries.
import { chmod, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';

import { createDatabaseClient, type DatabaseClient } from '@aetherion/db';
import { z } from 'zod';

import {
  dumpName,
  dumpsToPrune,
  isDumpName,
  manifestDifferences,
  restoreTargetName,
  unsafeTarget,
  type Manifest,
  type RecoveryConfig,
} from './recovery-core.ts';
import { collectManifest, dumpDatabase, restoreDatabase, sha256File } from './recovery-io.ts';

const withDatabase = (config: RecoveryConfig, database: string): DatabaseClient => {
  const url = new URL(config.maintenanceUrl);
  url.pathname = `/${encodeURIComponent(database)}`;
  return createDatabaseClient({ url: url.toString(), maxConnections: 2 });
};

const companions = (dump: string) => ({ sha: `${dump}.sha256`, manifest: `${dump}.manifest.json` });

export type BackupResult = {
  readonly file: string;
  readonly sha256: string;
  readonly pruned: string[];
};

export const backup = async (config: RecoveryConfig, now = new Date()): Promise<BackupResult> => {
  const dir = resolve(config.backupDir);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(dir, 0o700);
  const file = join(dir, dumpName(now));
  const primary = withDatabase(config, config.primaryDatabase);
  try {
    // Manifest before and after the dump must agree, or writers changed data mid-backup.
    const before = await collectManifest(primary.sql, config.primaryDatabase);
    await dumpDatabase(config.container, config.maintenance, config.primaryDatabase, file);
    const after = await collectManifest(primary.sql, config.primaryDatabase);
    const drift = manifestDifferences(before, after);
    if (drift.length) {
      await rm(file, { force: true });
      throw new Error(
        `database changed during backup (${drift.join('; ')}); stop writers and retry`,
      );
    }
    const sha256 = await sha256File(file);
    const { sha, manifest } = companions(file);
    await writeFile(sha, `${sha256}  ${basename(file)}\n`, { mode: 0o600 });
    await writeFile(manifest, `${JSON.stringify(after, null, 2)}\n`, { mode: 0o600 });
    await chmod(file, 0o600);
    const pruned = dumpsToPrune(await readdir(dir), config.keep);
    for (const name of pruned) {
      const path = join(dir, name);
      const other = companions(path);
      await Promise.all([path, other.sha, other.manifest].map((p) => rm(p, { force: true })));
    }
    return { file, sha256, pruned };
  } finally {
    await primary.close();
  }
};

const manifestSchema = z.object({
  format: z.literal(1),
  createdAt: z.string(),
  sourceDatabase: z.string(),
  migrations: z.array(z.string()),
  counts: z.record(z.string(), z.number()),
  activeVersionId: z.string().nullable(),
  searchConfigVersionId: z.string().nullable(),
  fingerprints: z.record(z.string(), z.string()),
  vectorProbe: z.array(z.string()),
});

export const newestDump = async (config: RecoveryConfig): Promise<string> => {
  const dir = resolve(config.backupDir);
  const names = (await readdir(dir).catch(() => [])).filter(isDumpName).sort();
  const last = names.at(-1);
  if (!last) throw new Error(`no backups in ${dir}; run pnpm run db:backup first`);
  return join(dir, last);
};

export type VerifyResult = {
  readonly target: string;
  readonly problems: readonly string[];
  readonly kept: boolean;
};

export const restoreVerify = async (
  config: RecoveryConfig,
  file: string,
  options: { keep?: boolean; now?: Date; target?: string } = {},
): Promise<VerifyResult> => {
  const { sha, manifest: manifestFile } = companions(file);
  // 1. Integrity before any database work.
  const recorded = (await readFile(sha, 'utf8')).split(/\s+/)[0];
  if (recorded !== (await sha256File(file)))
    throw new Error('checksum mismatch: refusing to restore');
  const expected: Manifest = manifestSchema.parse(JSON.parse(await readFile(manifestFile, 'utf8')));

  // 2. Target safety, all before `create database`.
  const target = options.target ?? restoreTargetName(options.now ?? new Date());
  const unsafe = unsafeTarget(target, config);
  if (unsafe) throw new Error(`refusing restore: ${unsafe}`);
  const admin = withDatabase(config, config.maintenance.database);
  let created = false;
  try {
    const existing = await admin.sql`select 1 from pg_database where datname = ${target}`;
    if (existing.length) throw new Error(`refusing restore: ${target} already exists`);
    await admin.sql`create database ${admin.sql(target)}`;
    created = true;

    // 3. Restore into the new database and compare it with the manifest.
    const restored = withDatabase(config, target);
    try {
      // The target is brand new: its empty `public` is replaced by the dump's own (pg_dump
      // emits CREATE SCHEMA public when the schema is named explicitly).
      await restored.sql`drop schema if exists public`;
      await restored.sql`create schema if not exists extensions`;
      await restored.sql`create extension if not exists vector with schema extensions`;
      await restoreDatabase(config.container, config.maintenance, target, file);
      const actual = await collectManifest(restored.sql, target);
      return {
        target,
        problems: manifestDifferences(expected, actual),
        kept: options.keep === true,
      };
    } finally {
      await restored.close();
    }
  } finally {
    if (created && options.keep !== true)
      await admin.sql`drop database if exists ${admin.sql(target)} with (force)`;
    await admin.close();
  }
};
