// Template: deterministic, BullMQ-safe job IDs.
// Real home: apps/worker/src/jobs/job-id.ts. Used by bullmq-job.md.
//
// BullMQ custom job IDs must not contain ':' (Redis key separator) and must not be plain
// integers. We hash the job's full identity, so the ID is safe, fixed-length and never
// leaks a private path into Redis keys or logs.

import { createHash } from 'node:crypto';

// Canonical spelling of a source-relative path, preserving filesystem identity. Linux
// paths are byte strings: Unicode forms (NFC vs NFD), case and backslashes are all part of
// the name, so they are NOT changed, or two distinct files would share one ID. Only
// spellings that always name the same file are folded: '.' segments, empty segments from
// duplicate slashes, a trailing slash. Absolute paths and '..' segments are rejected
// (resolving '..' lexically can change the file when a symlink is involved); the source
// watcher only produces clean relative paths, so either means a bug upstream.
export const normalizeDocumentPath = (path: string): string => {
  if (path.startsWith('/')) throw new Error('document path must be source-relative');
  const segments = path.split('/').filter((segment) => segment !== '' && segment !== '.');
  if (segments.includes('..')) throw new Error("document path must not contain '..'");
  if (segments.length === 0) throw new Error('document path is empty');
  return segments.join('/');
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
