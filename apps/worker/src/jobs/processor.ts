import type { Logger, Result } from '@aetherion/shared';
import { UnrecoverableError } from 'bullmq';

import { isJobName, JOB_SCHEMAS, type JobName, type JobPayload } from './contracts.ts';

// RETRYABLE: transient (inference/DB unavailable) → BullMQ retries with backoff.
// PERMANENT: bad input or a policy refusal → fail now, no retry.
// NOT_WIRED: the handler body is not implemented yet (see docs/specs/worker.md).
export type JobErrorCode = 'RETRYABLE' | 'PERMANENT' | 'NOT_WIRED';
export type JobError = { readonly code: JobErrorCode; readonly message: string };

export type JobContext = {
  readonly jobId: string;
  readonly attempt: number;
  readonly signal: AbortSignal;
  readonly logger: Logger;
};

export type JobHandler<N extends JobName> = (
  payload: JobPayload<N>,
  context: JobContext,
) => Promise<Result<void, JobError>>;

export type JobHandlers = { readonly [N in JobName]: JobHandler<N> };

export type ProcessableJob = {
  readonly id?: string | undefined;
  readonly name: string;
  readonly data: unknown;
  readonly attemptsMade: number;
};

const CANCELLED = Symbol('cancelled');

// Stops waiting when the job is cancelled (worker shutdown), even if the handler ignores its
// signal: BullMQ then sees the job finish, so its close completes and releases its timers and
// connections. A handler that ignores the signal keeps running unobserved; its result is
// discarded and the job is retried.
const untilAborted = <T>(work: Promise<T>, signal: AbortSignal): Promise<T | typeof CANCELLED> => {
  if (signal.aborted) {
    work.catch(() => undefined);
    return Promise.resolve(CANCELLED);
  }
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      work.catch(() => undefined);
      resolve(CANCELLED);
    };
    signal.addEventListener('abort', onAbort, { once: true });
    work.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
};

/**
 * Validates and dispatches one job. Throwing an Error asks BullMQ to retry; throwing
 * UnrecoverableError fails the job immediately. Logs carry IDs and codes only.
 */
export const createProcessor =
  (handlers: JobHandlers, logger: Logger) =>
  async (
    job: ProcessableJob,
    signal: AbortSignal = new AbortController().signal,
  ): Promise<void> => {
    const jobLogger = logger.child({ jobId: job.id ?? 'unknown' });
    const startedAt = Date.now();
    if (!isJobName(job.name)) {
      jobLogger.error({ event: 'job.rejected', outcome: 'failed', errorCode: 'UNKNOWN_JOB' });
      throw new UnrecoverableError('unknown job name');
    }
    const parsed = JOB_SCHEMAS[job.name].safeParse(job.data);
    if (!parsed.success) {
      jobLogger.error({ event: 'job.rejected', outcome: 'failed', errorCode: 'INVALID_PAYLOAD' });
      throw new UnrecoverableError('invalid job payload');
    }
    const handler = handlers[job.name] as JobHandler<typeof job.name>;
    const work = handler(parsed.data, {
      jobId: job.id ?? 'unknown',
      attempt: job.attemptsMade + 1,
      signal,
      logger: jobLogger,
    });
    const result = await untilAborted(work, signal);
    const durationMs = Date.now() - startedAt;
    if (result === CANCELLED) {
      jobLogger.warn({
        event: 'job.cancelled',
        outcome: 'failed',
        durationMs,
        errorCode: 'CANCELLED',
      });
      // Retryable: the job runs again after restart.
      throw new Error('job cancelled by worker shutdown');
    }
    if (result.ok) {
      jobLogger.info({ event: 'job.complete', outcome: 'complete', durationMs });
      return;
    }
    jobLogger.warn({
      event: 'job.failed',
      outcome: 'failed',
      durationMs,
      count: job.attemptsMade + 1,
      errorCode: result.error.code,
    });
    if (result.error.code === 'RETRYABLE') throw new Error(result.error.message);
    throw new UnrecoverableError(result.error.message);
  };
