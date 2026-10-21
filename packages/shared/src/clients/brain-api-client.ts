// Typed client for the protected brain routes. Every response is validated against the shared
// contract; anything else is BAD_RESPONSE. The service key is sent only to the configured
// loopback api and redirects are never followed, so it cannot be forwarded elsewhere.
import {
  brainNoteResponseSchema,
  brainSearchQuerySchema,
  brainSearchResponseSchema,
  brainStatsResponseSchema,
  type BrainNoteQuery,
  type BrainNoteResponse,
  type BrainSearchQuery,
  type BrainSearchResponse,
  type BrainStatsResponse,
} from '../contracts/index.ts';
import { z } from 'zod';

export const SERVICE_KEY_HEADER = 'x-aetherion-service-key';
// Above the largest contract-valid response (50 results with every field at its bound is about
// 4 MiB of JSON; a test builds it), so only a broken or hostile api is refused.
export const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

export type BrainApiErrorCode =
  | 'VALIDATION_FAILED'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'RATE_LIMITED'
  | 'UNAVAILABLE'
  | 'DEADLINE_EXPIRED'
  | 'BAD_RESPONSE';

export type BrainApiResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: BrainApiErrorCode };

const KNOWN_CODES = new Set<BrainApiErrorCode>([
  'VALIDATION_FAILED',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'RATE_LIMITED',
  'UNAVAILABLE',
]);
const envelopeSchema = z.object({ error: z.object({ code: z.string() }) });

export type BrainApiClientOptions = {
  readonly baseUrl: string;
  readonly serviceKey: string;
  readonly fetch?: typeof fetch;
};

type QueryValue = string | number | readonly string[] | undefined;

const toSearchParams = (query: Readonly<Record<string, QueryValue>>) => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue;
    if (Array.isArray(value))
      for (const item of value as readonly string[]) params.append(key, item);
    else params.append(key, String(value));
  }
  return params;
};

const readLimited = async (response: Response): Promise<string | undefined> => {
  const reader = response.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      return undefined;
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
};

export const createBrainApiClient = (options: BrainApiClientOptions) => {
  const doFetch = options.fetch ?? fetch;

  const get = async <T>(
    path: string,
    query: Readonly<Record<string, QueryValue>>,
    schema: z.ZodType<T>,
    signal: AbortSignal,
  ): Promise<BrainApiResult<T>> => {
    const url = new URL(path, options.baseUrl);
    url.search = toSearchParams(query).toString();
    let response: Response;
    try {
      response = await doFetch(url, {
        method: 'GET',
        headers: { [SERVICE_KEY_HEADER]: options.serviceKey, accept: 'application/json' },
        redirect: 'error',
        signal,
      });
    } catch {
      return { ok: false, code: signal.aborted ? 'DEADLINE_EXPIRED' : 'UNAVAILABLE' };
    }
    let text: string | undefined;
    try {
      text = await readLimited(response);
    } catch {
      return { ok: false, code: signal.aborted ? 'DEADLINE_EXPIRED' : 'UNAVAILABLE' };
    }
    if (text === undefined) return { ok: false, code: 'BAD_RESPONSE' };
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return { ok: false, code: response.ok ? 'BAD_RESPONSE' : 'UNAVAILABLE' };
    }
    if (!response.ok) {
      const envelope = envelopeSchema.safeParse(body);
      const code = envelope.success ? (envelope.data.error.code as BrainApiErrorCode) : undefined;
      return { ok: false, code: code && KNOWN_CODES.has(code) ? code : 'UNAVAILABLE' };
    }
    const parsed = schema.safeParse(body);
    return parsed.success ? { ok: true, value: parsed.data } : { ok: false, code: 'BAD_RESPONSE' };
  };

  return {
    search: (
      query: BrainSearchQuery,
      signal: AbortSignal,
    ): Promise<BrainApiResult<BrainSearchResponse>> =>
      get('/api/v1/brain/search', query, brainSearchResponseSchema, signal),
    note: (
      query: BrainNoteQuery,
      signal: AbortSignal,
    ): Promise<BrainApiResult<BrainNoteResponse>> =>
      get('/api/v1/brain/note', query, brainNoteResponseSchema, signal),
    stats: (signal: AbortSignal): Promise<BrainApiResult<BrainStatsResponse>> =>
      get('/api/v1/brain/stats', {}, brainStatsResponseSchema, signal),
  };
};

export type BrainApiClient = ReturnType<typeof createBrainApiClient>;

// One mapping from caller-friendly options to the wire query, shared by the CLI and MCP tools so
// their filters and bounds cannot drift. Undefined means "the contract's default".
export type BrainSearchInput = {
  readonly query: string;
  readonly limit?: number | undefined;
  readonly sources?: readonly string[] | undefined;
  readonly tags?: readonly string[] | undefined;
  readonly tagMode?: 'any' | 'all' | undefined;
  readonly pathPrefix?: string | undefined;
  readonly lexicalOnly?: boolean | undefined;
};

export const toBrainSearchQuery = (input: BrainSearchInput) =>
  brainSearchQuerySchema.safeParse({
    q: input.query,
    limit: input.limit,
    source: input.sources,
    tag: input.tags,
    tagMode: input.tagMode,
    pathPrefix: input.pathPrefix,
    mode: input.lexicalOnly ? 'lexical' : 'hybrid',
  });
