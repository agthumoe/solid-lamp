import { readFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';

import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

import { appError, type AppError } from '../errors.ts';
import { err, ok, type Result } from '../result.ts';

// Ingestion sources (#88, docs/specs/source-boundary.md). Real roots come from the
// environment so no private path is committed; every source is off unless enabled.

const segment = z
  .string()
  .min(1)
  .max(255)
  .refine((value) => !/[/\\\0]/.test(value) && value !== '.' && value !== '..', 'path segment');

const repoPath = z
  .string()
  .min(1)
  .max(1024)
  .refine(
    (value) =>
      !isAbsolute(value) &&
      !value.includes('\\') &&
      !value.includes('\0') &&
      value.split('/').every((part) => part !== '..' && part !== ''),
    'must be a relative path inside the repository',
  );

const sourceSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{1,31}$/),
  kind: z.enum(['obsidian']),
  root: z.union([
    z.strictObject({ env: z.string().regex(/^AETHERION_[A-Z0-9_]{1,64}$/) }),
    z.strictObject({ repo_path: repoPath }),
  ]),
  enabled: z.boolean().default(false),
  include_extensions: z
    .array(z.string().regex(/^\.[a-z0-9]{1,10}$/))
    .min(1)
    .default(['.md']),
  exclude_dirs: z.array(segment).default(['.obsidian', '.trash', 'AI-Inbox']),
  max_file_bytes: z
    .int()
    .min(1)
    .max(16 * 1024 * 1024)
    .default(2 * 1024 * 1024),
});

const sourcesConfigSchema = z
  .strictObject({ sources: z.array(sourceSchema).max(32) })
  .superRefine((config, ctx) => {
    const ids = new Set<string>();
    config.sources.forEach((source, index) => {
      if (ids.has(source.id))
        ctx.addIssue({ code: 'custom', message: 'duplicate id', path: ['sources', index, 'id'] });
      ids.add(source.id);
    });
  });

export type SourcesConfig = z.infer<typeof sourcesConfigSchema>;
export type SourceConfig = SourcesConfig['sources'][number];

export const parseSourcesConfig = (
  text: string,
): Result<SourcesConfig, AppError<'VALIDATION_FAILED'>> => {
  let raw: unknown;
  try {
    raw = parseYaml(text);
  } catch {
    return err(appError('VALIDATION_FAILED', 'sources.yaml is not valid YAML'));
  }
  const parsed = sourcesConfigSchema.safeParse(raw);
  if (parsed.success) return ok(parsed.data);
  const paths = parsed.error.issues
    .slice(0, 5)
    .map((issue) => `${issue.path.join('.') || '<root>'} ${issue.message}`);
  return err(appError('VALIDATION_FAILED', `invalid sources.yaml: ${paths.join('; ')}`));
};

export const loadSourcesConfig = async (
  path: string,
): Promise<Result<SourcesConfig, AppError<'VALIDATION_FAILED' | 'NOT_FOUND'>>> => {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch {
    return err(appError('NOT_FOUND', 'sources.yaml not found'));
  }
  return parseSourcesConfig(text);
};

/** Absolute root for a source. Errors name the key, never the (private) value. */
export const resolveSourceRoot = (
  source: SourceConfig,
  env: Readonly<Record<string, string | undefined>>,
  repoRoot: string,
): Result<string, AppError<'VALIDATION_FAILED'>> => {
  if ('env' in source.root) {
    const value = env[source.root.env];
    if (!value) return err(appError('VALIDATION_FAILED', `${source.root.env} is not set`));
    if (!isAbsolute(value) || value.includes('\0'))
      return err(appError('VALIDATION_FAILED', `${source.root.env} must be an absolute path`));
    return ok(resolve(value));
  }
  const root = resolve(repoRoot, source.root.repo_path);
  const inside = relative(resolve(repoRoot), root);
  if (!inside || inside.startsWith('..') || isAbsolute(inside))
    return err(
      appError('VALIDATION_FAILED', `source ${source.id} repo_path escapes the repository`),
    );
  return ok(root);
};
