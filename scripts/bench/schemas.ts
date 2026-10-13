import { z } from 'zod';

export const privateUrlSchema = z.url().refine((value) => {
  const url = new URL(value);
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const octets = host.split('.').map(Number);
  const tailscale =
    octets.length === 4 &&
    octets.every((n) => Number.isInteger(n) && n >= 0 && n <= 255) &&
    octets[0] === 100 &&
    octets[1] !== undefined &&
    octets[1] >= 64 &&
    octets[1] <= 127;
  return (
    ['http:', 'https:'].includes(url.protocol) &&
    !url.username &&
    !url.password &&
    !url.search &&
    !url.hash &&
    (['localhost', '127.0.0.1', '::1'].includes(host) ||
      tailscale ||
      host.startsWith('fd7a:115c:a1e0:'))
  );
}, 'expected a credential-free loopback or Tailscale endpoint');
const roleSchema = z.strictObject({
  model: z.string().min(1),
  num_ctx: z.number().int().positive(),
  think: z.boolean().default(false),
  query_prefix: z.string().optional(),
  dimensions: z.number().int().positive().optional(),
  residency: z.enum(['resident', 'on_demand', 'swap', 'shared', 'batch_only']),
  temperature: z.number().min(0).max(2).optional(),
});
export const modelsSchema = z
  .strictObject({
    ollama: z.strictObject({ base_url: privateUrlSchema, openai_base_url: privateUrlSchema }),
    roles: z.strictObject({
      chat: roleSchema,
      router: roleSchema,
      coder: roleSchema,
      embed: roleSchema.extend({ dimensions: z.number().int().positive() }),
      vision: roleSchema,
    }),
    fallbacks: z.strictObject({
      chat: z.array(z.string().min(1)),
      embed: z.array(z.string().min(1)),
    }),
    fallback_embedding_options: z.record(
      z.string(),
      z.strictObject({
        dimensions: z.number().int().positive(),
        num_ctx: z.number().int().positive(),
        query_prefix: z.string(),
        document_prefix: z.string(),
      }),
    ),
  })
  .superRefine((config, context) => {
    for (const model of config.fallbacks.embed)
      if (!config.fallback_embedding_options[model]) {
        context.addIssue({
          code: 'custom',
          message: 'embedding fallback requires explicit options',
          path: ['fallback_embedding_options', model],
        });
      }
  });
export type JsonSchema = {
  description?: string | undefined;
  type?: string | undefined;
  properties?: Record<string, JsonSchema> | undefined;
  required?: string[] | undefined;
  enum?: unknown[] | undefined;
  items?: JsonSchema | undefined;
};
export const jsonSchema: z.ZodType<JsonSchema> = z.lazy(() =>
  z.strictObject({
    description: z.string().optional(),
    type: z.enum(['object', 'array', 'integer', 'number', 'string', 'boolean']).optional(),
    properties: z.record(z.string(), jsonSchema).optional(),
    required: z.array(z.string()).optional(),
    enum: z.array(z.unknown()).optional(),
    items: jsonSchema.optional(),
  }),
);
const expectedCallSchema = z.strictObject({
  name: z.string().min(1),
  args: z.record(z.string(), z.unknown()),
});
export const toolsFixtureSchema = z.strictObject({
  system: z.string().min(1),
  tools: z
    .array(
      z.strictObject({
        type: z.literal('function'),
        function: z.strictObject({
          name: z.string().min(1),
          description: z.string(),
          parameters: jsonSchema,
        }),
      }),
    )
    .min(1),
  cases: z
    .array(z.strictObject({ prompt: z.string().min(1), expect: expectedCallSchema.nullable() }))
    .min(1),
});
export const brainFixtureSchema = z
  .strictObject({
    _comment: z.string().optional(),
    notes: z.array(z.strictObject({ path: z.string().min(1), text: z.string().min(1) })).min(1),
    questions: z
      .array(
        z.strictObject({
          q: z.string().min(1),
          source: z.string().nullable(),
          keywords: z.array(z.string()),
        }),
      )
      .min(1),
  })
  .superRefine((fixture, context) => {
    const paths = new Set(fixture.notes.map((note) => note.path));
    if (paths.size !== fixture.notes.length)
      context.addIssue({ code: 'custom', message: 'duplicate note path' });
    for (const question of fixture.questions)
      if (question.source && !paths.has(question.source)) {
        context.addIssue({ code: 'custom', message: 'question references missing source' });
      }
    if (
      !fixture.questions.some((q) => q.source !== null) ||
      !fixture.questions.some((q) => q.source === null)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'include answerable and unanswerable questions',
      });
    }
  });
export const toolCallSchema = z.strictObject({
  name: z.string().trim().min(1),
  arguments: z.record(z.string(), z.unknown()),
});
export const messageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant', 'tool']),
  content: z.string(),
  thinking: z.string().optional(),
  tool_calls: z.array(z.object({ function: toolCallSchema })).optional(),
});
const metric = z.number().finite().nonnegative();
export const chatFinalSchema = z.object({
  message: messageSchema,
  total_duration: metric,
  load_duration: metric,
  prompt_eval_count: metric,
  prompt_eval_duration: metric,
  eval_count: metric,
  eval_duration: metric,
});
export const streamMessageSchema = z.object({
  message: messageSchema.optional(),
  done: z.boolean(),
  error: z.string().optional(),
});
export const psSchema = z.object({
  models: z.array(
    z.object({
      name: z.string().min(1),
      size: metric,
      size_vram: metric,
      context_length: z.number().int().positive().optional(),
      expires_at: z.string().optional(),
    }),
  ),
});
export const versionSchema = z.object({ version: z.string().min(1) });
export const showSchema = z.object({
  capabilities: z.array(z.string()).optional(),
  details: z.record(z.string(), z.unknown()).optional(),
});
