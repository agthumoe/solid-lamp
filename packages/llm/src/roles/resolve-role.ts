import { err, ok, type ModelsConfig, type Result, type RoleName } from '@aetherion/shared';

import { inferenceError, type InferenceError } from '../errors.ts';

export type GenerationRole = Exclude<RoleName, 'embed'>;

export type SamplingOptions = {
  readonly temperature?: number;
  readonly top_p?: number;
  readonly top_k?: number;
  readonly repeat_penalty?: number;
  readonly seed?: number;
};

// Immutable identity captured at enqueue time and recorded with the run.
export type GenerationSnapshot = {
  readonly kind: 'generation';
  readonly role: GenerationRole;
  readonly model: string;
  readonly numCtx: number;
  readonly think: boolean;
  readonly options: SamplingOptions;
};

export type EmbedSnapshot = {
  readonly kind: 'embed';
  readonly role: 'embed';
  readonly model: string;
  readonly numCtx: number;
  readonly dimensions: number;
  readonly queryPrefix: string;
  readonly documentPrefix: string;
};

const SAMPLING_KEYS = ['temperature', 'top_p', 'top_k', 'repeat_penalty', 'seed'] as const;

export const resolveGenerationRole = (
  config: ModelsConfig,
  role: GenerationRole,
): Result<GenerationSnapshot, InferenceError> => {
  const bound = config.roles[role];
  if (!bound) return err(inferenceError('INFERENCE_UNAVAILABLE', `role ${role} is not bound`));
  const options: Record<string, number> = {};
  for (const key of SAMPLING_KEYS) {
    const value = bound[key];
    if (value !== undefined) options[key] = value;
  }
  return ok(
    Object.freeze({
      kind: 'generation',
      role,
      model: bound.model,
      numCtx: bound.num_ctx,
      think: bound.think,
      options: Object.freeze(options),
    }),
  );
};

export const resolveEmbedRole = (config: ModelsConfig): EmbedSnapshot => {
  const bound = config.roles.embed;
  return Object.freeze({
    kind: 'embed',
    role: 'embed',
    model: bound.model,
    numCtx: bound.num_ctx,
    dimensions: bound.dimensions,
    queryPrefix: bound.query_prefix,
    documentPrefix: bound.document_prefix,
  });
};
