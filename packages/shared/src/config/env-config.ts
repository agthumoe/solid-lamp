import { z } from 'zod';

import { appError, type AppError } from '../errors.ts';
import { err, ok, type Result } from '../result.ts';
import { isPrivateHttpUrl } from './private-host.ts';

const emptyAsUndefined = (value: unknown) => (value === '' ? undefined : value);

export const envConfigSchema = z.object({
  AETHERION_CONFIG_DIR: z.preprocess(emptyAsUndefined, z.string().min(1).default('config')),
  AETHERION_LOG_LEVEL: z.preprocess(
    emptyAsUndefined,
    z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  ),
  AETHERION_OLLAMA_URL: z.preprocess(
    emptyAsUndefined,
    z.url().refine(isPrivateHttpUrl, 'must be a loopback or Tailscale URL').optional(),
  ),
});

export type EnvConfig = {
  readonly configDir: string;
  readonly logLevel: 'debug' | 'info' | 'warn' | 'error';
  readonly ollamaUrl?: string;
};

// Only AETHERION_* keys are read; values never appear in the error (they may be secrets later).
export const loadEnvConfig = (
  env: Readonly<Record<string, string | undefined>>,
): Result<EnvConfig, AppError<'VALIDATION_FAILED'>> => {
  const parsed = envConfigSchema.safeParse(env);
  if (!parsed.success) {
    const keys = [...new Set(parsed.error.issues.map((issue) => issue.path.join('.')))];
    return err(appError('VALIDATION_FAILED', `invalid environment: ${keys.join(', ')}`));
  }
  const { AETHERION_CONFIG_DIR, AETHERION_LOG_LEVEL, AETHERION_OLLAMA_URL } = parsed.data;
  return ok({
    configDir: AETHERION_CONFIG_DIR,
    logLevel: AETHERION_LOG_LEVEL,
    ...(AETHERION_OLLAMA_URL === undefined ? {} : { ollamaUrl: AETHERION_OLLAMA_URL }),
  });
};
