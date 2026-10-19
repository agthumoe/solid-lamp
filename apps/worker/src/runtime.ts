import type { Logger } from '@aetherion/shared';
import { Queue, Worker, type ConnectionOptions } from 'bullmq';

import {
  DEFAULT_JOB_OPTIONS,
  INGEST_QUEUE,
  jobIdFor,
  JOB_SCHEMAS,
  type JobName,
  type JobPayload,
} from './jobs/contracts.ts';
import { createProcessor, type JobHandlers } from './jobs/processor.ts';

export type RuntimeOptions = {
  readonly connection: ConnectionOptions;
  readonly handlers: JobHandlers;
  readonly logger: Logger;
  readonly concurrency?: number;
  // Tests isolate themselves with a unique prefix; production uses BullMQ's default.
  readonly prefix?: string;
  // Worker drains on close; a stuck job is abandoned after this grace period.
  readonly drainTimeoutMs?: number;
};

export type QueueCounts = {
  readonly waiting: number;
  readonly active: number;
  readonly delayed: number;
  readonly failed: number;
};

/** One BullMQ queue + worker for ingestion, with validated enqueue and bounded drain. */
export const createWorkerRuntime = (options: RuntimeOptions) => {
  const prefix = options.prefix ? { prefix: options.prefix } : {};
  const queue = new Queue(INGEST_QUEUE, { connection: options.connection, ...prefix });
  const processor = createProcessor(options.handlers, options.logger);
  const worker = new Worker(
    INGEST_QUEUE,
    (job, _token, signal) => processor(job, signal ?? new AbortController().signal),
    { connection: options.connection, concurrency: options.concurrency ?? 1, ...prefix },
  );
  // BullMQ re-emits processor failures here; the processor has already logged safely.
  worker.on('error', () =>
    options.logger.error({ event: 'worker.error', outcome: 'failed', errorCode: 'WORKER' }),
  );

  // Validated, deterministic enqueue: the same identity is never queued twice while it exists.
  const enqueue = async <N extends JobName>(name: N, payload: JobPayload<N>): Promise<string> => {
    const valid = JOB_SCHEMAS[name].parse(payload) as JobPayload<N>;
    const jobId = jobIdFor(name, valid);
    await queue.add(name, valid, { ...DEFAULT_JOB_OPTIONS, jobId });
    return jobId;
  };

  const counts = async (): Promise<QueueCounts> => {
    const result = await queue.getJobCounts('waiting', 'active', 'delayed', 'failed');
    return {
      waiting: result.waiting ?? 0,
      active: result.active ?? 0,
      delayed: result.delayed ?? 0,
      failed: result.failed ?? 0,
    };
  };

  const close = async (): Promise<void> => {
    const grace = options.drainTimeoutMs ?? 30_000;
    let timer: NodeJS.Timeout | undefined;
    const drained = worker.close().then(() => 'drained' as const);
    const timeout = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), grace);
    });
    const outcome = await Promise.race([drained, timeout]);
    clearTimeout(timer);
    if (outcome === 'timeout') {
      options.logger.warn({ event: 'worker.drain', outcome: 'failed', errorCode: 'DRAIN_TIMEOUT' });
      await worker.close(true);
    }
    await queue.close();
  };

  return { queue, worker, enqueue, counts, close };
};

export type WorkerRuntime = ReturnType<typeof createWorkerRuntime>;
