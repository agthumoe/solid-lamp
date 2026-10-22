import type { InferenceClient } from '@aetherion/llm';
import { appError, err, ok } from '@aetherion/shared';

import type { QueryEmbedder } from '../application/ports.ts';

// Interactive priority: a person is waiting. The deadline bounds queueing behind background work.
const QUERY_DEADLINE_MS = 15_000;

/** Embeds a query with an explicit pinned profile and reports the identity actually used. */
export const createInferenceQueryEmbedder =
  (client: InferenceClient): QueryEmbedder =>
  async (query, profileId, signal) => {
    const result = await client.embed(
      { texts: [query], kind: 'query', profileId },
      { priority: 'interactive', deadline: new Date(Date.now() + QUERY_DEADLINE_MS), signal },
    );
    if (!result.ok) return err(appError('UNAVAILABLE', 'query embedding is unavailable'));
    const vector = result.value.vectors[0];
    if (!vector) return err(appError('UNAVAILABLE', 'query embedding is unavailable'));
    return ok({
      vector,
      profileId: result.value.profile.id,
      digest: result.value.profile.digest,
      dimensions: result.value.profile.dimensions,
    });
  };
