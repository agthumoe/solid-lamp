// Minimal Ollama native-API client for the benchmark harness.
// The production client lives in packages/llm (Phase 1); this file stays dependency-free.

import { requiredAt } from '../lib/required-at.ts';
import { z } from 'zod';
import type { messageSchema } from './schemas.ts';
import {
  privateUrlSchema,
  psSchema,
  chatFinalSchema,
  streamMessageSchema,
  versionSchema,
  showSchema,
  toolCallSchema,
  type JsonSchema,
} from './schemas.ts';
export type { JsonSchema } from './schemas.ts';
export type PsModel = z.infer<typeof psSchema>['models'][number];
export type ChatMessage = z.infer<typeof messageSchema>;
export type ChatFinal = z.infer<typeof chatFinalSchema>;

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  tools?: unknown[];
  think?: boolean;
  options?: Record<string, unknown>;
  keep_alive?: string | number;
}

export interface StreamResult {
  final: ChatFinal;
  content: string;
  ttftMs: number; // wall clock from request start to first generated token (content or thinking)
  wallMs: number;
}

export class Ollama {
  readonly baseUrl: string;
  readonly timeoutMs: number;

  constructor(baseUrl: string, timeoutMs = REQUEST_TIMEOUT_MS) {
    this.baseUrl = privateUrlSchema.parse(baseUrl);
    this.timeoutMs = timeoutMs;
  }

  private async post(path: string, body: unknown): Promise<unknown> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!res.ok) throw new Error(`${path} ${res.status}: ${await res.text()}`);
    return res.json();
  }

  async version(): Promise<string> {
    const res = await fetch(`${this.baseUrl}/api/version`, {
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!res.ok) throw new Error(`/api/version ${res.status}: ${await res.text()}`);
    return versionSchema.parse(await res.json()).version;
  }

  async ps(): Promise<PsModel[]> {
    const res = await fetch(`${this.baseUrl}/api/ps`, {
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!res.ok) throw new Error(`/api/ps ${res.status}: ${await res.text()}`);
    return psSchema.parse(await res.json()).models;
  }

  async show(model: string): Promise<z.infer<typeof showSchema>> {
    return showSchema.parse(await this.post('/api/show', { model }));
  }

  async unload(model: string): Promise<void> {
    z.object({ done: z.literal(true) }).parse(
      await this.post('/api/generate', { model, keep_alive: 0 }),
    );
  }

  async unloadAll(): Promise<void> {
    for (const m of await this.ps()) await this.unload(m.name);
    // Eviction is async on the server side; wait until /api/ps is empty.
    for (let i = 0; i < 100; i++) {
      if ((await this.ps()).length === 0) return;
      await sleep(200);
    }
    throw new Error(
      `unloadAll: models still loaded after 20s: ${(await this.ps()).map((m) => m.name).join(', ')}`,
    );
  }

  async chat(req: ChatRequest): Promise<ChatFinal> {
    return chatFinalSchema.parse(await this.post('/api/chat', { ...req, stream: false }));
  }

  async chatStream(req: ChatRequest): Promise<StreamResult> {
    const start = performance.now();
    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...req, stream: true }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!res.ok || !res.body) throw new Error(`/api/chat ${res.status}: ${await res.text()}`);

    const decoder = new TextDecoder();
    let buf = '';
    let content = '';
    let ttftMs = -1;
    let final: ChatFinal | undefined;
    const consume = (line: string) => {
      if (!line.trim()) return;
      const raw: unknown = JSON.parse(line);
      const msg = streamMessageSchema.parse(raw);
      if (msg.error) throw new Error(msg.error);
      const piece = (msg.message?.content ?? '') + (msg.message?.thinking ?? '');
      if (ttftMs < 0 && piece.length > 0) ttftMs = performance.now() - start;
      content += msg.message?.content ?? '';
      if (msg.done) final = chatFinalSchema.parse(raw);
    };
    for await (const chunk of res.body) {
      buf += decoder.decode(chunk, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        consume(line);
      }
    }
    consume(buf + decoder.decode());
    if (!final) throw new Error('stream ended without a done message');
    return { final, content, ttftMs, wallMs: performance.now() - start };
  }

  async embed(
    model: string,
    input: string[],
    options?: Record<string, unknown>,
    expectedDimensions?: number,
  ): Promise<number[][]> {
    const response = await this.post('/api/embed', { model, input, options });
    if (!isRecord(response)) throw new Error('/api/embed: expected response object');
    return validateEmbeddings(response.embeddings, input.length, expectedDimensions);
  }
}

// Generous: covers a cold load of a 14B model plus a 2K-token thinking answer.
const REQUEST_TIMEOUT_MS = 300_000;

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function argumentValidator(schema: JsonSchema): z.ZodType {
  let validator: z.ZodType;
  switch (schema.type) {
    case 'object': {
      const properties = schema.properties ?? {};
      const fields = Object.fromEntries(
        Object.entries(properties).map(([key, value]) => [
          key,
          (schema.required ?? []).includes(key)
            ? argumentValidator(value)
            : argumentValidator(value).optional(),
        ]),
      );
      validator = z.strictObject(fields).superRefine((value, context) => {
        for (const key of schema.required ?? [])
          if (!Object.hasOwn(value, key))
            context.addIssue({ code: 'custom', message: 'missing own property', path: [key] });
      });
      break;
    }
    case 'array':
      validator = z.array(schema.items ? argumentValidator(schema.items) : z.unknown());
      break;
    case 'integer':
      validator = z.number().int();
      break;
    case 'number':
      validator = z.number().finite();
      break;
    case 'string':
      validator = z.string();
      break;
    case 'boolean':
      validator = z.boolean();
      break;
    case undefined:
      validator = z.unknown();
      break;
    default:
      throw new Error('unsupported argument schema');
  }
  return schema.enum
    ? validator.refine(
        (value) => schema.enum?.some((item) => JSON.stringify(item) === JSON.stringify(value)),
        'not in enum',
      )
    : validator;
}

export function validateArgs(schema: JsonSchema, value: unknown, path = 'args'): string[] {
  if (
    schema.type === 'object' &&
    (typeof value !== 'object' || value === null || Array.isArray(value))
  )
    return [`${path}: expected object`];
  if (schema.type === 'object' && typeof value === 'object' && value !== null) {
    const missing = (schema.required ?? []).filter((key) => !Object.hasOwn(value, key));
    if (missing.length) return missing.map((key) => `${path}.${key}: missing`);
  }
  const result = argumentValidator(schema).safeParse(value);
  return result.success
    ? []
    : result.error.issues.map(
        (issue) => `${path}.${issue.path.map(String).join('.')}: ${issue.message}`,
      );
}

function vectorNorm(vector: unknown, dimensions: number, path: string): number {
  if (!Array.isArray(vector) || vector.length !== dimensions)
    throw new Error(`${path}: expected ${dimensions} dimensions`);
  let norm = 0;
  for (const component of vector) {
    if (typeof component !== 'number' || !Number.isFinite(component))
      throw new Error(`${path}: expected finite numeric components`);
    norm = Math.hypot(norm, component);
  }
  if (!Number.isFinite(norm) || norm === 0)
    throw new Error(`${path}: expected finite nonzero norm`);
  return norm;
}

export function validateEmbeddings(
  value: unknown,
  expectedCount: number,
  expectedDimensions?: number,
): number[][] {
  if (!Array.isArray(value) || value.length !== expectedCount)
    throw new Error(`/api/embed: expected ${expectedCount} vectors`);
  const dimensions = expectedDimensions ?? (Array.isArray(value[0]) ? value[0].length : undefined);
  if (!Number.isInteger(dimensions) || (dimensions ?? 0) <= 0)
    throw new Error('/api/embed: expected positive dimensions');
  value.forEach((vector, index) =>
    vectorNorm(vector, dimensions ?? 0, `/api/embed vector ${index}`),
  );
  return value as number[][];
}

export function cosine(a: number[], b: number[]): number {
  if (a.length === 0) throw new Error('cosine: expected nonempty vectors');
  const na = vectorNorm(a, a.length, 'cosine left');
  const nb = vectorNorm(b, a.length, 'cosine right');
  // Normalize before multiplication to avoid underflow/overflow for finite extreme components.
  let dot = 0;
  for (let index = 0; index < a.length; index++)
    dot += (requiredAt(a, index) / na) * (requiredAt(b, index) / nb);
  return Math.max(-1, Math.min(1, dot));
}

/** Recover only explicit calls occupying the entire response. Never execute recovered calls. */
export function parseTextToolCalls(
  text: string,
): { name: string; arguments: Record<string, unknown> }[] {
  const trimmed = text.trim();
  const candidates: string[] = [];
  if (trimmed.startsWith('{')) candidates.push(trimmed);
  else {
    const pattern = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>|```(?:json)?\s*([\s\S]*?)```/g;
    let end = 0;
    for (const match of trimmed.matchAll(pattern)) {
      if (trimmed.slice(end, match.index).trim()) return [];
      const candidate = match[1] ?? match[2];
      if (!candidate) return [];
      candidates.push(candidate);
      end = match.index + match[0].length;
    }
    if (trimmed.slice(end).trim()) return [];
  }
  const out: { name: string; arguments: Record<string, unknown> }[] = [];
  for (const candidate of candidates) {
    try {
      const obj: unknown = JSON.parse(candidate);
      if (!isRecord(obj) || typeof obj.name !== 'string' || !obj.name.trim()) return [];
      if (Object.keys(obj).some((key) => !['name', 'arguments', 'parameters'].includes(key)))
        return [];
      if (Object.hasOwn(obj, 'arguments') && Object.hasOwn(obj, 'parameters')) return [];
      const raw = Object.hasOwn(obj, 'arguments') ? obj.arguments : obj.parameters;
      const args: unknown = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (!isRecord(args)) return [];
      out.push(toolCallSchema.parse({ name: obj.name, arguments: args }));
    } catch {
      return [];
    }
  }
  return out;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}
