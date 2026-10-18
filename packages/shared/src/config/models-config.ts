import { readFile } from 'node:fs/promises';

import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

import { appError, type AppError } from '../errors.ts';
import { err, ok, type Result } from '../result.ts';
import { isPrivateHttpUrl } from './private-host.ts';

export const ROLE_NAMES = ['chat', 'router', 'coder', 'embed', 'vision', 'deep'] as const;
export type RoleName = (typeof ROLE_NAMES)[number];

const modelTag = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-z0-9][a-z0-9._/-]*(?::[a-z0-9._-]+)?$/);
const privateUrl = z.url().refine(isPrivateHttpUrl, 'must be a loopback or Tailscale URL');
const numCtx = z.int().min(512).max(262_144);

const generationRoleSchema = z.strictObject({
  model: modelTag,
  num_ctx: numCtx,
  residency: z.enum(['resident', 'shared', 'batch_only']),
  think: z.boolean().default(false),
  temperature: z.number().min(0).max(2).optional(),
  top_p: z.number().gt(0).max(1).optional(),
  top_k: z.int().min(1).optional(),
  repeat_penalty: z.number().min(0).optional(),
  seed: z.int().optional(),
});

const embedRoleSchema = z.strictObject({
  model: modelTag,
  num_ctx: numCtx,
  residency: z.enum(['resident', 'shared', 'batch_only']),
  dimensions: z.int().min(1).max(8192),
  query_prefix: z.string().max(1000).default(''),
  document_prefix: z.string().max(1000).default(''),
});

const embeddingOptionSchema = embedRoleSchema.omit({ model: true, residency: true });

export const modelsConfigSchema = z
  .strictObject({
    ollama: z.strictObject({ base_url: privateUrl, openai_base_url: privateUrl.optional() }),
    roles: z.strictObject({
      chat: generationRoleSchema,
      router: generationRoleSchema,
      coder: generationRoleSchema,
      embed: embedRoleSchema,
      vision: generationRoleSchema.optional(),
      deep: generationRoleSchema.optional(),
    }),
    fallbacks: z.partialRecord(z.enum(ROLE_NAMES), z.array(modelTag).max(8)).default({}),
    fallback_embedding_options: z.record(modelTag, embeddingOptionSchema).default({}),
  })
  .superRefine((config, ctx) => {
    for (const role of Object.keys(config.fallbacks) as RoleName[]) {
      if (!config.roles[role])
        ctx.addIssue({ code: 'custom', path: ['fallbacks', role], message: 'role is not bound' });
    }
    // Embedding fallbacks need an explicit contract: they change dimensions (ADR 0002).
    for (const [index, tag] of (config.fallbacks.embed ?? []).entries()) {
      if (!config.fallback_embedding_options[tag])
        ctx.addIssue({
          code: 'custom',
          path: ['fallbacks', 'embed', index],
          message: 'embedding fallback lacks fallback_embedding_options',
        });
    }
  });

export type ModelsConfig = z.infer<typeof modelsConfigSchema>;
export type GenerationRoleConfig = z.infer<typeof generationRoleSchema>;
export type EmbedRoleConfig = z.infer<typeof embedRoleSchema>;

const describeIssues = (error: z.ZodError): string =>
  error.issues
    .slice(0, 5)
    .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
    .join('; ');

export const parseModelsConfig = (
  text: string,
): Result<ModelsConfig, AppError<'VALIDATION_FAILED'>> => {
  let raw: unknown;
  try {
    raw = parseYaml(text);
  } catch {
    return err(appError('VALIDATION_FAILED', 'models config is not valid YAML'));
  }
  const parsed = modelsConfigSchema.safeParse(raw);
  return parsed.success
    ? ok(parsed.data)
    : err(appError('VALIDATION_FAILED', `invalid models config: ${describeIssues(parsed.error)}`));
};

export const loadModelsConfig = async (
  path: string,
): Promise<Result<ModelsConfig, AppError<'VALIDATION_FAILED' | 'NOT_FOUND'>>> => {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch {
    return err(appError('NOT_FOUND', 'models config file could not be read'));
  }
  return parseModelsConfig(text);
};
