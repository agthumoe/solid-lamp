// I/O for the recovery gate (#87): dump/restore through `docker exec` into the Postgres
// container (version-matched tools, no host client), checksums, and manifest collection.
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import type { DatabaseClient } from '@aetherion/db';

import type { Manifest, MaintenanceTarget } from './recovery-core.ts';

type Sql = DatabaseClient['sql'];

// Postgres listens on 5432 inside both the Supabase and pgvector images.
const CONTAINER_PORT = '5432';

const TABLES = [
  'sources',
  'documents',
  'chunks',
  'links',
  'embedding_versions',
  'chunk_embeddings_1024',
  'chunk_embeddings_768',
] as const;

// Only application schemas. Supabase-owned schemas (auth, storage, extensions, …) belong to
// the image; the restore target gets the `vector` extension created before pg_restore.
const DUMP_SCHEMAS = ['public', 'supabase_migrations'];

const execArgs = (container: string, target: MaintenanceTarget, tool: string[]) => [
  'exec',
  '-i',
  '-e',
  'PGPASSWORD',
  container,
  ...tool,
  '-h',
  '127.0.0.1',
  '-p',
  CONTAINER_PORT,
  '-U',
  target.user,
];

const run = (
  args: string[],
  password: string,
  io: { stdin?: NodeJS.ReadableStream; stdout?: NodeJS.WritableStream },
) =>
  new Promise<void>((resolve, reject) => {
    const child = spawn('docker', args, {
      env: { ...process.env, PGPASSWORD: password },
      stdio: [io.stdin ? 'pipe' : 'ignore', io.stdout ? 'pipe' : 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-4000);
    });
    const piping: Promise<void>[] = [];
    if (io.stdin && child.stdin) piping.push(pipeline(io.stdin, child.stdin));
    if (io.stdout && child.stdout) piping.push(pipeline(child.stdout, io.stdout));
    child.on('error', reject);
    child.on('close', (code) => {
      void Promise.all(piping).then(
        () =>
          code === 0
            ? resolve()
            : reject(new Error(`${args[5] ?? 'tool'} exited ${code}: ${stderr.trim()}`)),
        reject,
      );
    });
  });

export const dumpDatabase = async (
  container: string,
  target: MaintenanceTarget,
  database: string,
  file: string,
): Promise<void> => {
  const schemas = DUMP_SCHEMAS.flatMap((schema) => ['--schema', schema]);
  await run(
    [
      ...execArgs(container, target, ['pg_dump']),
      '--format=custom',
      '--no-publications',
      '--no-subscriptions',
      ...schemas,
      database,
    ],
    target.password,
    { stdout: createWriteStream(file, { mode: 0o600 }) },
  );
};

// Default-privilege entries belong to the database image (Supabase's `supabase_admin` sets
// them on its own databases); the maintenance role cannot recreate them and the application
// does not depend on them. Table grants and RLS policies are still restored.
export const restorableEntries = (list: string): string =>
  list
    .split('\n')
    .filter((line) => !/^\d+;.* DEFAULT ACL /.test(line))
    .join('\n');

const captured = (args: string[], password: string, stdin: NodeJS.ReadableStream) => {
  const chunks: Buffer[] = [];
  const sink = new Writable({
    write(chunk: Buffer, _encoding, done) {
      chunks.push(chunk);
      done();
    },
  });
  return run(args, password, { stdin, stdout: sink }).then(() =>
    Buffer.concat(chunks).toString('utf8'),
  );
};

export const restoreDatabase = async (
  container: string,
  target: MaintenanceTarget,
  database: string,
  file: string,
): Promise<void> => {
  const list = await captured(
    ['exec', '-i', container, 'pg_restore', '--list'],
    target.password,
    createReadStream(file),
  );
  // The filtered list travels by `docker cp` from a private temp file (no stdin piping).
  const listPath = `/tmp/aetherion-restore-${randomBytes(6).toString('hex')}.list`;
  const local = await mkdtemp(join(tmpdir(), 'aetherion-restore-'));
  try {
    const localList = join(local, 'restore.list');
    await writeFile(localList, restorableEntries(list), { mode: 0o600 });
    await run(['cp', localList, `${container}:${listPath}`], target.password, {});
  } finally {
    await rm(local, { recursive: true, force: true });
  }
  try {
    await run(
      [
        ...execArgs(container, target, ['pg_restore']),
        '--exit-on-error',
        '--no-owner',
        '--use-list',
        listPath,
        '--dbname',
        database,
      ],
      target.password,
      { stdin: createReadStream(file) },
    );
  } finally {
    await run(['exec', container, 'rm', '-f', listPath], target.password, {});
  }
};

export const sha256File = async (file: string): Promise<string> => {
  const hash = createHash('sha256');
  await pipeline(createReadStream(file), hash);
  return hash.digest('hex');
};

const exists = async (sql: Sql, schema: string, table: string) => {
  const [row] = await sql<{ present: boolean }[]>`
    select to_regclass(${`${schema}.${table}`}) is not null as present`;
  return row?.present === true;
};

/** Counts, IDs and hashes only: the manifest never holds note text. */
export const collectManifest = async (sql: Sql, database: string): Promise<Manifest> => {
  const counts: Record<string, number> = {};
  for (const table of TABLES) {
    const [row] = await sql<{ n: string }[]>`select count(*)::text as n from ${sql(table)}`;
    counts[table] = Number(row?.n ?? 0);
  }
  const migrations = (await exists(sql, 'supabase_migrations', 'schema_migrations'))
    ? (
        await sql<{ version: string }[]>`
          select version from supabase_migrations.schema_migrations order by version`
      ).map((row) => row.version)
    : [];
  const [active] = await sql<{ id: string; dimensions: number }[]>`
    select id::text as id, dimensions from embedding_versions where status = 'active'`;
  const [config] = await sql<{ id: string | null }[]>`
    select active_embedding_version_id::text as id from search_config`;
  const [prints] = await sql<{ documents: string; chunks: string; tsv: string; links: string }[]>`
    select
      md5(coalesce((select string_agg(id || ':' || content_hash || ':' || coalesce(deleted_at::text, ''), ',' order by id) from documents), '')) as documents,
      md5(coalesce((select string_agg(id || ':' || content_hash, ',' order by id) from chunks), '')) as chunks,
      md5(coalesce((select string_agg(id || ':' || tsv::text, ',' order by id) from chunks), '')) as tsv,
      md5(coalesce((select string_agg(id || ':' || coalesce(to_document_id::text, '') || ':' || kind, ',' order by id) from links), '')) as links`;
  let vectorProbe: string[] = [];
  if (active) {
    const table = active.dimensions === 768 ? 'chunk_embeddings_768' : 'chunk_embeddings_1024';
    const probe = `[${Array.from({ length: active.dimensions }, (_, i) => ((i % 7) - 3) / 10).join(',')}]`;
    // Exact search: HNSW is approximate and may rebuild differently after a restore.
    vectorProbe = await sql.begin(async (tx) => {
      await tx`set local enable_indexscan = off`;
      await tx`set local enable_bitmapscan = off`;
      const rows = await tx<{ chunk_id: string }[]>`
        select chunk_id::text as chunk_id from ${tx(table)}
        where embedding_version_id = ${active.id}
        order by embedding operator(extensions.<=>) ${probe}::extensions.vector, chunk_id
        limit 10`;
      return rows.map((row) => row.chunk_id);
    });
  }
  return {
    format: 1,
    createdAt: new Date().toISOString(),
    sourceDatabase: database,
    migrations,
    counts,
    activeVersionId: active?.id ?? null,
    searchConfigVersionId: config?.id ?? null,
    fingerprints: {
      documents: prints?.documents ?? '',
      chunks: prints?.chunks ?? '',
      tsv: prints?.tsv ?? '',
      links: prints?.links ?? '',
    },
    vectorProbe,
  };
};
