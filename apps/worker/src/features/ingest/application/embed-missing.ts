// Embeds chunks that lack a vector for each non-retired version (#139, ADR 0006). Every batch is
// embedded with the version's pinned profile and the returned identity is checked before any
// vector is stored, so a vector from another embedding space can never enter the version.
import type { DocumentEmbedder, IngestStore } from './ports.ts';

export const EMBED_BATCH = 32;
// Bounds a corpus-wide call. A single document is embedded to completion (its chunk count is
// finite and every batch must make progress); a corpus-wide call that hits the cap reports a
// retryable outcome instead of success, so durable work is never acknowledged half done.
export const MAX_BATCHES = 64;

export type EmbedOutcome =
  | { readonly ok: true; readonly stored: number }
  | { readonly ok: false; readonly retryable: boolean; readonly message: string };

export const embedMissing = async (
  deps: { readonly store: IngestStore; readonly embed: DocumentEmbedder },
  documentId: string | null,
  signal: AbortSignal,
): Promise<EmbedOutcome> => {
  let stored = 0;
  for (const target of await deps.store.embeddingTargets(signal)) {
    let lastBatch = '';
    for (let batch = 0; ; batch++) {
      if (signal.aborted) return { ok: false, retryable: true, message: 'cancelled' };
      const missing = await deps.store.missingVectors(
        target.versionId,
        EMBED_BATCH,
        documentId,
        signal,
      );
      if (!missing.length) break;
      if (documentId === null && batch >= MAX_BATCHES)
        return { ok: false, retryable: true, message: 'embedding cap reached; continuing later' };
      // Every batch must store something, or the loop would never end.
      const batchKey = missing.map((chunk) => chunk.chunkId).join(',');
      if (batchKey === lastBatch)
        return { ok: false, retryable: true, message: 'embedding made no progress' };
      lastBatch = batchKey;
      const embedded = await deps.embed(
        missing.map((chunk) => chunk.content),
        target.profileId,
        signal,
      );
      if (!embedded.ok) return embedded;
      const { value } = embedded;
      if (
        value.profileId !== target.profileId ||
        value.dimensions !== target.dimensions ||
        value.vectors.length !== missing.length ||
        value.vectors.some((vector) => vector.length !== target.dimensions)
      )
        return {
          ok: false,
          retryable: false,
          message: 'embedding identity does not match the version profile',
        };
      await deps.store.storeVectors(
        target,
        missing.map((chunk, index) => ({
          chunkId: chunk.chunkId,
          contentHash: chunk.contentHash,
          vector: value.vectors[index] ?? [],
        })),
        signal,
      );
      stored += missing.length;
    }
  }
  return { ok: true, stored };
};
