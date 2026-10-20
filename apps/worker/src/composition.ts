import { err, type Logger } from '@aetherion/shared';
import { Redis } from 'ioredis';

import { INGEST_DOCUMENT, INGEST_RESYNC } from './jobs/contracts.ts';
import type { JobHandlers } from './jobs/processor.ts';
import type { HealthProbe } from './health.ts';
import { createWorkerRuntime } from './runtime.ts';

// Handler bodies need parsing/chunking (#89, #90) and the revision schema (#91). Until then
// they fail permanently with NOT_WIRED; nothing enqueues ingestion jobs yet.
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
  readonly handlers?: JobHandlers;
};

export const composeWorker = (input: CompositionInput) => {
  // BullMQ needs maxRetriesPerRequest: null for its blocking commands.
  const redis = new Redis(input.redisUrl, { maxRetriesPerRequest: null, lazyConnect: false });
  const runtime = createWorkerRuntime({
    connection: redis,
    handlers: input.handlers ?? UNWIRED_HANDLERS,
    logger: input.logger,
    concurrency: input.concurrency,
  });
  const health: HealthProbe = {
    redis: async () =>
      (await Promise.race([
        redis.ping(),
        new Promise<string>((resolve) => setTimeout(() => resolve('timeout'), 2_000).unref()),
      ])) === 'PONG',
    counts: runtime.counts,
  };
  const close = async () => {
    await runtime.close();
    redis.disconnect();
  };
  return { runtime, health, close };
};
