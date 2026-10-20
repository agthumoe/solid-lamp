// Recovery gate against real Postgres (#87). Needs a maintenance-capable
// AETHERION_TEST_DATABASE_URL and AETHERION_PG_CONTAINER (the container running that server),
// as CI's pgvector service provides. Synthetic data only.
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { access, chmod, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import test from 'node:test';

import { createDatabaseClient } from '@aetherion/db';

import { backup, restoreVerify } from './recovery.ts';
import { loadRecoveryConfig, restoreTargetName, type RecoveryConfig } from './recovery-core.ts';

const ADMIN = process.env.AETHERION_TEST_DATABASE_URL;
const CONTAINER = process.env.AETHERION_PG_CONTAINER;
const skip =
  ADMIN && CONTAINER
    ? false
    : 'needs AETHERION_TEST_DATABASE_URL and AETHERION_PG_CONTAINER (CI service or local Docker)';

const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const vec = (seed: number) =>
  `[${Array.from({ length: 1024 }, (_, i) => (((i * seed) % 11) - 5) / 10).join(',')}]`;

const withUrlDb = (url: string, database: string) => {
  const next = new URL(url);
  next.pathname = `/${database}`;
  return next.toString();
};

// Creates a migrated, seeded source database plus a config that treats it as the primary.
const setup = async () => {
  if (!ADMIN || !CONTAINER) throw new Error('unreachable');
  const source = `aetherion_src_${randomBytes(5).toString('hex')}`;
  const admin = createDatabaseClient({ url: ADMIN, maxConnections: 1 });
  await admin.sql`create database ${admin.sql(source)}`;
  await admin.close();
  const db = createDatabaseClient({ url: withUrlDb(ADMIN, source), maxConnections: 2 });
  const dir = join(import.meta.dirname, '../../supabase/migrations');
  // Same replay rule as the Supabase CLI: every migration in order, one transaction each.
  for (const name of (await readdir(dir)).filter((n) => n.endsWith('.sql')).sort()) {
    const text = await readFile(join(dir, name), 'utf8');
    await db.sql.begin((tx) => tx.unsafe(text));
  }
  const [src] = await db.sql<{ id: string }[]>`
    insert into sources (kind, name) values ('obsidian', 'synthetic') returning id`;
  const docs = await db.sql<{ id: string }[]>`
    insert into documents (source_id, uri, content_hash) values
      (${src?.id ?? ''}, 'a.md', ${hash('a')}), (${src?.id ?? ''}, 'b.md', ${hash('b')})
    returning id`;
  const chunkIds: string[] = [];
  for (const [index, text] of [
    'alpha gate notes',
    'beta recovery drill',
    'gamma vectors',
  ].entries()) {
    const [row] = await db.sql<{ id: string }[]>`
      insert into chunks (document_id, ordinal, content, content_hash, token_count, chunker_version)
      values (${docs[index % 2]?.id ?? ''}, ${index}, ${text}, ${hash(text)}, 3, 'c1') returning id`;
    chunkIds.push(row?.id ?? '');
  }
  await db.sql`insert into links (from_document_id, to_document_id, to_title, kind)
               values (${docs[0]?.id ?? ''}, ${docs[1]?.id ?? ''}, 'b', 'wikilink')`;
  const [version] = await db.sql<{ id: string }[]>`
    insert into embedding_versions (model, model_digest, dimensions, chunker_version, status, promoted_at)
    values ('qwen3-embedding:0.6b', ${hash('m')}, 1024, 'c1', 'active', now()) returning id`;
  for (const [index, id] of chunkIds.entries())
    await db.sql`insert into chunk_embeddings_1024 (embedding_version_id, chunk_id, content_hash, embedding)
                 select ${version?.id ?? ''}, ${id}, content_hash, ${vec(index + 2)} from chunks where id = ${id}`;
  await db.sql`update search_config set active_embedding_version_id = ${version?.id ?? ''}, active_status = 'active'`;
  await db.close();

  const backupDir = await mkdtemp(join(tmpdir(), 'aetherion-backup-'));
  const config: RecoveryConfig = loadRecoveryConfig({
    AETHERION_MAINTENANCE_DATABASE_URL: ADMIN,
    AETHERION_DATABASE_URL: withUrlDb(ADMIN, source),
    AETHERION_PG_CONTAINER: CONTAINER,
    AETHERION_BACKUP_DIR: backupDir,
    AETHERION_BACKUP_KEEP: '2',
  });
  const cleanup = async () => {
    const drop = createDatabaseClient({ url: ADMIN, maxConnections: 1 });
    await drop.sql`drop database if exists ${drop.sql(source)} with (force)`;
    await drop.close();
    await rm(backupDir, { recursive: true, force: true });
  };
  return { config, source, backupDir, cleanup };
};

const databaseExists = async (name: string) => {
  if (!ADMIN) return false;
  const admin = createDatabaseClient({ url: ADMIN, maxConnections: 1 });
  const rows = await admin.sql`select 1 from pg_database where datname = ${name}`;
  await admin.close();
  return rows.length > 0;
};

await test(
  'backup then restore-verify passes and drops the isolated database',
  { skip },
  async () => {
    const { config, backupDir, cleanup } = await setup();
    try {
      const result = await backup(config, new Date('2026-10-18T01:00:00Z'));
      const target = restoreTargetName(new Date('2026-10-18T02:00:00Z'));

      const verified = await restoreVerify(config, result.file, {
        now: new Date('2026-10-18T02:00:00Z'),
      });

      assert.deepEqual(verified.problems, []);
      assert.equal(verified.target, target);
      assert.equal(await databaseExists(target), false);
      assert.equal((await stat(backupDir)).mode & 0o777, 0o700);
      for (const suffix of ['', '.sha256', '.manifest.json'])
        assert.equal((await stat(result.file + suffix)).mode & 0o777, 0o600);
      const manifest = JSON.parse(await readFile(`${result.file}.manifest.json`, 'utf8')) as {
        counts: Record<string, number>;
        vectorProbe: string[];
      };
      assert.deepEqual(manifest.counts, {
        sources: 1,
        documents: 2,
        chunks: 3,
        links: 1,
        embedding_versions: 1,
        chunk_embeddings_1024: 3,
        chunk_embeddings_768: 0,
      });
      assert.equal(manifest.vectorProbe.length, 3);
      assert.doesNotMatch(
        await readFile(`${result.file}.manifest.json`, 'utf8'),
        /alpha|beta|gamma/,
      );
    } finally {
      await cleanup();
    }
  },
);

await test('a tampered dump is refused before any database is created', { skip }, async () => {
  const { config, cleanup } = await setup();
  try {
    const result = await backup(config);
    await writeFile(result.file, Buffer.concat([await readFile(result.file), Buffer.from('x')]));
    const now = new Date('2026-10-18T03:00:00Z');

    await assert.rejects(restoreVerify(config, result.file, { now }), /checksum mismatch/);
    assert.equal(await databaseExists(restoreTargetName(now)), false);
  } finally {
    await cleanup();
  }
});

await test(
  'an existing target or the primary name is refused with zero writes',
  { skip },
  async () => {
    const { config, source, cleanup } = await setup();
    const target = restoreTargetName(new Date('2026-10-18T04:00:00Z'));
    const admin = createDatabaseClient({ url: ADMIN ?? '', maxConnections: 1 });
    try {
      const result = await backup(config);
      await admin.sql`create database ${admin.sql(target)}`;
      await admin.sql`comment on database ${admin.sql(target)} is 'sentinel'`;

      await assert.rejects(restoreVerify(config, result.file, { target }), /already exists/);
      await assert.rejects(
        restoreVerify(config, result.file, { target: source }),
        /aetherion_restore_/,
      );
      const [comment] = await admin.sql<{ c: string | null }[]>`
      select shobj_description(oid, 'pg_database') as c from pg_database where datname = ${target}`;
      assert.equal(comment?.c, 'sentinel');
    } finally {
      await admin.sql`drop database if exists ${admin.sql(target)} with (force)`;
      await admin.close();
      await cleanup();
    }
  },
);

await test(
  'drift between the restored database and the manifest fails with the field named',
  { skip },
  async () => {
    const { config, cleanup } = await setup();
    try {
      const result = await backup(config);
      const path = `${result.file}.manifest.json`;
      const manifest = JSON.parse(await readFile(path, 'utf8')) as {
        counts: Record<string, number>;
      };
      manifest.counts.chunks = 99;
      await writeFile(path, JSON.stringify(manifest));

      const verified = await restoreVerify(config, result.file);

      assert.deepEqual(verified.problems, ['count chunks: expected 99, got 3']);
    } finally {
      await cleanup();
    }
  },
);

await test('retention keeps the newest dumps with their companions', { skip }, async () => {
  const { config, backupDir, cleanup } = await setup();
  try {
    for (const hour of ['05', '06', '07'])
      await backup(config, new Date(`2026-10-18T${hour}:00:00Z`));

    assert.deepEqual((await readdir(backupDir)).sort(), [
      'aetherion-20261018t060000z.dump',
      'aetherion-20261018t060000z.dump.manifest.json',
      'aetherion-20261018t060000z.dump.sha256',
      'aetherion-20261018t070000z.dump',
      'aetherion-20261018t070000z.dump.manifest.json',
      'aetherion-20261018t070000z.dump.sha256',
    ]);
  } finally {
    await cleanup();
  }
});

// Puts a `docker` shim first on PATH for `body`. The shim runs `script` (sh) with the real
// docker in $REAL_DOCKER, so a test can fake one tool and pass every other call through.
const withDockerShim = async (script: string, body: () => Promise<void>) => {
  const path = process.env.PATH ?? '';
  let real = '';
  for (const dir of path.split(delimiter))
    if (
      !real &&
      (await access(join(dir, 'docker')).then(
        () => true,
        () => false,
      ))
    )
      real = join(dir, 'docker');
  const bin = await mkdtemp(join(tmpdir(), 'aetherion-shim-'));
  await writeFile(join(bin, 'docker'), `#!/bin/sh\nREAL_DOCKER='${real}'\n${script}\n`);
  await chmod(join(bin, 'docker'), 0o700);
  process.env.PATH = `${bin}${delimiter}${path}`;
  try {
    await body();
  } finally {
    process.env.PATH = path;
    await rm(bin, { recursive: true, force: true });
  }
};

const snapshot = async (dir: string): Promise<Record<string, string>> => {
  const files: Record<string, string> = {};
  for (const name of (await readdir(dir)).sort())
    files[name] = createHash('sha256')
      .update(await readFile(join(dir, name)))
      .digest('hex');
  return files;
};

// Answers the identity query as some other server would; everything else is real.
const OTHER_SERVER = `case "$*" in *pg_postmaster_start_time*) echo 1.5; exit 0;; esac
exec "$REAL_DOCKER" "$@"`;

await test(
  'a container that is not the configured server is refused with zero writes',
  { skip },
  async () => {
    const { config, backupDir, cleanup } = await setup();
    const now = new Date('2026-10-18T08:00:00Z');
    try {
      const result = await backup(config);
      const before = await snapshot(backupDir);

      await withDockerShim(OTHER_SERVER, async () => {
        await assert.rejects(backup(config, now), /is not the server/);
        await assert.rejects(restoreVerify(config, result.file, { now }), /is not the server/);
      });

      assert.deepEqual(await snapshot(backupDir), before);
      assert.equal(await databaseExists(restoreTargetName(now)), false);
    } finally {
      await cleanup();
    }
  },
);

await test(
  'same-second and concurrent backups never replace an existing backup',
  { skip },
  async () => {
    const { config, backupDir, cleanup } = await setup();
    const now = new Date('2026-10-18T09:00:00Z');
    try {
      const first = await backup(config, now);
      const before = await snapshot(backupDir);

      await assert.rejects(backup(config, now), /already exists; nothing replaced/);
      assert.deepEqual(await snapshot(backupDir), before);

      const later = new Date('2026-10-18T10:00:00Z');
      const results = await Promise.allSettled([backup(config, later), backup(config, later)]);
      assert.deepEqual(results.map((r) => r.status).sort(), ['fulfilled', 'rejected']);
      const files = await readdir(backupDir);
      assert.equal(files.length, 6);
      assert.equal(files.filter((name) => name.startsWith('.')).length, 0);
      assert.deepEqual((await restoreVerify(config, first.file)).problems, []);
      const winner = results.find((r) => r.status === 'fulfilled');
      assert.ok(winner?.status === 'fulfilled');
      assert.deepEqual((await restoreVerify(config, winner.value.file)).problems, []);
    } finally {
      await cleanup();
    }
  },
);

await test(
  'a failed dump leaves the previous backup intact and no partials',
  { skip },
  async () => {
    const { config, backupDir, cleanup } = await setup();
    const now = new Date('2026-10-18T11:00:00Z');
    try {
      await backup(config, now);
      const before = await snapshot(backupDir);

      await withDockerShim(
        `case "$*" in *pg_dump*) echo garbage; exit 1;; esac\nexec "$REAL_DOCKER" "$@"`,
        () => assert.rejects(backup(config, now), /pg_dump exited 1/),
      );

      assert.deepEqual(await snapshot(backupDir), before);
    } finally {
      await cleanup();
    }
  },
);
