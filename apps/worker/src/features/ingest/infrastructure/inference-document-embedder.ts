import type { InferenceClient } from '@aetherion/llm';

import type { DocumentEmbedder } from '../application/ports.ts';

// Background priority: interactive queries go first through the one GPU gate.
const BATCH_DEADLINE_MS = 5 * 60_000;
const TRANSIENT = new Set([
  'QUEUE_FULL',
  'DEADLINE_EXPIRED',
  'CANCELLED',
  'INFERENCE_UNAVAILABLE',
  'MODEL_NOT_LOADED',
]);

export const createInferenceDocumentEmbedder =
  (client: InferenceClient): DocumentEmbedder =>
  async (texts, profileId, signal) => {
    const result = await client.embed(
      { texts: [...texts], kind: 'document', profileId },
      { priority: 'background', deadline: new Date(Date.now() + BATCH_DEADLINE_MS), signal },
    );
    if (!result.ok)
      return { ok: false, retryable: TRANSIENT.has(result.error.code), message: result.error.code };
    return {
      ok: true,
      value: {
        vectors: result.value.vectors,
        profileId: result.value.profile.id,
        dimensions: result.value.profile.dimensions,
      },
    };
  };
