import {
  appError,
  err,
  loadEnvConfig,
  ok,
  type AppError,
  type EnvConfig,
  type Result,
} from '@aetherion/shared';
import { z } from 'zod';

const emptyAsUndefined = (value: unknown) => (value === '' ? undefined : value);

// Brain routes serve loopback peers only (docs/specs/brain-access.md), and the service key must
// never cross a network in clear text, so the api URL is loopback-only (not merely private).
const isLoopbackHttpUrl = (value: string): boolean => {
  if (!URL.canParse(value)) return false;
  const url = new URL(value);
  const host = url.hostname.replace(/^\[|\]$/g, '');
  return (
    url.protocol === 'http:' &&
    url.username === '' &&
    url.password === '' &&
    (host === 'localhost' || host === '::1' || /^127(?:\.\d{1,3}){3}$/.test(host))
  );
};

const mcpEnvSchema = z.object({
  AETHERION_API_URL: z.preprocess(
    emptyAsUndefined,
    z
      .string()
      .refine(isLoopbackHttpUrl, 'must be an http loopback URL')
      .default('http://127.0.0.1:4000'),
  ),
  AETHERION_BRAIN_SERVICE_KEY: z.string().min(32).max(256),
});

export type McpConfig = EnvConfig & { readonly apiUrl: string; readonly serviceKey: string };

// Errors name keys only: the service key is a credential.
export const loadMcpConfig = (
  env: Readonly<Record<string, string | undefined>>,
): Result<McpConfig, AppError<'VALIDATION_FAILED'>> => {
  const shared = loadEnvConfig(env);
  if (!shared.ok) return shared;
  const parsed = mcpEnvSchema.safeParse(env);
  if (!parsed.success) {
    const keys = [...new Set(parsed.error.issues.map((issue) => issue.path.join('.')))];
    return err(appError('VALIDATION_FAILED', `invalid environment: ${keys.join(', ')}`));
  }
  return ok({
    ...shared.value,
    apiUrl: parsed.data.AETHERION_API_URL,
    serviceKey: parsed.data.AETHERION_BRAIN_SERVICE_KEY,
  });
};
