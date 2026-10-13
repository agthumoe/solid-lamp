// Minimal Ollama native-API client for the benchmark harness.
// The production client lives in packages/llm (Phase 1); this file stays dependency-free.

export interface PsModel {
  name: string;
  size: number;
  size_vram: number;
  context_length?: number;
  expires_at?: string;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: { function: { name: string; arguments: Record<string, unknown> } }[];
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  tools?: unknown[];
  think?: boolean;
  options?: Record<string, unknown>;
  keep_alive?: string | number;
}

export interface ChatFinal {
  message: ChatMessage & { thinking?: string };
  total_duration: number;
  load_duration: number;
  prompt_eval_count: number;
  prompt_eval_duration: number;
  eval_count: number;
  eval_duration: number;
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
    this.baseUrl = baseUrl;
    this.timeoutMs = timeoutMs;
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!res.ok) throw new Error(`${path} ${res.status}: ${await res.text()}`);
    return (await res.json()) as T;
  }

  async version(): Promise<string> {
    const res = await fetch(`${this.baseUrl}/api/version`, { signal: AbortSignal.timeout(this.timeoutMs) });
    if (!res.ok) throw new Error(`/api/version ${res.status}: ${await res.text()}`);
    return ((await res.json()) as { version: string }).version;
  }

  async ps(): Promise<PsModel[]> {
    const res = await fetch(`${this.baseUrl}/api/ps`, { signal: AbortSignal.timeout(this.timeoutMs) });
    if (!res.ok) throw new Error(`/api/ps ${res.status}: ${await res.text()}`);
    return ((await res.json()) as { models: PsModel[] }).models;
  }

  async show(model: string): Promise<{ capabilities?: string[]; details?: Record<string, unknown> }> {
    return this.post('/api/show', { model });
  }

  async unload(model: string): Promise<void> {
    await this.post('/api/generate', { model, keep_alive: 0 });
  }

  async unloadAll(): Promise<void> {
    for (const m of await this.ps()) await this.unload(m.name);
    // Eviction is async on the server side; wait until /api/ps is empty.
    for (let i = 0; i < 100; i++) {
      if ((await this.ps()).length === 0) return;
      await sleep(200);
    }
    throw new Error(`unloadAll: models still loaded after 20s: ${(await this.ps()).map((m) => m.name).join(', ')}`);
  }

  async chat(req: ChatRequest): Promise<ChatFinal> {
    return this.post('/api/chat', { ...req, stream: false });
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
      const msg = JSON.parse(line) as ChatFinal & { done: boolean; error?: string };
      if (msg.error) throw new Error(msg.error);
      const piece = (msg.message?.content ?? '') + (msg.message?.thinking ?? '');
      if (ttftMs < 0 && piece.length > 0) ttftMs = performance.now() - start;
      content += msg.message?.content ?? '';
      if (msg.done) final = msg;
    };
    for await (const chunk of res.body) {
      buf += decoder.decode(chunk as Uint8Array, { stream: true });
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

  async embed(model: string, input: string[], options?: Record<string, unknown>, expectedDimensions?: number): Promise<number[][]> {
    const response = await this.post<unknown>('/api/embed', { model, input, options });
    if (!isRecord(response)) throw new Error('/api/embed: expected response object');
    return validateEmbeddings(response.embeddings, input.length, expectedDimensions);
  }
}

// Generous: covers a cold load of a 14B model plus a 2K-token thinking answer.
const REQUEST_TIMEOUT_MS = 300_000;

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface JsonSchema {
  type?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  enum?: unknown[];
  items?: JsonSchema;
}

/**
 * Minimal JSON-schema check for tool arguments (types, required, enum, no unknown keys).
 * Returns a list of problems; empty means valid. Production uses zod in packages/llm.
 */
export function validateArgs(schema: JsonSchema, value: unknown, path = 'args'): string[] {
  const errs: string[] = [];
  const t = schema.type;
  if (t === 'object') {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return [`${path}: expected object`];
    const obj = value as Record<string, unknown>;
    for (const k of schema.required ?? []) if (!Object.hasOwn(obj, k)) errs.push(`${path}.${k}: missing`);
    for (const [k, v] of Object.entries(obj)) {
      const sub = schema.properties && Object.hasOwn(schema.properties, k) ? schema.properties[k] : undefined;
      if (!sub) errs.push(`${path}.${k}: unknown key`);
      else errs.push(...validateArgs(sub, v, `${path}.${k}`));
    }
  } else if (t === 'array') {
    if (!Array.isArray(value)) return [`${path}: expected array`];
    if (schema.items) value.forEach((v, i) => errs.push(...validateArgs(schema.items!, v, `${path}[${i}]`)));
  } else if (t === 'integer') {
    if (!Number.isInteger(value)) errs.push(`${path}: expected integer`);
  } else if (t === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) errs.push(`${path}: expected number`);
  } else if (t === 'string' || t === 'boolean') {
    if (typeof value !== t) errs.push(`${path}: expected ${t}`);
  }
  if (schema.enum && !schema.enum.includes(value)) errs.push(`${path}: not in enum`);
  return errs;
}

function vectorNorm(vector: unknown, dimensions: number, path: string): number {
  if (!Array.isArray(vector) || vector.length !== dimensions) throw new Error(`${path}: expected ${dimensions} dimensions`);
  let norm = 0;
  for (const component of vector) {
    if (typeof component !== 'number' || !Number.isFinite(component)) throw new Error(`${path}: expected finite numeric components`);
    norm = Math.hypot(norm, component);
  }
  if (!Number.isFinite(norm) || norm === 0) throw new Error(`${path}: expected finite nonzero norm`);
  return norm;
}

export function validateEmbeddings(value: unknown, expectedCount: number, expectedDimensions?: number): number[][] {
  if (!Array.isArray(value) || value.length !== expectedCount) throw new Error(`/api/embed: expected ${expectedCount} vectors`);
  const dimensions = expectedDimensions ?? (Array.isArray(value[0]) ? value[0].length : undefined);
  if (!Number.isInteger(dimensions) || dimensions! <= 0) throw new Error('/api/embed: expected positive dimensions');
  value.forEach((vector, index) => vectorNorm(vector, dimensions!, `/api/embed vector ${index}`));
  return value as number[][];
}

export function cosine(a: number[], b: number[]): number {
  if (a.length === 0) throw new Error('cosine: expected nonempty vectors');
  const na = vectorNorm(a, a.length, 'cosine left');
  const nb = vectorNorm(b, a.length, 'cosine right');
  // Normalize before multiplication to avoid underflow/overflow for finite extreme components.
  let dot = 0;
  for (let index = 0; index < a.length; index++) dot += (a[index] / na) * (b[index] / nb);
  return Math.max(-1, Math.min(1, dot));
}

/** Recover only explicit calls occupying the entire response. Never execute recovered calls. */
export function parseTextToolCalls(text: string): { name: string; arguments: Record<string, unknown> }[] {
  const trimmed = text.trim();
  const candidates: string[] = [];
  if (trimmed.startsWith('{')) candidates.push(trimmed);
  else {
    const pattern = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>|```(?:json)?\s*([\s\S]*?)```/g;
    let end = 0;
    for (const match of trimmed.matchAll(pattern)) {
      if (trimmed.slice(end, match.index).trim()) return [];
      candidates.push(match[1] ?? match[2]);
      end = match.index! + match[0].length;
    }
    if (trimmed.slice(end).trim()) return [];
  }
  const out: { name: string; arguments: Record<string, unknown> }[] = [];
  for (const candidate of candidates) {
    try {
      const obj: unknown = JSON.parse(candidate);
      if (!isRecord(obj) || typeof obj.name !== 'string' || !obj.name.trim()) return [];
      if (Object.keys(obj).some((key) => !['name', 'arguments', 'parameters'].includes(key))) return [];
      if (Object.hasOwn(obj, 'arguments') && Object.hasOwn(obj, 'parameters')) return [];
      const raw = Object.hasOwn(obj, 'arguments') ? obj.arguments : obj.parameters;
      const args: unknown = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (!isRecord(args)) return [];
      out.push({ name: obj.name, arguments: args });
    } catch {
      return [];
    }
  }
  return out;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype;
}
