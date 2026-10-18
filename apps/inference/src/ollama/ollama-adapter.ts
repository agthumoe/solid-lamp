import type { EmbedSnapshot, GenerationSnapshot } from '@aetherion/llm';

import { generateChat, streamChat, type ChatDeps, type ChatRequest } from './chat.ts';
import { embedTexts, type EmbedKind } from './embed.ts';
import { createOllamaHttp, type FetchLike } from './ollama-http.ts';
import { listLoaded } from './residency.ts';
import { abortableSleep, DEFAULT_RETRY, type RetryPolicy, type Sleep } from './retry.ts';

export type OllamaAdapterOptions = {
  readonly baseUrl: string;
  readonly fetch?: FetchLike;
  readonly retry?: RetryPolicy;
  readonly sleep?: Sleep;
};

/**
 * The only module that speaks Ollama's HTTP API. Callers pass a role snapshot taken at
 * enqueue time and the gate's job signal; the adapter never picks a model itself.
 */
export const createOllamaAdapter = (options: OllamaAdapterOptions) => {
  const deps: ChatDeps = {
    http: createOllamaHttp(options.baseUrl, options.fetch ?? globalThis.fetch),
    retry: options.retry ?? DEFAULT_RETRY,
    sleep: options.sleep ?? abortableSleep,
  };
  return {
    stream: (snapshot: GenerationSnapshot, request: ChatRequest, signal: AbortSignal) =>
      streamChat(deps, snapshot, request, signal),
    generate: (snapshot: GenerationSnapshot, request: ChatRequest, signal: AbortSignal) =>
      generateChat(deps, snapshot, request, signal),
    embed: (
      snapshot: EmbedSnapshot,
      texts: readonly string[],
      kind: EmbedKind,
      signal: AbortSignal,
    ) => embedTexts(deps, snapshot, texts, kind, signal),
    loaded: (signal: AbortSignal) => listLoaded(deps.http, signal),
  };
};

export type OllamaAdapter = ReturnType<typeof createOllamaAdapter>;
