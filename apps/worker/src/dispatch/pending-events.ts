// Transactional-outbox relay (#92, review F5): ingestion first records a pending event in
// Postgres in the same transaction as its source revision; this relay moves pending events
// into the queue. Redis can be lost at any time: undispatched events stay pending and are
// re-sent; a re-sent event reuses its deterministic job ID, and handlers are idempotent.
import { jobIdFor, type JobName, type JobPayload } from '../jobs/contracts.ts';

export type PendingEvent<N extends JobName = JobName> = {
  readonly id: string;
  readonly name: N;
  readonly payload: JobPayload<N>;
};

/** Port: the Postgres implementation arrives with the ingest_events table (#91). */
export type PendingEventStore = {
  // Oldest first, at most `limit`. Claiming does not remove an event.
  readonly pending: (limit: number, signal: AbortSignal) => Promise<readonly PendingEvent[]>;
  // Idempotent: marking an already-dispatched event is a no-op.
  readonly markDispatched: (ids: readonly string[], signal: AbortSignal) => Promise<void>;
};

export type Enqueue = (name: JobName, payload: JobPayload<JobName>, jobId: string) => Promise<void>;

export type RelayResult = { readonly dispatched: number; readonly failed: number };

export const relayPendingEvents = async (
  store: PendingEventStore,
  enqueue: Enqueue,
  signal: AbortSignal,
  limit = 100,
): Promise<RelayResult> => {
  const events = await store.pending(limit, signal);
  const sent: string[] = [];
  let failed = 0;
  for (const event of events) {
    if (signal.aborted) break;
    try {
      await enqueue(event.name, event.payload, jobIdFor(event.name, event.payload));
      sent.push(event.id);
    } catch {
      // Left pending: the next relay run retries it with the same job ID.
      failed++;
    }
  }
  if (sent.length) await store.markDispatched(sent, signal);
  return { dispatched: sent.length, failed };
};

/** In-memory store honouring the port contract (ordering, idempotent marking). Tests only. */
export const createMemoryPendingEventStore = (initial: readonly PendingEvent[] = []) => {
  const events = [...initial];
  const dispatched = new Set<string>();
  return {
    add: (event: PendingEvent) => events.push(event),
    dispatchedIds: () => [...dispatched],
    pending: (limit: number) =>
      Promise.resolve(events.filter((event) => !dispatched.has(event.id)).slice(0, limit)),
    markDispatched: (ids: readonly string[]) => {
      for (const id of ids) dispatched.add(id);
      return Promise.resolve();
    },
  } satisfies PendingEventStore & Record<string, unknown>;
};
