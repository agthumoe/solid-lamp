import {
  appError,
  err,
  isPrivateHost,
  loadEnvConfig,
  ok,
  type AppError,
  type EnvConfig,
  type Result,
} from '@aetherion/shared';
import { z } from 'zod';

const emptyAsUndefined = (value: unknown) => (value === '' ? undefined : value);

const inferenceEnvSchema = z.object({
  // Shared with api/worker through .env; never logged, never in config YAML.
  AETHERION_INFERENCE_SECRET: z.string().min(32).max(256),
  AETHERION_INFERENCE_HOST: z.preprocess(
    emptyAsUndefined,
    z.string().refine(isPrivateHost, 'must be loopback or Tailscale').default('127.0.0.1'),
  ),
  AETHERION_INFERENCE_PORT: z.preprocess(
    emptyAsUndefined,
    z.coerce.number().int().min(1024).max(65_535).default(4100),
  ),
});

export type InferenceConfig = EnvConfig & {
  readonly secret: string;
  readonly host: string;
  readonly port: number;
};

// Extends the shared env loader; errors name keys only because values may be secrets.
export const loadInferenceConfig = (
  env: Readonly<Record<string, string | undefined>>,
): Result<InferenceConfig, AppError<'VALIDATION_FAILED'>> => {
  const shared = loadEnvConfig(env);
  if (!shared.ok) return shared;
  const parsed = inferenceEnvSchema.safeParse(env);
  if (!parsed.success) {
    const keys = [...new Set(parsed.error.issues.map((issue) => issue.path.join('.')))];
    return err(appError('VALIDATION_FAILED', `invalid environment: ${keys.join(', ')}`));
  }
  return ok({
    ...shared.value,
    secret: parsed.data.AETHERION_INFERENCE_SECRET,
    host: parsed.data.AETHERION_INFERENCE_HOST,
    port: parsed.data.AETHERION_INFERENCE_PORT,
  });
};
