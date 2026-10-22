import { inferenceError, type InferenceError } from '@aetherion/llm';
import { err, ok, type Result } from '@aetherion/shared';
import { z } from 'zod';

import type { OllamaHttp } from './ollama-http.ts';
import { canonicalModel } from './residency.ts';

const tagsSchema = z.object({
  models: z.array(
    z.object({
      model: z.string().min(1),
      digest: z.string().regex(/^[0-9a-f]{64}$/),
    }),
  ),
});

/** Installed models and their artifact digests (`/api/tags`), keyed by canonical model name. */
export const listInstalled = async (
  http: OllamaHttp,
  signal: AbortSignal,
): Promise<Result<ReadonlyMap<string, string>, InferenceError>> => {
  const response = await http.getJson('/api/tags', signal);
  if (!response.ok) return response;
  const parsed = tagsSchema.safeParse(response.value);
  if (!parsed.success) return err(inferenceError('INVALID_RESPONSE', 'unexpected /api/tags body'));
  return ok(
    new Map(parsed.data.models.map((entry) => [canonicalModel(entry.model), entry.digest])),
  );
};
