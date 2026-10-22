import { join, resolve } from 'node:path';

import { createInferenceClient } from '@aetherion/llm';
import { createLogger, loadSourcesConfig } from '@aetherion/shared';
import postgres from 'postgres';

import { composeWorker } from './composition.ts';
import { loadWorkerConfig } from './config.ts';
import { createInferenceDocumentEmbedder } from './features/ingest/infrastructure/inference-document-embedder.ts';
import {
  createPostgresIngestStore,
  createPostgresPendingEventStore,
} from './features/ingest/infrastructure/postgres-ingest-store.ts';
import { createSourceReaders } from './features/ingest/infrastructure/source-readers.ts';
import { createHealthServer } from './health.ts';

const SHUTDOWN_GRACE_MS = 35_000;

// Process entry: validate config once, wire, serve health on the private host, drain on
// SIGTERM (stop intake, finish active jobs within the grace period, close Redis).
const config = loadWorkerConfig(process.env);
if (!config.ok) {
  console.error(config.error.message);
  process.exit(1);
}
const logger = createLogger({ service: 'worker' }, undefined, config.value.logLevel);
// Ingestion is wired only when the database and inference are configured (#139).
const ingestion = config.value.ingestion;
const sql = ingestion
  ? postgres(ingestion.databaseUrl, { max: 4, connect_timeout: 5, onnotice: () => undefined })
  : undefined;
let ingest: Parameters<typeof composeWorker>[0]['ingest'];
if (ingestion && sql) {
  const sources = await loadSourcesConfig(join(config.value.configDir, 'sources.yaml'));
  if (!sources.ok) {
    console.error(sources.error.message);
    process.exit(1);
  }
  const store = createPostgresIngestStore(sql);
  ingest = {
    store,
    pending: createPostgresPendingEventStore(sql),
    readers: createSourceReaders(sources.value, process.env, resolve('.')),
    embed: createInferenceDocumentEmbedder(
      createInferenceClient({ baseUrl: ingestion.inferenceUrl, secret: ingestion.inferenceSecret }),
    ),
    watch: ingestion.watch ? { sources: sources.value } : undefined,
  };
}
const worker = composeWorker({
  redisUrl: config.value.redisUrl,
  logger,
  concurrency: config.value.concurrency,
  ...(ingest ? { ingest } : {}),
});
await worker.start();
const server = createHealthServer(worker.health);

const shutdown = () => {
  logger.info({ event: 'process.shutdown', outcome: 'started' });
  setTimeout(() => process.exit(1), SHUTDOWN_GRACE_MS).unref();
  server.close();
  void worker
    .close()
    .then(() => sql?.end({ timeout: 5 }))
    .then(() => process.exit(0));
};
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);

server.listen(config.value.port, config.value.host, () =>
  logger.info({ event: 'process.listening', outcome: 'complete', count: config.value.port }),
);
