// Test-only harness: replays the full supabase/migrations history into a throwaway database.
// Persistent databases are migrated by the Supabase CLI alone (docs/development/database.md).
import { randomBytes } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import postgres, { type Sql } from 'postgres';

const MIGRATIONS = join(import.meta.dirname, '../../../../supabase/migrations');

export const migrationFiles = async (): Promise<string[]> =>
  (await readdir(MIGRATIONS)).filter((name) => /^\d{14}_[a-z0-9_]+\.sql$/.test(name)).sort();

// Each file runs in its own transaction, as the Supabase CLI applies them.
export const applyMigrations = async (sql: Sql): Promise<string[]> => {
  const files = await migrationFiles();
  for (const file of files) {
    const text = await readFile(join(MIGRATIONS, file), 'utf8');
    await sql.begin((tx) => tx.unsafe(text));
  }
  return files;
};

export const withFreshDatabase = async (
  adminUrl: string,
  run: (sql: Sql, url: string) => Promise<void>,
): Promise<void> => {
  const name = `aetherion_test_${randomBytes(6).toString('hex')}`;
  const admin = postgres(adminUrl, { max: 1, onnotice: () => undefined });
  await admin.unsafe(`create database ${name}`);
  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  const sql = postgres(url.toString(), { max: 4, onnotice: () => undefined });
  try {
    await run(sql, url.toString());
  } finally {
    await sql.end({ timeout: 5 });
    await admin.unsafe(`drop database if exists ${name} with (force)`);
    await admin.end({ timeout: 5 });
  }
};
