import { err, ok, type ModelsConfig, type Result } from '@aetherion/shared';

import { inferenceError, type InferenceError } from '../errors.ts';
import {
  resolveEmbedRole,
  resolveGenerationRole,
  type EmbedSnapshot,
  type GenerationRole,
  type GenerationSnapshot,
} from '../roles/resolve-role.ts';
import type { GateRunOptions, LlmGate } from './llm-gate.ts';

export type ScheduleDeps = {
  readonly gate: LlmGate;
  // Current validated config; a reload swaps what this returns, never mutates a snapshot.
  readonly config: () => ModelsConfig;
};

export type CallOptions = Omit<GateRunOptions, 'label'>;

// Resolves the role at enqueue time so queued work keeps the identity it was admitted with.
export const scheduleGeneration = <T>(
  deps: ScheduleDeps,
  role: GenerationRole,
  options: CallOptions,
  execute: (
    snapshot: GenerationSnapshot,
    signal: AbortSignal,
  ) => Promise<Result<T, InferenceError>>,
): Promise<Result<T & { readonly snapshot: GenerationSnapshot }, InferenceError>> => {
  const resolved = resolveGenerationRole(deps.config(), role);
  if (!resolved.ok) return Promise.resolve(err(resolved.error));
  const snapshot = resolved.value;
  return deps.gate.run(
    async (signal) => {
      const result = await execute(snapshot, signal);
      return result.ok ? ok({ ...result.value, snapshot }) : result;
    },
    { ...options, label: role },
  );
};

/**
 * Embeds in bounded batches, each admitted to the gate separately, so interactive work
 * queued meanwhile runs between batches. Stops at the first failed batch.
 */
export const embedInBatches = async (
  deps: ScheduleDeps,
  texts: readonly string[],
  batchSize: number,
  options: CallOptions,
  embedBatch: (
    snapshot: EmbedSnapshot,
    batch: readonly string[],
    signal: AbortSignal,
  ) => Promise<Result<number[][], InferenceError>>,
): Promise<Result<{ vectors: number[][]; snapshot: EmbedSnapshot }, InferenceError>> => {
  if (!Number.isInteger(batchSize) || batchSize < 1) throw new RangeError('batchSize must be ≥ 1');
  const snapshot = resolveEmbedRole(deps.config());
  const vectors: number[][] = [];
  for (let start = 0; start < texts.length; start += batchSize) {
    const batch = texts.slice(start, start + batchSize);
    const result = await deps.gate.run((signal) => embedBatch(snapshot, batch, signal), {
      ...options,
      label: 'embed',
    });
    if (!result.ok) return result;
    if (result.value.length !== batch.length)
      return err(inferenceError('INVALID_RESPONSE', 'embedding count does not match batch size'));
    vectors.push(...result.value);
  }
  return ok({ vectors, snapshot });
};
