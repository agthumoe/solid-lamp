import { err, type Logger, type SourcesConfig } from '@aetherion/shared';
import { Redis } from 'ioredis';

import { startSourceWatchers } from './features/ingest/infrastructure/source-watchers.ts';
import {
  createIngestHandlers,
  startIngestRelay,
  type IngestDeps,
} from './features/ingest/ingest-handlers.ts';
import { INGEST_DOCUMENT, INGEST_RESYNC } from './jobs/contracts.ts';
import type { JobHandlers } from './jobs/processor.ts';
import type { HealthProbe } from './health.ts';
import { createWorkerRuntime } from './runtime.ts';

// Without ingestion configured (no database/inference), handlers fail permanently with
// NOT_WIRED and nothing enqueues ingestion jobs.
const notWired = (what: string) => () =>
  Promise.resolve(err({ code: 'NOT_WIRED' as const, message: `${what} is not wired yet` }));

export const UNWIRED_HANDLERS: JobHandlers = {
  [INGEST_DOCUMENT]: notWired(INGEST_DOCUMENT),
  [INGEST_RESYNC]: notWired(INGEST_RESYNC),
};

export type CompositionInput = {
  readonly redisUrl: string;
  readonly logger: Logger;
  readonly concurrency: number;
  // Tests isolate their queues with a unique prefix.
  readonly prefix?: string;
  readonly handlers?: JobHandlers;
  // Ingestion (#139): real handlers, the outbox relay and optional watchers.
  readonly ingest?: IngestDeps & {
    readonly watch?: { readonly sources: SourcesConfig } | undefined;
    readonly relayIntervalMs?: number;
  };
};

export const composeWorker = (input: CompositionInput) => {
  // BullMQ needs maxRetriesPerRequest: null for its blocking commands.
  const redis = new Redis(input.redisUrl, { maxRetriesPerRequest: null, lazyConnect: false });
  const runtime = createWorkerRuntime({
    connection: redis,
    handlers:
      input.handlers ?? (input.ingest ? createIngestHandlers(input.ingest) : UNWIRED_HANDLERS),
    logger: input.logger,
    concurrency: input.concurrency,
    ...(input.prefix ? { prefix: input.prefix } : {}),
  });
  const health: HealthProbe = {
    redis: async () =>
      (await Promise.race([
        redis.ping(),
        new Promise<string>((resolve) => setTimeout(() => resolve('timeout'), 2_000).unref()),
      ])) === 'PONG',
    counts: runtime.counts,
  };
  const stoppers: (() => void)[] = [];
  // Starts the relay (and watchers) once the queue exists; a no-op without ingestion.
  const start = async () => {
    const ingest = input.ingest;
    if (!ingest) return;
    const relay = await startIngestRelay({
      ...ingest,
      enqueue: async (name, payload) => {
        await runtime.enqueue(name, payload);
      },
      logger: input.logger,
      ...(ingest.relayIntervalMs === undefined ? {} : { intervalMs: ingest.relayIntervalMs }),
    });
    stoppers.push(relay.close);
    if (ingest.watch) {
      const watchers = await startSourceWatchers({
        config: ingest.watch.sources,
        readers: ingest.readers,
        store: ingest.store,
        logger: input.logger,
      });
      stoppers.push(watchers.close);
    }
  };
  const close = async () => {
    for (const stop of stoppers) stop();
    await runtime.close();
    redis.disconnect();
  };
  return { runtime, health, start, close };
};
