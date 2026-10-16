# Template: BullMQ job (worker)

Real home: `apps/worker/src/jobs/<job-name>/job.ts`; wiring in `apps/worker/src/composition.ts`. Not compiled until the worker is scaffolded; the job-ID helper it uses is type-checked and tested now ([job-id.ts](job-id.ts)).

```ts
import type { Job } from 'bullmq';
import { z } from 'zod';

import type { Logger } from '@aetherion/shared';
import type { IngestDocumentDeps } from '@aetherion/brain';
import { ingestDocument } from '@aetherion/brain';
import { ingestDocumentJobId } from '../job-id.ts';

export const INGEST_DOCUMENT = 'ingest.document' as const;

// Payloads are small references, never document contents or secrets.
export const ingestDocumentPayloadSchema = z.strictObject({
  sourceId: z.string(),
  path: z.string(),
  contentHash: z.string().length(64),
});

// Enqueue with a deterministic ID: sha256 of (kind, sourceId, canonical path, content
// hash), so two documents with the same contents never collide and the ID contains no ':'
// (BullMQ rejects it). See job-id.ts.
//   queue.add(INGEST_DOCUMENT, payload, { jobId: ingestDocumentJobId(payload) })
// BullMQ only dedups while a job with that ID still exists (removeOnComplete drops it),
// so the handler must stay idempotent too: it skips a (source, path, content hash) that
// is already stored.

export const makeIngestDocumentHandler =
  (deps: IngestDocumentDeps & { logger: Logger }) =>
  async (job: Job, signal: AbortSignal): Promise<void> => {
    const payload = ingestDocumentPayloadSchema.parse(job.data); // reject malformed jobs
    const log = deps.logger.child({ jobId: job.id, sourceId: payload.sourceId });
    const result = await ingestDocument(deps, payload, signal);
    if (!result.ok) {
      log.warn({ code: result.error.code }, 'ingest failed'); // codes, not content
      throw new Error(result.error.code); // let BullMQ retry with backoff
    }
    log.info({ chunks: result.value.chunkCount }, 'ingested');
  };
```

Queue options (set once in composition): `attempts: 5`, exponential `backoff`, `removeOnComplete` with a count, a concurrency of 1 for anything that calls `inference`. Durable intent is written to Postgres (`events`/`outbox`) before enqueueing so Redis loss can be recovered.

Checklist: zod payload; job ID from `deterministicJobId` over every identifying field (never raw `:`-joined strings); idempotent handler; abort honoured; logs without private content; unit test for the handler with fakes.
