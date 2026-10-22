// `pnpm run brain:ingest [--source ID]... [--wait]` (#96, #139): requests a full resync of enabled
// sources through the same durable outbox the watcher uses; the running worker executes it. A
// disabled source is refused (the real vault stays off until the owner enables it, D2).
import { join } from 'node:path';
import { parseArgs } from 'node:util';

import { loadEnvConfig, loadSourcesConfig } from '@aetherion/shared';
import postgres from 'postgres';

import { createPostgresIngestStore } from './features/ingest/infrastructure/postgres-ingest-store.ts';

const USAGE = 'usage: pnpm run brain:ingest [--source ID]... [--wait] [--timeout SECONDS]';
const out = (text: string) => process.stdout.write(`${text}\n`);
const fail = (text: string, code = 1) => {
  process.stderr.write(`${text}\n`);
  process.exitCode = code;
};

const parse = () =>
  parseArgs({
    args: process.argv.slice(2),
    strict: true,
    options: {
      source: { type: 'string', multiple: true },
      wait: { type: 'boolean', default: false },
      timeout: { type: 'string', default: '600' },
      help: { type: 'boolean', default: false },
    },
  }).values;
let args: ReturnType<typeof parse> | undefined;
try {
  args = parse();
} catch (error) {
  fail(`${(error as Error).message}\n${USAGE}`, 2);
}

const run = async () => {
  if (!args) return;
  if (args.help) return out(USAGE);
  if (!/^\d{1,5}$/.test(args.timeout)) return fail(`--timeout must be whole seconds\n${USAGE}`, 2);
  const env = loadEnvConfig(process.env);
  if (!env.ok) return fail(env.error.message);
  const databaseUrl = process.env.AETHERION_DATABASE_URL;
  if (!databaseUrl) return fail('AETHERION_DATABASE_URL is not set');
  const sources = await loadSourcesConfig(join(env.value.configDir, 'sources.yaml'));
  if (!sources.ok) return fail(sources.error.message);
  const enabled = sources.value.sources
    .filter((source) => source.enabled)
    .map((source) => source.id);
  const requested = args.source?.length ? args.source : enabled;
  const refused = requested.filter((name) => !enabled.includes(name));
  if (refused.length)
    return fail(
      `not enabled in sources.yaml: ${refused.join(', ')} (enable a source only after approval)`,
      2,
    );
  if (!requested.length) return fail('no source is enabled in sources.yaml', 2);

  const sql = postgres(databaseUrl, { max: 1, connect_timeout: 5, onnotice: () => undefined });
  try {
    const store = createPostgresIngestStore(sql);
    const ids: string[] = [];
    for (const name of requested) {
      const id = await store.ensureSource(name, AbortSignal.timeout(10_000));
      await store.requestResync(id, AbortSignal.timeout(10_000));
      ids.push(id);
      out(`resync requested: ${name}`);
    }
    if (!args.wait)
      return out('the worker runs it (pnpm dev:worker); add --wait to follow progress');
    const deadline = Date.now() + Number(args.timeout) * 1_000;
    for (;;) {
      const [row] = await sql<{ open: string; failed: string }[]>`
        select count(*) filter (where status in ('pending', 'leased'))::text as open,
               count(*) filter (where status = 'failed')::text as failed
        from public.ingest_events where source_id = any (${ids}::bigint[])`;
      if (Number(row?.open ?? 0) === 0) {
        const stats = await sql<{ name: string; documents: string; complete: boolean | null }[]>`
          select s.name, (select count(*) from public.documents d where d.source_id = s.id
                           and d.deleted_at is null and d.current_revision_id is not null)::text as documents,
                 st.last_scan_complete as complete
          from public.sources s left join public.source_sync_state st on st.source_id = s.id
          where s.id = any (${ids}::bigint[]) order by s.name`;
        for (const stat of stats)
          out(
            `${stat.name}: ${stat.documents} documents · last scan ${stat.complete === null ? 'never' : stat.complete ? 'complete' : 'incomplete'}`,
          );
        if (Number(row?.failed ?? 0) > 0) return fail(`${row?.failed} ingestion events failed`);
        return;
      }
      if (Date.now() > deadline)
        return fail(`timed out with ${row?.open} events still open (is the worker running?)`);
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
};

await run();
