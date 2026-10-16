// Template: deterministic, BullMQ-safe job IDs.
// Real home: apps/worker/src/jobs/job-id.ts. Used by bullmq-job.md.
//
// BullMQ custom job IDs must not contain ':' (Redis key separator) and must not be plain
// integers. We hash the job's full identity, so the ID is safe, fixed-length and never
// leaks a private path into Redis keys or logs.

import { createHash } from 'node:crypto';
import { posix } from 'node:path';

// Normalise a source-relative path so the same document always has the same identity:
// Unicode NFC, forward slashes, no '.' segments or duplicate slashes, no leading './'.
// Case is preserved (Linux paths are case-sensitive). Traversal checks happen at the
// source boundary, not here.
export const normalizeDocumentPath = (path: string): string => {
  const slashed = path.normalize('NFC').replaceAll('\\', '/');
  const normalized = posix.normalize(slashed);
  return normalized.startsWith('./') ? normalized.slice(2) : normalized;
};

// `kind` is a kebab-case job kind (no ':'); `identity` lists every field that makes two
// jobs different. Leaving one out makes distinct jobs collide.
export const deterministicJobId = (kind: string, identity: readonly string[]): string => {
  if (!/^[a-z][a-z0-9-]*$/.test(kind)) throw new Error(`invalid job kind: ${kind}`);
  const digest = createHash('sha256')
    .update(JSON.stringify([kind, ...identity]))
    .digest('hex');
  return `${kind}-${digest}`;
};

export const ingestDocumentJobId = (p: {
  sourceId: string;
  path: string;
  contentHash: string;
}): string =>
  deterministicJobId('ingest-document', [p.sourceId, normalizeDocumentPath(p.path), p.contentHash]);
