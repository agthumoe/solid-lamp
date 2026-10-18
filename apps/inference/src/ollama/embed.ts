import { inferenceError, type EmbedSnapshot, type InferenceError } from '@aetherion/llm';
import { err, ok, type Result } from '@aetherion/shared';
import { z } from 'zod';

import { abortError, type OllamaHttp } from './ollama-http.ts';
import { isTransient, type RetryPolicy, type Sleep } from './retry.ts';

export type EmbedDeps = {
  readonly http: OllamaHttp;
  readonly retry: RetryPolicy;
  readonly sleep: Sleep;
};

// Queries get the role's query prefix, documents its document prefix (ADR 0002).
export type EmbedKind = 'query' | 'document';

export type EmbedResult = {
  readonly vectors: readonly (readonly number[])[];
  readonly tokensIn: number;
  readonly totalMs: number;
  readonly loadMs: number;
};

// Batching belongs to the scheduler (`embedInBatches`); a larger call is a programmer error.
export const MAX_EMBED_BATCH = 256;

const counter = z.int().nonnegative().default(0);

const embedResponseSchema = z.object({
  embeddings: z.array(z.array(z.number())),
  prompt_eval_count: counter,
  total_duration: counter,
  load_duration: counter,
});

// truncate: false makes an over-long input an error instead of a silently shortened vector.
export const embedBody = (snapshot: EmbedSnapshot, texts: readonly string[], kind: EmbedKind) => {
  const prefix = kind === 'query' ? snapshot.queryPrefix : snapshot.documentPrefix;
  return {
    model: snapshot.model,
    input: texts.map((text) => prefix + text),
    truncate: false,
    options: { num_ctx: snapshot.numCtx },
  };
};

const validate = (
  body: unknown,
  snapshot: EmbedSnapshot,
  count: number,
): Result<EmbedResult, InferenceError> => {
  const parsed = embedResponseSchema.safeParse(body);
  if (!parsed.success) return err(inferenceError('INVALID_RESPONSE', 'unexpected embed response'));
  const { embeddings } = parsed.data;
  if (embeddings.length !== count)
    return err(inferenceError('INVALID_RESPONSE', 'embedding count does not match input count'));
  // A dimension change means a different embedding space: never store or compare it.
  if (embeddings.some((vector) => vector.length !== snapshot.dimensions))
    return err(inferenceError('INVALID_RESPONSE', 'embedding dimensions do not match the role'));
  if (embeddings.some((vector) => vector.some((value) => !Number.isFinite(value))))
    return err(inferenceError('INVALID_RESPONSE', 'embedding contains non-finite values'));
  return ok({
    vectors: embeddings,
    tokensIn: parsed.data.prompt_eval_count,
    totalMs: Math.round(parsed.data.total_duration / 1e6),
    loadMs: Math.round(parsed.data.load_duration / 1e6),
  });
};

export const embedTexts = async (
  deps: EmbedDeps,
  snapshot: EmbedSnapshot,
  texts: readonly string[],
  kind: EmbedKind,
  signal: AbortSignal,
): Promise<Result<EmbedResult, InferenceError>> => {
  if (texts.length > MAX_EMBED_BATCH)
    throw new RangeError(`embed batch exceeds ${MAX_EMBED_BATCH} texts`);
  if (texts.length === 0) return ok({ vectors: [], tokensIn: 0, totalMs: 0, loadMs: 0 });
  const body = embedBody(snapshot, texts, kind);
  // Embedding is idempotent, so a transient failure may be retried within the deadline.
  for (let tries = 1; ; tries++) {
    const response = await deps.http.postJson('/api/embed', body, signal);
    if (response.ok) return validate(response.value, snapshot, texts.length);
    if (!isTransient(response.error) || tries >= deps.retry.maxAttempts || signal.aborted)
      return response;
    await deps.sleep(deps.retry.backoffMs, signal);
    if (signal.aborted) return err(abortError(signal));
  }
};
