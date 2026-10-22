// ingest.resync (#139): a full scan planned against the indexed revisions. Only a complete scan
// may plan deletions (a partial, failed or offline scan never mass-deletes notes); the planned
// work becomes durable events that the relay dispatches as document jobs.
import { planChanges, scanSource } from '@aetherion/brain';
import { err, ok, type Result } from '@aetherion/shared';

import type { JobError } from '../../../jobs/processor.ts';
import type { ChangeEvent, IngestStore, SourceReaders } from './ports.ts';

export type ResyncOutcome = { readonly complete: boolean; readonly events: number };

export const resyncSource = async (
  deps: { readonly store: IngestStore; readonly readers: SourceReaders },
  payload: { readonly sourceId: string; readonly scanId: string },
  signal: AbortSignal,
): Promise<Result<ResyncOutcome, JobError>> => {
  const reader = await deps.readers(payload.sourceId);
  if (!reader)
    return err({ code: 'PERMANENT', message: 'source is not configured or not enabled' });
  const sourceId = await deps.store.ensureSource(payload.sourceId, signal);
  const scan = await scanSource(reader);
  if (!scan.complete) {
    await deps.store.recordScan(
      sourceId,
      { complete: false, seen: 0, indexed: 0, skipped: 0, errorCode: 'SCAN_INCOMPLETE' },
      signal,
    );
    await deps.store.completeResync(payload.scanId, signal);
    return ok({ complete: false, events: 0 });
  }
  const indexed = await deps.store.indexedPaths(sourceId, signal);
  const plan = planChanges(indexed, scan.observations, { complete: true });
  const events: ChangeEvent[] = [
    ...plan.added.map((entry) => ({
      kind: 'changed' as const,
      path: entry.path,
      observedHash: entry.revision,
    })),
    ...plan.modified.map((entry) => ({
      kind: 'changed' as const,
      path: entry.path,
      observedHash: entry.revision,
    })),
    ...plan.renamed.flatMap((entry) => [
      { kind: 'changed' as const, path: entry.to, observedHash: entry.revision },
      { kind: 'deleted' as const, path: entry.from },
    ]),
    ...plan.deleted.map((entry) => ({ kind: 'deleted' as const, path: entry.path })),
  ];
  const recorded = await deps.store.recordEvents(sourceId, events, signal);
  const present = scan.observations.filter((o) => o.kind === 'present').length;
  await deps.store.recordScan(
    sourceId,
    {
      complete: true,
      seen: scan.observations.length,
      indexed: present,
      skipped: scan.observations.length - present,
      errorCode: null,
    },
    signal,
  );
  await deps.store.completeResync(payload.scanId, signal);
  return ok({ complete: true, events: recorded });
};
