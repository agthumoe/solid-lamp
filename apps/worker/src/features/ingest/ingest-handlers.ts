// Wires the ingestion use cases into job handlers and the outbox relay loop (#139).
import { err, ok, type Logger, type Result } from '@aetherion/shared';

import { relayPendingEvents, type PendingEventStore } from '../../dispatch/pending-events.ts';
import {
  INGEST_DOCUMENT,
  INGEST_RESYNC,
  type JobName,
  type JobPayload,
} from '../../jobs/contracts.ts';
import type { JobError, JobHandlers } from '../../jobs/processor.ts';
import { ingestDocument } from './application/ingest-document.ts';
import type { DocumentEmbedder, IngestStore, SourceReaders } from './application/ports.ts';
import { resyncSource } from './application/resync-source.ts';

export type IngestDeps = {
  readonly store: IngestStore;
  readonly pending: PendingEventStore;
  readonly readers: SourceReaders & { readonly enabled: () => string[] };
  readonly embed: DocumentEmbedder;
};

// Unexpected failures (DB unreachable mid-job) are transient: retry with backoff.
const safely = async (
  run: () => Promise<Result<void, JobError>>,
): Promise<Result<void, JobError>> => {
  try {
    return await run();
  } catch {
    return err({ code: 'RETRYABLE', message: 'ingestion step failed' });
  }
};

export const createIngestHandlers = (deps: IngestDeps): JobHandlers => ({
  [INGEST_DOCUMENT]: (payload, context) =>
    safely(async () => {
      const result = await ingestDocument(deps, payload, context.signal);
      return result.ok ? ok(undefined) : result;
    }),
  [INGEST_RESYNC]: (payload, context) =>
    safely(async () => {
      const result = await resyncSource(deps, payload, context.signal);
      return result.ok ? ok(undefined) : result;
    }),
});

/**
 * Moves pending events into the queue every `intervalMs` (one run at a time) and requests an
 * initial resync for each enabled source, so a restart converges without a Redis backlog.
 */
export const startIngestRelay = async (
  deps: IngestDeps & {
    readonly enqueue: (name: JobName, payload: JobPayload<JobName>, jobId: string) => Promise<void>;
    readonly logger: Logger;
    readonly intervalMs?: number;
  },
): Promise<{ readonly close: () => void; readonly runOnce: () => Promise<void> }> => {
  for (const name of deps.readers.enabled()) {
    const sourceId = await deps.store.ensureSource(name, AbortSignal.timeout(10_000));
    await deps.store.requestResync(sourceId, AbortSignal.timeout(10_000));
  }
  let running: Promise<void> | undefined;
  const runOnce = () => {
    running ??= relayPendingEvents(deps.pending, deps.enqueue, AbortSignal.timeout(30_000))
      .then((result) => {
        if (result.failed)
          deps.logger.warn({ event: 'ingest.relay', outcome: 'failed', count: result.failed });
      })
      .catch(() => deps.logger.warn({ event: 'ingest.relay', outcome: 'failed', errorCode: 'DB' }))
      .finally(() => {
        running = undefined;
      });
    return running;
  };
  const timer = setInterval(() => void runOnce(), deps.intervalMs ?? 1_000);
  return { close: () => clearInterval(timer), runOnce };
};
