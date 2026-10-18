import { readFile } from 'node:fs/promises';

import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

import { appError, type AppError } from '../errors.ts';
import { err, ok, type Result } from '../result.ts';
import { ROLE_NAMES, type ModelsConfig, type RoleName } from './models-config.ts';

// Planned domain roles appear only in evidence scopes until Phase 7 binds them (ADR 0004).
export const DOMAIN_ROLES = [
  'knowledge',
  'legal-research',
  'financial-analysis',
  'accounting',
] as const;
const scopeSchema = z.enum([...ROLE_NAMES, ...DOMAIN_ROLES]);

const modelTag = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-z0-9][a-z0-9._/-]*(?::[a-z0-9._-]+)?$/);

// A repo-relative path or an https link; never free text that could carry private content.
const evidenceRef = z
  .string()
  .max(300)
  .regex(/^(?:https:\/\/\S+|(?:docs|config|evals)\/[\w./-]+)$/);

const evidenceSchema = z.strictObject({
  kind: z.enum([
    'gpu_context',
    'tool_calling',
    'task_quality',
    'license',
    'provenance',
    'owner_acceptance',
  ]),
  status: z.enum(['pending', 'passed', 'failed', 'revoked']),
  scope: z.array(scopeSchema).min(1),
  ref: evidenceRef,
});

const recordSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{1,63}$/),
  tag: modelTag.nullable(),
  digest: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .nullable(),
  upstream: z.string().min(1).max(200),
  state: z.enum(['candidate', 'evaluating', 'enabled', 'disabled']),
  // The owner keeps every model; unloading or disabling is never deletion.
  retained: z.literal(true),
  capabilities: z.array(z.enum(['text', 'vision', 'tools', 'thinking', 'embedding'])).min(1),
  dimensions: z.int().min(1).max(8192).optional(),
  roles: z.array(z.enum(ROLE_NAMES)),
  disabled_reason: z.string().min(1).max(300).optional(),
  evidence: z.array(evidenceSchema),
});

export type CatalogRecord = z.infer<typeof recordSchema>;

export const canonicalTag = (tag: string): string => (tag.includes(':') ? tag : `${tag}:latest`);

const catalogSchema = z
  .strictObject({ revision: z.int().positive(), models: z.array(recordSchema).min(1) })
  .superRefine((catalog, ctx) => {
    const ids = new Set<string>();
    const tags = new Set<string>();
    catalog.models.forEach((record, index) => {
      const issue = (message: string, key?: string) =>
        ctx.addIssue({
          code: 'custom',
          message,
          path: key ? ['models', index, key] : ['models', index],
        });
      if (ids.has(record.id)) issue('duplicate id', 'id');
      ids.add(record.id);
      if (record.tag) {
        const tag = canonicalTag(record.tag);
        if (tags.has(tag)) issue('duplicate tag', 'tag');
        tags.add(tag);
      }
      if (record.state === 'enabled' && (!record.tag || !record.digest))
        issue('enabled records need a tag and digest', 'digest');
      if (record.state === 'disabled' && !record.disabled_reason)
        issue('disabled records need a reason', 'disabled_reason');
      const embedding = record.capabilities.includes('embedding');
      if (embedding !== (record.dimensions !== undefined))
        issue('embedding records, and only those, declare dimensions', 'dimensions');
    });
  });

export type ModelCatalog = z.infer<typeof catalogSchema>;

const issuesMessage = (prefix: string, paths: string[]) =>
  `${prefix}: ${paths.slice(0, 5).join('; ')}${paths.length > 5 ? ` (+${paths.length - 5} more)` : ''}`;

export const parseCatalog = (text: string): Result<ModelCatalog, AppError<'VALIDATION_FAILED'>> => {
  let raw: unknown;
  try {
    raw = parseYaml(text);
  } catch {
    return err(appError('VALIDATION_FAILED', 'catalog.yaml is not valid YAML'));
  }
  const parsed = catalogSchema.safeParse(raw);
  if (parsed.success) return ok(parsed.data);
  const paths = parsed.error.issues.map(
    (issue) => `${issue.path.join('.') || '<root>'} ${issue.message}`,
  );
  return err(appError('VALIDATION_FAILED', issuesMessage('invalid catalog', paths)));
};

export const loadCatalog = async (
  path: string,
): Promise<Result<ModelCatalog, AppError<'VALIDATION_FAILED' | 'NOT_FOUND'>>> => {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch {
    return err(appError('NOT_FOUND', 'catalog.yaml not found'));
  }
  return parseCatalog(text);
};

const capabilityFor = (role: RoleName) =>
  role === 'embed' ? 'embedding' : role === 'vision' ? 'vision' : 'text';

// Why a record cannot serve a role, or undefined when it can.
const unfit = (record: CatalogRecord | undefined, role: RoleName): string | undefined => {
  if (!record) return 'not in the catalog';
  if (record.state !== 'enabled') return `catalog record ${record.id} is ${record.state}`;
  if (!record.roles.includes(role)) return `${record.id} is not accepted for ${role}`;
  if (!record.capabilities.includes(capabilityFor(role)))
    return `${record.id} lacks ${capabilityFor(role)} capability`;
  const scoped = record.evidence.filter((entry) => entry.scope.includes(role));
  if (scoped.some((entry) => entry.status === 'failed' || entry.status === 'revoked'))
    return `${record.id} has failed or revoked evidence for ${role}`;
  if (!scoped.some((entry) => entry.kind === 'gpu_context' && entry.status === 'passed'))
    return `${record.id} has no passed gpu_context evidence for ${role}`;
  return undefined;
};

/**
 * Every bound role and fallback must resolve to an enabled catalog record accepted for that
 * role, with the right capability and passed scoped evidence. A contradiction is a config
 * error: callers refuse the whole config rather than routing around it.
 */
export const validateBindings = (
  models: ModelsConfig,
  catalog: ModelCatalog,
): Result<void, AppError<'VALIDATION_FAILED'>> => {
  const byTag = new Map(
    catalog.models.flatMap((record) => (record.tag ? [[canonicalTag(record.tag), record]] : [])),
  );
  const problems: string[] = [];
  for (const role of ROLE_NAMES) {
    const binding = models.roles[role];
    if (!binding) continue;
    const record = byTag.get(canonicalTag(binding.model));
    const reason = unfit(record, role);
    if (reason) problems.push(`roles.${role} (${binding.model}): ${reason}`);
    else if (role === 'embed' && record?.dimensions !== models.roles.embed.dimensions)
      problems.push(`roles.embed: dimensions differ from catalog record ${record?.id}`);
  }
  for (const [role, tags] of Object.entries(models.fallbacks) as [RoleName, string[]][]) {
    const primary = models.roles[role]?.model;
    for (const tag of tags) {
      if (primary && canonicalTag(tag) === canonicalTag(primary)) {
        problems.push(`fallbacks.${role} (${tag}): a model cannot be its own fallback`);
        continue;
      }
      const record = byTag.get(canonicalTag(tag));
      const reason = unfit(record, role);
      if (reason) problems.push(`fallbacks.${role} (${tag}): ${reason}`);
      else if (
        role === 'embed' &&
        record?.dimensions !== models.fallback_embedding_options[tag]?.dimensions
      )
        problems.push(`fallbacks.embed (${tag}): dimensions differ from catalog`);
    }
  }
  return problems.length
    ? err(appError('VALIDATION_FAILED', issuesMessage('binding invalid', problems)))
    : ok(undefined);
};
