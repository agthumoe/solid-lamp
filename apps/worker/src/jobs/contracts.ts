import { z } from 'zod';

import { deterministicJobId, normalizeDocumentPath } from './job-id.ts';

export const INGEST_QUEUE = 'ingest';

export const INGEST_DOCUMENT = 'ingest.document' as const;
export const INGEST_RESYNC = 'ingest.resync' as const;

const sourceId = z.string().regex(/^[a-z0-9][a-z0-9-]{1,31}$/);

// Payloads are references, never note text: source ID, normalized source-relative path and
// the exact revision (SHA-256 of the file bytes). A job can always be rebuilt from Postgres.
export const ingestDocumentPayloadSchema = z.strictObject({
  sourceId,
  path: z
    .string()
    .min(1)
    .max(4096)
    .refine((value) => {
      try {
        return normalizeDocumentPath(value) === value;
      } catch {
        return false;
      }
    }, 'must be a normalized source-relative path'),
  revision: z.string().regex(/^[0-9a-f]{64}$/),
  // The durable ingest_events row behind the job (#139). Job identity follows the event: a
  // relay re-send after a Redis loss reuses it (deduplicated), while a new event for the same
  // bytes (a delete after an edit, or an A→B→A edit) is a new job, never silently dropped.
  eventId: z
    .string()
    .regex(/^\d{1,18}$/)
    .optional(),
});

export const ingestResyncPayloadSchema = z.strictObject({
  sourceId,
  scanId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
});

export type IngestDocumentPayload = z.infer<typeof ingestDocumentPayloadSchema>;
export type IngestResyncPayload = z.infer<typeof ingestResyncPayloadSchema>;

export const JOB_SCHEMAS = {
  [INGEST_DOCUMENT]: ingestDocumentPayloadSchema,
  [INGEST_RESYNC]: ingestResyncPayloadSchema,
} as const;

export type JobName = keyof typeof JOB_SCHEMAS;
export type JobPayload<N extends JobName> = z.infer<(typeof JOB_SCHEMAS)[N]>;

export const isJobName = (name: string): name is JobName => Object.hasOwn(JOB_SCHEMAS, name);

// A newer revision of the same path is a new job; the same revision (and event) is deduplicated.
export const ingestDocumentJobId = (payload: IngestDocumentPayload): string =>
  deterministicJobId('ingest-document', [
    payload.sourceId,
    normalizeDocumentPath(payload.path),
    payload.revision,
    ...(payload.eventId === undefined ? [] : [payload.eventId]),
  ]);

export const ingestResyncJobId = (payload: IngestResyncPayload): string =>
  deterministicJobId('ingest-resync', [payload.sourceId, payload.scanId]);

export const jobIdFor = <N extends JobName>(name: N, payload: JobPayload<N>): string =>
  name === INGEST_DOCUMENT
    ? ingestDocumentJobId(payload as IngestDocumentPayload)
    : ingestResyncJobId(payload as IngestResyncPayload);

// Retries with exponential backoff; completed jobs are short-lived, failures kept for review.
export const DEFAULT_JOB_OPTIONS = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 1_000 },
  removeOnComplete: { age: 3_600, count: 1_000 },
  removeOnFail: { age: 7 * 24 * 3_600 },
} as const;
