import {
  appError,
  err,
  isPrivateHost,
  isPrivateHttpUrl,
  loadEnvConfig,
  ok,
  type AppError,
  type EnvConfig,
  type Result,
} from '@aetherion/shared';
import { z } from 'zod';

const emptyAsUndefined = (value: unknown) => (value === '' ? undefined : value);

const isPrivatePostgresUrl = (value: string): boolean => {
  if (!URL.canParse(value)) return false;
  const url = new URL(value);
  return ['postgres:', 'postgresql:'].includes(url.protocol) && isPrivateHost(url.hostname);
};

const apiEnvSchema = z
  .object({
    AETHERION_API_HOST: z.preprocess(
      emptyAsUndefined,
      z.string().refine(isPrivateHost, 'must be loopback or Tailscale').default('127.0.0.1'),
    ),
    AETHERION_API_PORT: z.preprocess(
      emptyAsUndefined,
      z.coerce.number().int().min(1024).max(65_535).default(4000),
    ),
    // Optional until Supabase runs locally; readiness reports `not_configured` without it.
    AETHERION_DATABASE_URL: z.preprocess(
      emptyAsUndefined,
      z
        .string()
        .refine(isPrivatePostgresUrl, 'must be a loopback or Tailscale Postgres URL')
        .optional(),
    ),
    AETHERION_INFERENCE_URL: z.preprocess(
      emptyAsUndefined,
      z
        .url()
        .refine(isPrivateHttpUrl, 'must be loopback or Tailscale')
        .default('http://127.0.0.1:4100'),
    ),
    AETHERION_INFERENCE_SECRET: z.string().min(32).max(256),
    // Brain routes (service-only until Phase 3 owner auth). Absent means they fail closed.
    AETHERION_BRAIN_SERVICE_KEY: z.preprocess(
      emptyAsUndefined,
      z.string().min(32).max(256).optional(),
    ),
  })
  .refine((env) => env.AETHERION_BRAIN_SERVICE_KEY !== env.AETHERION_INFERENCE_SECRET, {
    path: ['AETHERION_BRAIN_SERVICE_KEY'],
    message: 'must differ from the inference secret',
  });

export type ApiConfig = EnvConfig & {
  readonly host: string;
  readonly port: number;
  readonly databaseUrl: string | undefined;
  readonly inferenceUrl: string;
  readonly inferenceSecret: string;
  readonly brainServiceKey: string | undefined;
};

// Errors name keys only: the database URL, inference secret and service key are credentials.
export const loadApiConfig = (
  env: Readonly<Record<string, string | undefined>>,
): Result<ApiConfig, AppError<'VALIDATION_FAILED'>> => {
  const shared = loadEnvConfig(env);
  if (!shared.ok) return shared;
  const parsed = apiEnvSchema.safeParse(env);
  if (!parsed.success) {
    const keys = [...new Set(parsed.error.issues.map((issue) => issue.path.join('.')))];
    return err(appError('VALIDATION_FAILED', `invalid environment: ${keys.join(', ')}`));
  }
  const data = parsed.data;
  return ok({
    ...shared.value,
    host: data.AETHERION_API_HOST,
    port: data.AETHERION_API_PORT,
    databaseUrl: data.AETHERION_DATABASE_URL,
    inferenceUrl: data.AETHERION_INFERENCE_URL,
    inferenceSecret: data.AETHERION_INFERENCE_SECRET,
    brainServiceKey: data.AETHERION_BRAIN_SERVICE_KEY,
  });
};
