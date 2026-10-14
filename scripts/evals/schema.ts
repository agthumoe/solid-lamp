import { z } from 'zod';

const text = z.string().min(1);
const agent = z.enum(['knowledge', 'legal-us-tx', 'finance', 'accountant']);
const modelId = z.enum([
  'qwen-general',
  'qwen-router',
  'qwen-coder',
  'qwen-embed',
  'qwen-alternative',
  'gemma-alternative',
  'nomic-embed',
  'qwen-deep',
  'saul-legal',
  'fin-r1',
  'cpa-qwen',
]);
const request = z.strictObject({
  ownerAgent: text.nullable(),
  proposal: z.array(text),
  authenticated: z.boolean(),
  roleOverride: text.nullable(),
  writeRequested: z.boolean(),
  outputStarted: z.boolean(),
  cancelled: z.boolean(),
  remainingMs: z.number().finite().int().nonnegative(),
  attempts: z.number().int().nonnegative(),
  plan: z.array(text).nullable(),
});
const binding = z.strictObject({
  role: z.enum(['knowledge', 'legal-research', 'financial-analysis', 'accounting']),
  primary: modelId,
  profile: text,
  enabled: z.boolean(),
  fallbackEnabled: z.boolean(),
  fallback: modelId,
});
const model = z.strictObject({
  state: z.enum(['candidate', 'evaluating', 'enabled', 'disabled']),
  artifactResolved: z.boolean(),
  profileAccepted: z.boolean(),
  license: z.enum(['verified', 'unresolved', 'restricted']),
  evidenceRevoked: z.boolean(),
  domainAccepted: z.boolean(),
  capability: z.enum(['text', 'vision', 'embedding']),
  availability: z.enum(['ready', 'cold-loadable', 'unavailable']),
});
const retrieval = z.strictObject({
  required: z.boolean(),
  activeSpace: text,
  querySpace: text,
  activeDimensions: z.number().int().positive(),
  queryDimensions: z.number().int().positive(),
  embedAvailable: z.boolean(),
});
export const inputSchema = z.strictObject({
  request,
  allowedAgents: z.array(agent),
  enabledAgents: z.array(agent),
  bindings: z.partialRecord(agent, binding.nullable()),
  models: z.partialRecord(modelId, model),
  untrustedSourceText: z.string().nullable(),
  retrieval,
});
const patchSchema = z.strictObject({
  request: request.partial().optional(),
  allowedAgents: z.array(agent).optional(),
  enabledAgents: z.array(agent).optional(),
  bindings: z.partialRecord(agent, binding.partial().nullable()).optional(),
  models: z.partialRecord(modelId, model.partial()).optional(),
  untrustedSourceText: z.string().nullable().optional(),
  retrieval: retrieval.partial().optional(),
});
export const suiteSchema = z.strictObject({
  schemaVersion: z.literal(1),
  boundaryVersion: z.literal(1),
  kind: z.literal('golden-design-fixtures'),
  notice: text,
  defaults: inputSchema,
  cases: z
    .array(
      z.strictObject({
        id: z.string().regex(/^R[0-9]{2,}$/),
        description: text,
        inputPatch: patchSchema,
        expected: z.strictObject({
          kind: z.enum(['route', 'fallback', 'clarify', 'reject', 'partial-failure']),
          reason: text,
          agent: agent.nullable(),
          modelId: modelId.nullable(),
          attemptLimit: z.literal(2),
          writeAllowed: z.literal(false),
          steps: z.array(agent).optional(),
        }),
        coverage: z.array(text).min(1),
      }),
    )
    .min(20),
});
export type Input = z.infer<typeof inputSchema>;
export type Suite = z.infer<typeof suiteSchema>;
