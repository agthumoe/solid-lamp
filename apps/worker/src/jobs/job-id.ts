// Deterministic, BullMQ-safe job IDs (from docs/development/templates/job-id.ts).
// BullMQ custom IDs must not contain ':' and must not be plain integers. Hashing the full
// identity keeps IDs fixed-length and keeps private paths out of Redis keys and logs.
import { createHash } from 'node:crypto';

// Only spellings that always name the same file are folded ('.' and empty segments, a
// trailing slash). Absolute paths and '..' are rejected: resolving '..' lexically can change
// the file when a symlink is involved.
export const normalizeDocumentPath = (path: string): string => {
  if (path.startsWith('/')) throw new Error('document path must be source-relative');
  if (path.includes('\0')) throw new Error('document path must not contain NUL');
  const segments = path.split('/').filter((segment) => segment !== '' && segment !== '.');
  if (segments.includes('..')) throw new Error("document path must not contain '..'");
  if (segments.length === 0) throw new Error('document path is empty');
  return segments.join('/');
};

export const deterministicJobId = (kind: string, identity: readonly string[]): string => {
  if (!/^[a-z][a-z0-9-]*$/.test(kind)) throw new Error(`invalid job kind: ${kind}`);
  const digest = createHash('sha256')
    .update(JSON.stringify([kind, ...identity]))
    .digest('hex');
  return `${kind}-${digest}`;
};
