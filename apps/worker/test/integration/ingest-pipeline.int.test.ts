// #139 end to end: the real worker composition (BullMQ on Redis, Postgres outbox, verified
// reader, parser, chunker, compare-and-set publication) over the 40-note synthetic fixture vault,
// with a fake inference client. Needs Postgres with pgvector and Redis; skips otherwise.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { applyMigrations, withFreshDatabase } from '@aetherion/db/testing';
import { createFakeInferenceClient } from '@aetherion/llm/testing';
import { parseSourcesConfig, type Logger } from '@aetherion/shared';
import postgres from 'postgres';

import { composeWorker } from '../../src/composition.ts';
import { createInferenceDocumentEmbedder } from '../../src/features/ingest/infrastructure/inference-document-embedder.ts';
import {
  createPostgresIngestStore,
  createPostgresPendingEventStore,
} from '../../src/features/ingest/infrastructure/postgres-ingest-store.ts';
import { createSourceReaders } from '../../src/features/ingest/infrastructure/source-readers.ts';

const ADMIN_URL = process.env.AETHERION_TEST_DATABASE_URL;
const REDIS_URL = process.env.AETHERION_TEST_REDIS_URL;
const skip =
  ADMIN_URL && REDIS_URL
    ? false
    : 'needs AETHERION_TEST_DATABASE_URL (pgvector) and AETHERION_TEST_REDIS_URL';
const REPO = new URL('../../../../', import.meta.url).pathname;
const PROFILE = {
  id: 'ep-0123456789abcdef01234567',
  model: 'fake-embed',
  digest: 'f'.repeat(64),
  dimensions: 1024,
  numCtx: 8192,
  queryPrefix: '',
  documentPrefix: '',
};

const quiet: Logger = {
  child: () => quiet,
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

const until = async (check: () => Promise<boolean>, timeoutMs: number, what: string) => {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await check()) return Date.now() - started;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`timed out waiting for ${what}`);
};

await test(
  'the worker ingests the fixture vault, embeds it, and follows edits and deletes',
  { skip },
  async () => {
    if (!ADMIN_URL || !REDIS_URL) return;
    const base = await mkdtemp(join(tmpdir(), 'aetherion-ingest-'));
    const vault = join(base, 'vault');
    execFileSync(process.execPath, [join(REPO, 'scripts/brain/fixture-vault.ts'), vault]);
    try {
      await withFreshDatabase(ADMIN_URL, async (sql, url) => {
        await applyMigrations(sql);
        // Administrative setup (not the worker's job): the profile and a building version.
        await sql`insert into embedding_profiles (id, model, model_digest, dimensions, num_ctx)
                values (${PROFILE.id}, 'fake-embed', ${PROFILE.digest}, 1024, 8192)`;
        const [version] = await sql<{ id: string }[]>`
        insert into embedding_versions (model, model_digest, dimensions, chunker_version, status, profile_id)
        values ('fake-embed', ${PROFILE.digest}, 1024,
                ${(await import('@aetherion/brain')).CHUNKER_VERSION}, 'building', ${PROFILE.id}) returning id`;

        const sources = parseSourcesConfig(`
sources:
  - id: fixture-vault
    kind: obsidian
    root: { env: AETHERION_TEST_INGEST_VAULT }
    enabled: true
  - id: vault
    kind: obsidian
    root: { env: AETHERION_VAULT_ROOT }
    enabled: false
`);
        assert.ok(sources.ok);
        const workerSql = postgres(url, { max: 4, onnotice: () => undefined });
        const readers = createSourceReaders(
          sources.value,
          { AETHERION_TEST_INGEST_VAULT: vault },
          REPO,
        );
        const store = createPostgresIngestStore(workerSql);
        const inference = createFakeInferenceClient({ profiles: [PROFILE] });
        const worker = composeWorker({
          redisUrl: REDIS_URL,
          logger: quiet,
          concurrency: 2,
          prefix: `aetherion-ingest-${randomBytes(4).toString('hex')}`,
          ingest: {
            store,
            pending: createPostgresPendingEventStore(workerSql),
            readers,
            embed: createInferenceDocumentEmbedder(inference),
            watch: { sources: sources.value },
            relayIntervalMs: 100,
          },
        });
        try {
          await worker.start();
          const live = async () =>
            Number(
              (
                await sql<
                  { n: string }[]
                >`select count(*) as n from documents where deleted_at is null and current_revision_id is not null`
              )[0]?.n,
            );
          const missing = async () =>
            Number(
              (
                await sql<{ n: string }[]>`
            select count(*) as n from embedding_version_selections sel
            join documents d on d.id = sel.document_id and d.deleted_at is null
            join chunk_sets s on s.id = sel.chunk_set_id and s.document_revision_id = d.current_revision_id
            join chunks c on c.chunk_set_id = sel.chunk_set_id
            where sel.embedding_version_id = ${version?.id ?? ''}
              and not exists (select 1 from chunk_embeddings_1024 e where e.embedding_version_id = sel.embedding_version_id
                                and e.chunk_id = c.id and e.content_hash = c.content_hash)`
              )[0]?.n,
            );
          const open = async () =>
            Number(
              (
                await sql<
                  { n: string }[]
                >`select count(*) as n from ingest_events where status in ('pending', 'leased')`
              )[0]?.n,
            );

          // The initial resync plans all 40 notes; the worker publishes and embeds them.
          await until(
            async () => (await live()) === 40 && (await missing()) === 0 && (await open()) === 0,
            60_000,
            'initial ingest',
          );
          const [scan] = await sql<{ complete: boolean; seen: number }[]>`
          select last_scan_complete as complete, files_seen as seen from source_sync_state`;
          assert.deepEqual(scan, { complete: true, seen: 40 });
          const [links] = await sql<{ n: string }[]>`select count(*) as n from links`;
          assert.ok(Number(links?.n) > 0, 'wikilinks recorded');
          // Every chunk is cited with a line range, and the version now covers the corpus.
          const [unlined] = await sql<
            { n: string }[]
          >`select count(*) as n from chunks where line_start is null`;
          assert.equal(Number(unlined?.n), 0);
          await sql`update embedding_versions set status = 'ready' where id = ${version?.id ?? ''}`;
          await sql`select brain_promote_version(${version?.id ?? ''})`;

          // An edit is picked up by the watcher, published as revision 2 and embedded.
          const [target] = await sql<
            { uri: string; id: string }[]
          >`select uri, id from documents order by uri limit 1`;
          const written = Date.now();
          await writeFile(
            join(vault, target?.uri ?? ''),
            '# Edited\nCompletely new text about moonlight apples.\n',
          );
          const latency = await until(
            async () => {
              const [row] = await sql<{ revision: string }[]>`
            select r.revision::text from documents d join document_revisions r on r.id = d.current_revision_id
            where d.id = ${target?.id ?? ''}`;
              return row?.revision === '2' && (await missing()) === 0;
            },
            20_000,
            'edit published',
          );
          assert.ok(Date.now() - written >= latency);

          // A delete becomes a tombstone; the promoted version still covers the live corpus.
          await unlink(join(vault, target?.uri ?? ''));
          await until(async () => (await live()) === 39, 20_000, 'delete published');
          await sql`select brain_promote_version(${version?.id ?? ''})`;
          process.stdout.write(
            `# edit visible after ${latency} ms (watcher + relay + worker, fake embedder)\n`,
          );
        } finally {
          await worker.close();
          await readers.close();
          await workerSql.end({ timeout: 5 });
        }
      });
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  },
);
