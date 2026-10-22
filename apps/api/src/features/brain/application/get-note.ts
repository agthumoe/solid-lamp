// Bounded excerpt by citation identity (#95). A citation resolves only against the exact identity
// it names: a changed, moved or deleted note is reported as stale with no text, and an unknown or
// out-of-scope citation is one NOT_FOUND (so scope cannot be probed).
import { createHash } from 'node:crypto';

import { appError, err, ok, type AppError, type Result } from '@aetherion/shared';
import type { BrainNoteQuery, BrainNoteResponse } from '@aetherion/shared/contracts';

import { bounded, citationFor } from './citations.ts';
import type { BrainStore } from './ports.ts';

const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

export const getNote = async (
  store: BrainStore,
  query: BrainNoteQuery,
  signal: AbortSignal,
): Promise<Result<BrainNoteResponse, AppError<'NOT_FOUND'>>> => {
  const state = await store.noteState(
    {
      sourceName: query.sourceId,
      documentId: query.documentId,
      chunkId: query.chunkId,
      versionId: query.versionId,
    },
    signal,
  );
  const notFound = err(appError('NOT_FOUND', 'no such citation'));
  if (!state) return notFound;
  // The cited chunk must be the one indexed at the cited revision and content.
  if (state.detail.revision !== query.revision || state.detail.revisionHash !== query.contentHash)
    return notFound;
  if (state.deleted) return ok({ status: 'stale', reason: 'deleted' });
  if (state.currentRevision !== query.revision) return ok({ status: 'stale', reason: 'revision' });
  if (state.currentRevisionHash !== query.contentHash)
    return ok({ status: 'stale', reason: 'content' });
  if (sha256(state.currentPath) !== query.pathSha256)
    return ok({ status: 'stale', reason: 'path' });
  const citation = citationFor(state.detail, query.versionId);
  if (!citation) return notFound;
  const excerpt = bounded(state.detail.content, query.maxChars);
  return ok({ status: 'ok', citation, excerpt: excerpt.text, truncated: excerpt.truncated });
};
