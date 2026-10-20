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
  // Worker drains on close; after this grace period active jobs are cancelled.
  readonly drainTimeoutMs?: number;
  // After cancellation, a job that still has not stopped is abandoned after this period.
  readonly cancelGraceMs?: number;
};

export type CloseOutcome = 'drained' | 'cancelled' | 'abandoned';

// True if `promise` settles (either way) within `ms`; never rejects, never keeps the loop alive.
const settlesWithin = async (promise: Promise<unknown>, ms: number): Promise<boolean> => {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), ms);
  });
  const settled = promise.then(
    () => true,
    () => true,
  );
  const result = await Promise.race([settled, timeout]);
  clearTimeout(timer);
  return result;
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

  /**
   * Bounded shutdown. BullMQ 6.3.10 caches its first close() promise, so a second
   * close(true) cannot force anything; instead: one graceful close, then cancel active jobs
   * (aborting the signal each handler received), then abandon and disconnect. A job left
   * running keeps its lock until it expires; BullMQ's stalled-job check re-runs it later.
   */
  const close = async (): Promise<CloseOutcome> => {
    const grace = options.drainTimeoutMs ?? 30_000;
    const cancelGrace = options.cancelGraceMs ?? Math.min(2_000, grace);
    const drained = worker.close();
    // An abandoned close() may still reject later; nobody awaits it then.
    drained.catch(() => undefined);

    let outcome: CloseOutcome = 'drained';
    if (!(await settlesWithin(drained, grace))) {
      outcome = 'cancelled';
      options.logger.warn({ event: 'worker.drain', outcome: 'failed', errorCode: 'DRAIN_TIMEOUT' });
      worker.cancelAllJobs('worker shutting down');
      if (!(await settlesWithin(drained, cancelGrace))) {
        outcome = 'abandoned';
        options.logger.warn({
          event: 'worker.drain',
          outcome: 'failed',
          errorCode: 'JOB_ABANDONED',
        });
        // Drop the worker's own blocking connection so nothing keeps the process alive.
        await settlesWithin(worker.disconnect(), cancelGrace);
      }
    }
    await settlesWithin(queue.close(), cancelGrace);
    return outcome;
  };

  return { queue, worker, enqueue, counts, close };
};

export type WorkerRuntime = ReturnType<typeof createWorkerRuntime>;
