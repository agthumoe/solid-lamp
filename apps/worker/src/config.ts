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

const isPrivateRedisUrl = (value: string): boolean => {
  if (!URL.canParse(value)) return false;
  const url = new URL(value);
  return url.protocol === 'redis:' && isPrivateHost(url.hostname);
};

const workerEnvSchema = z.object({
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
});

export type WorkerConfig = EnvConfig & {
  readonly redisUrl: string;
  readonly host: string;
  readonly port: number;
  readonly concurrency: number;
};

// Errors name keys only: the Redis URL may carry a password.
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
  });
};
