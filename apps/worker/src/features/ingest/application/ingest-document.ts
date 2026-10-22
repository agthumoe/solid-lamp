// ingest.document (#139): one verified read of one path, published as a new immutable revision
// only through the compare-and-set, so a delayed job can never overwrite a newer edit or delete.
import { createHash } from 'node:crypto';

import { chunkMarkdown, CHUNKER_VERSION, headingOccurrences, parseNote } from '@aetherion/brain';
import { err, ok, type Result } from '@aetherion/shared';

import type { JobError } from '../../../jobs/processor.ts';
import { embedMissing } from './embed-missing.ts';
import {
  isTransientRefusal,
  type DocumentEmbedder,
  type IngestStore,
  type SourceReaders,
} from './ports.ts';

const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

export type IngestDocumentDeps = {
  readonly store: IngestStore;
  readonly readers: SourceReaders;
  readonly embed: DocumentEmbedder;
};

export type IngestDocumentOutcome =
  'published' | 'tombstoned' | 'unchanged' | 'superseded' | 'skipped';

export const ingestDocument = async (
  deps: IngestDocumentDeps,
  payload: { readonly sourceId: string; readonly path: string },
  signal: AbortSignal,
): Promise<Result<IngestDocumentOutcome, JobError>> => {
  const reader = await deps.readers(payload.sourceId);
  if (!reader)
    return err({ code: 'PERMANENT', message: 'source is not configured or not enabled' });
  const sourceId = await deps.store.ensureSource(payload.sourceId, signal);
  const watermark = await deps.store.eventWatermark(signal);
  const state = await deps.store.documentState(sourceId, payload.path, signal);
  const opened = await reader.open(payload.path);

  let outcome: IngestDocumentOutcome;
  if (!opened.ok && isTransientRefusal(opened.reason))
    // Not proof of deletion: keep the current revision and leave the event open for a retry.
    return err({ code: 'RETRYABLE', message: `source read failed: ${opened.reason}` });
  if (!opened.ok) {
    // Missing, or no longer eligible (excluded, too large, symlink, ...): it leaves the index.
    if (state && !state.deleted && state.currentRevisionId) {
      const result = await deps.store.publish(
        {
          sourceId,
          path: payload.path,
          expectedRevisionId: state.currentRevisionId,
          revision: state.currentRevision + 1,
          kind: 'tombstone',
        },
        signal,
      );
      outcome = result === 'published' ? 'tombstoned' : 'superseded';
    } else outcome = 'skipped';
  } else {
    const hash = sha256(opened.file.content);
    if (state && !state.deleted && state.currentHash === hash) outcome = 'unchanged';
    else {
      const parsed = parseNote({
        sourceId: payload.sourceId,
        path: payload.path,
        text: opened.file.content,
      });
      if (!parsed.ok)
        return err({ code: 'PERMANENT', message: `note rejected: ${parsed.error.code}` });
      const note = parsed.value;
      const chunks = chunkMarkdown(note);
      const occurrences = headingOccurrences(chunks);
      const result = await deps.store.publish(
        {
          sourceId,
          path: payload.path,
          expectedRevisionId: state?.currentRevisionId ?? null,
          revision: (state?.currentRevision ?? 0) + 1,
          kind: 'content',
          title: note.title,
          tags: note.tags,
          frontmatter: note.frontmatter,
          contentHash: hash,
          chunkerVersion: CHUNKER_VERSION,
          chunks: chunks.map((chunk) => ({
            ordinal: chunk.ordinal,
            content: chunk.content,
            contentHash: sha256(chunk.content),
            headingPath: chunk.headingPath,
            tokenCount: chunk.estimatedTokens,
            lineStart: chunk.lineStart,
            lineEnd: chunk.lineEnd,
            headingLine: chunk.headingLine ?? null,
            headingOccurrence: occurrences[chunk.ordinal] ?? 1,
          })),
          links: note.links.map((link) => ({
            kind: link.kind,
            toTitle: link.rawTarget.slice(0, 500) || link.targetPath.slice(0, 500),
            targetPath: link.targetPath,
          })),
        },
        signal,
      );
      outcome = result;
    }
  }

  // Lost the compare-and-set: another job published first, possibly an older snapshot than the
  // bytes read here. Never acknowledge this observation; retry against the new current revision
  // (an unchanged file then completes as a no-op).
  if (outcome === 'superseded')
    return err({ code: 'RETRYABLE', message: 'a concurrent revision was published; re-reading' });

  // Embeddings for this document's current revision (also completes an earlier partial run).
  const fresh = await deps.store.documentState(sourceId, payload.path, signal);
  if (fresh && !fresh.deleted) {
    const embedded = await embedMissing(deps, fresh.documentId, signal);
    if (!embedded.ok)
      return err({
        code: embedded.retryable ? 'RETRYABLE' : 'PERMANENT',
        message: embedded.message,
      });
  }
  await deps.store.completeDocument(sourceId, payload.path, watermark, signal);
  return ok(outcome);
};
