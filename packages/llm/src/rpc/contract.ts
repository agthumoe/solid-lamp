import { z } from 'zod';

import { INFERENCE_ERROR_CODES, type InferenceErrorCode } from '../errors.ts';

// Internal loopback RPC between api/worker and apps/inference (ADR 0005). Callers name a
// role, never a model tag; the server resolves and snapshots it at enqueue time.

export const INFERENCE_KEY_HEADER = 'x-aetherion-inference-key';

// Opaque embedding-profile IDs (see roles/embed-profile.ts).
export const EMBEDDING_PROFILE_ID = /^ep-[0-9a-f]{24}$/;

export const RPC_PATHS = {
  generate: '/v1/generate',
  stream: '/v1/stream',
  embed: '/v1/embed',
  embedProfiles: '/v1/embed-profiles',
  ready: '/readyz',
  live: '/livez',
} as const;

const MAX_MESSAGES = 256;
const MAX_CONTENT_CHARS = 512_000;

const callFields = {
  priority: z.enum(['interactive', 'background']),
  deadline: z.iso.datetime({ offset: true }),
  runId: z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,64}$/)
    .optional(),
};

const toolCallSchema = z.strictObject({
  function: z.strictObject({ name: z.string().min(1).max(128), arguments: z.unknown() }),
});

export const chatMessageSchema = z.strictObject({
  role: z.enum(['system', 'user', 'assistant', 'tool']),
  content: z.string().max(MAX_CONTENT_CHARS),
  images: z.array(z.base64().max(20_000_000)).max(8).optional(),
  tool_calls: z.array(toolCallSchema).max(8).optional(),
  tool_name: z.string().min(1).max(128).optional(),
});

export const chatToolSchema = z.strictObject({
  type: z.literal('function'),
  function: z.strictObject({
    name: z.string().regex(/^[A-Za-z0-9_.-]{1,128}$/),
    description: z.string().max(4000),
    parameters: z.record(z.string(), z.unknown()),
  }),
});

export const generateRequestSchema = z.strictObject({
  role: z.enum(['chat', 'router', 'coder', 'vision', 'deep']),
  messages: z.array(chatMessageSchema).min(1).max(MAX_MESSAGES),
  tools: z.array(chatToolSchema).max(64).optional(),
  think: z.boolean().optional(),
  ...callFields,
});

export const embedRequestSchema = z.strictObject({
  texts: z.array(z.string().max(MAX_CONTENT_CHARS)).max(256),
  kind: z.enum(['query', 'document']),
  // An approved embedding profile (ADR 0006). Omitted: the embed role's current profile.
  profileId: z.string().regex(EMBEDDING_PROFILE_ID).optional(),
  ...callFields,
});

export type ChatMessage = z.infer<typeof chatMessageSchema>;
export type ChatTool = z.infer<typeof chatToolSchema>;
export type GenerateRequest = z.infer<typeof generateRequestSchema>;
export type EmbedRequest = z.infer<typeof embedRequestSchema>;

const resolvedModelSchema = z.strictObject({
  role: z.string(),
  model: z.string(),
  numCtx: z.int().positive(),
});

const doneSchema = z.strictObject({
  type: z.literal('done'),
  finishReason: z.enum(['stop', 'length']),
  tokensIn: z.int().nonnegative(),
  tokensOut: z.int().nonnegative(),
  toolCalls: z.array(z.strictObject({ name: z.string(), arguments: z.unknown() })).readonly(),
  timings: z.strictObject({
    totalMs: z.number().nonnegative(),
    loadMs: z.number().nonnegative(),
    promptEvalMs: z.number().nonnegative(),
    evalMs: z.number().nonnegative(),
  }),
});

export const inferenceErrorSchema = z.strictObject({
  code: z.enum(INFERENCE_ERROR_CODES),
  message: z.string(),
});

export const streamEventSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('started'),
    model: resolvedModelSchema,
    queuedMs: z.number().nonnegative(),
  }),
  z.strictObject({ type: z.literal('token'), text: z.string() }),
  doneSchema,
  z.strictObject({ type: z.literal('error'), error: inferenceErrorSchema, partial: z.boolean() }),
]);

export const generateResponseSchema = z.strictObject({
  text: z.string(),
  model: resolvedModelSchema,
  done: doneSchema,
});

export const embeddingProfileSchema = z.strictObject({
  id: z.string().regex(EMBEDDING_PROFILE_ID),
  model: z.string().min(1).max(128),
  digest: z.string().regex(/^[0-9a-f]{64}$/),
  dimensions: z.int().positive(),
  numCtx: z.int().positive(),
  queryPrefix: z.string().max(1000),
  documentPrefix: z.string().max(1000),
});

export const embedProfilesResponseSchema = z.strictObject({
  // The embed role's profile, or null when its model is not installed.
  defaultProfileId: z.string().regex(EMBEDDING_PROFILE_ID).nullable(),
  profiles: z.array(embeddingProfileSchema).max(32),
});

export const embedResponseSchema = z.strictObject({
  vectors: z.array(z.array(z.number())),
  // The profile actually used, snapshotted at enqueue; callers compare it with their version.
  profile: embeddingProfileSchema,
  model: z.strictObject({
    model: z.string(),
    numCtx: z.int().positive(),
    dimensions: z.int().positive(),
  }),
  tokensIn: z.int().nonnegative(),
  totalMs: z.number().nonnegative(),
});

const gateMetricsSchema = z.strictObject({
  active: z.string().nullable(),
  queued: z.strictObject({ interactive: z.int().nonnegative(), background: z.int().nonnegative() }),
  oldestQueuedMs: z.number().nonnegative(),
  completed: z.int().nonnegative(),
  rejected: z.int().nonnegative(),
});

export const readinessSchema = z.strictObject({
  status: z.enum(['ready', 'not_ready']),
  ollama: z.enum(['ok', 'unavailable']),
  gate: gateMetricsSchema,
  residency: z.strictObject({
    coldLoads: z.int().nonnegative(),
    contextReloads: z.int().nonnegative(),
    evictions: z.int().nonnegative(),
    notResidentAfter: z.int().nonnegative(),
  }),
});

export type Readiness = z.infer<typeof readinessSchema>;
export type GenerateResponse = z.infer<typeof generateResponseSchema>;
export type EmbedResponse = z.infer<typeof embedResponseSchema>;
export type EmbedProfilesResponse = z.infer<typeof embedProfilesResponseSchema>;

// Request validation and auth failures are not inference outcomes; they get their own codes.
export const RPC_ERROR_CODES = [
  ...INFERENCE_ERROR_CODES,
  'VALIDATION_FAILED',
  'UNAUTHENTICATED',
  'NOT_FOUND',
  'INTERNAL',
] as const;
export type RpcErrorCode = (typeof RPC_ERROR_CODES)[number];

export const rpcErrorEnvelopeSchema = z.strictObject({
  error: z.strictObject({ code: z.enum(RPC_ERROR_CODES), message: z.string() }),
});

const STATUS: Record<RpcErrorCode, number> = {
  QUEUE_FULL: 429,
  DEADLINE_EXPIRED: 504,
  CANCELLED: 499,
  INFERENCE_UNAVAILABLE: 503,
  MODEL_NOT_LOADED: 503,
  INVALID_RESPONSE: 502,
  PROFILE_UNAVAILABLE: 409,
  VALIDATION_FAILED: 400,
  UNAUTHENTICATED: 401,
  NOT_FOUND: 404,
  INTERNAL: 500,
};

export const rpcStatusFor = (code: RpcErrorCode): number => STATUS[code];

export const isInferenceErrorCode = (code: string): code is InferenceErrorCode =>
  (INFERENCE_ERROR_CODES as readonly string[]).includes(code);
