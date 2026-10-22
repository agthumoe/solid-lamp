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

const isPrivateRedisUrl = (value: string): boolean => {
  if (!URL.canParse(value)) return false;
  const url = new URL(value);
  return url.protocol === 'redis:' && isPrivateHost(url.hostname);
};

const workerEnvSchema = z
  .object({
    AETHERION_REDIS_URL: z.preprocess(
      emptyAsUndefined,
      z
        .string()
        .refine(isPrivateRedisUrl, 'must be redis:// on loopback or Tailscale')
        .default('redis://127.0.0.1:6379'),
    ),
    AETHERION_WORKER_HOST: z.preprocess(
      emptyAsUndefined,
      z.string().refine(isPrivateHost, 'must be loopback or Tailscale').default('127.0.0.1'),
    ),
    AETHERION_WORKER_PORT: z.preprocess(
      emptyAsUndefined,
      z.coerce.number().int().min(1024).max(65_535).default(4400),
    ),
    AETHERION_WORKER_CONCURRENCY: z.preprocess(
      emptyAsUndefined,
      z.coerce.number().int().min(1).max(8).default(1),
    ),
    // Ingestion (#139): Postgres and the inference process together. Without them the handlers
    // stay NOT_WIRED and nothing is read.
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
    AETHERION_INFERENCE_SECRET: z.preprocess(
      emptyAsUndefined,
      z.string().min(32).max(256).optional(),
    ),
    // Watch enabled sources for changes (default on); resync still runs without it.
    AETHERION_WORKER_WATCH: z.preprocess(
      emptyAsUndefined,
      z.enum(['true', 'false']).default('true'),
    ),
  })
  .refine(
    (env) =>
      (env.AETHERION_DATABASE_URL === undefined) === (env.AETHERION_INFERENCE_SECRET === undefined),
    {
      path: ['AETHERION_INFERENCE_SECRET'],
      message: 'ingestion needs both AETHERION_DATABASE_URL and AETHERION_INFERENCE_SECRET',
    },
  );

export type WorkerConfig = EnvConfig & {
  readonly redisUrl: string;
  readonly host: string;
  readonly port: number;
  readonly concurrency: number;
  readonly ingestion:
    | {
        readonly databaseUrl: string;
        readonly inferenceUrl: string;
        readonly inferenceSecret: string;
        readonly watch: boolean;
      }
    | undefined;
};

// Errors name keys only: the Redis and database URLs and the inference secret are credentials.
export const loadWorkerConfig = (
  env: Readonly<Record<string, string | undefined>>,
): Result<WorkerConfig, AppError<'VALIDATION_FAILED'>> => {
  const shared = loadEnvConfig(env);
  if (!shared.ok) return shared;
  const parsed = workerEnvSchema.safeParse(env);
  if (!parsed.success) {
    const keys = [...new Set(parsed.error.issues.map((issue) => issue.path.join('.')))];
    return err(appError('VALIDATION_FAILED', `invalid environment: ${keys.join(', ')}`));
  }
  return ok({
    ...shared.value,
    redisUrl: parsed.data.AETHERION_REDIS_URL,
    host: parsed.data.AETHERION_WORKER_HOST,
    port: parsed.data.AETHERION_WORKER_PORT,
    concurrency: parsed.data.AETHERION_WORKER_CONCURRENCY,
    ingestion:
      parsed.data.AETHERION_DATABASE_URL && parsed.data.AETHERION_INFERENCE_SECRET
        ? {
            databaseUrl: parsed.data.AETHERION_DATABASE_URL,
            inferenceUrl: parsed.data.AETHERION_INFERENCE_URL,
            inferenceSecret: parsed.data.AETHERION_INFERENCE_SECRET,
            watch: parsed.data.AETHERION_WORKER_WATCH === 'true',
          }
        : undefined,
  });
};
