import { createHash } from 'node:crypto';

import {
  embeddingProfileCandidates,
  inferenceError,
  LlmGate,
  type EmbedSnapshot,
  type GenerationSnapshot,
  type InferenceError,
} from '@aetherion/llm';
import {
  err,
  ok,
  parseModelsConfig,
  type LogEvent,
  type Logger,
  type ModelsConfig,
  type Result,
} from '@aetherion/shared';

import { createInferenceService } from '../../src/gate/inference-service.ts';
import { createProfileRegistry, type InstalledArtifacts } from '../../src/gate/profile-registry.ts';
import type { AdapterStreamEvent, ChatRequest } from '../../src/ollama/chat.ts';
import type { EmbedKind, EmbedResult } from '../../src/ollama/embed.ts';
import {
  canonicalModel,
  type LoadedModel,
  type ResidencyChange,
} from '../../src/ollama/residency.ts';

export const modelsConfig = (): ModelsConfig => {
  const parsed = parseModelsConfig(`
ollama: { base_url: 'http://127.0.0.1:11434' }
roles:
  chat: { model: 'qwen3.5:9b', num_ctx: 16384, residency: resident, temperature: 0.6 }
  router: { model: 'qwen3.5:9b', num_ctx: 16384, residency: shared }
  coder: { model: 'qwen3.5:9b', num_ctx: 16384, residency: shared }
  embed: { model: 'qwen3-embedding:0.6b', num_ctx: 8192, residency: resident, dimensions: 3, query_prefix: 'q: ' }
`);
  if (!parsed.ok) throw new Error(parsed.error.message);
  return parsed.value;
};

export const capturingLogger = () => {
  const events: (LogEvent & { level: string })[] = [];
  const logger: Logger = {
    child: () => logger,
    debug: (event) => events.push({ ...event, level: 'debug' }),
    info: (event) => events.push({ ...event, level: 'info' }),
    warn: (event) => events.push({ ...event, level: 'warn' }),
    error: (event) => events.push({ ...event, level: 'error' }),
  };
  return { logger, events };
};

export type StreamScript = (
  snapshot: GenerationSnapshot,
  request: ChatRequest,
  signal: AbortSignal,
) => AsyncIterable<AdapterStreamEvent>;

export const doneEvent = (tokensOut = 1): AdapterStreamEvent => ({
  type: 'done',
  finishReason: 'stop',
  tokensIn: 4,
  tokensOut,
  toolCalls: [],
  timings: { totalMs: 5, loadMs: 0, promptEvalMs: 1, evalMs: 4 },
});

export async function* tokensThenDone(...tokens: string[]): AsyncGenerator<AdapterStreamEvent> {
  for (const text of tokens) {
    await Promise.resolve();
    yield { type: 'token', text };
  }
  yield doneEvent(tokens.length);
}

/** Scripted adapter that honours the job signal like the real one. */
export const fakeAdapter = (
  options: {
    stream?: StreamScript;
    embed?: (texts: readonly string[], kind: EmbedKind) => Result<EmbedResult, InferenceError>;
    loaded?: () => Result<readonly LoadedModel[], InferenceError>;
  } = {},
) => {
  const streams: { snapshot: GenerationSnapshot; request: ChatRequest }[] = [];
  const embeds: { snapshot: EmbedSnapshot; texts: readonly string[]; kind: EmbedKind }[] = [];
  let loadedCalls = 0;
  return {
    streams,
    embeds,
    loadedCalls: () => loadedCalls,
    adapter: {
      stream: (snapshot: GenerationSnapshot, request: ChatRequest, signal: AbortSignal) => {
        streams.push({ snapshot, request });
        return (options.stream ?? (() => tokensThenDone('Hel', 'lo')))(snapshot, request, signal);
      },
      embed: (
        snapshot: EmbedSnapshot,
        texts: readonly string[],
        kind: EmbedKind,
        signal: AbortSignal,
      ): Promise<Result<EmbedResult, InferenceError>> => {
        embeds.push({ snapshot, texts, kind });
        if (signal.aborted) return Promise.resolve(err(inferenceError('CANCELLED', 'aborted')));
        return Promise.resolve(
          options.embed?.(texts, kind) ??
            ok({
              vectors: texts.map(() => [0.1, 0.2, 0.3]),
              tokensIn: texts.length,
              totalMs: 3,
              loadMs: 0,
            }),
        );
      },
      loaded: (): Promise<Result<readonly LoadedModel[], InferenceError>> => {
        loadedCalls++;
        return Promise.resolve(
          options.loaded?.() ??
            ok([{ model: 'qwen3.5:9b', contextLength: 16384, sizeBytes: 1, vramBytes: 1 }]),
        );
      },
    },
  };
};

export const digestOf = (model: string) => createHash('sha256').update(model).digest('hex');

// Every embedding model the config names at creation, installed with a deterministic digest.
// Fixed afterwards: a config reload does not change what Ollama has installed.
export const installedFor = (config: () => ModelsConfig): InstalledArtifacts => {
  const installed = new Map(
    embeddingProfileCandidates(config()).map((identity) => [
      canonicalModel(identity.model),
      digestOf(identity.model),
    ]),
  );
  return () => Promise.resolve(ok(installed));
};

export const serviceWith = (
  adapter: ReturnType<typeof fakeAdapter>['adapter'],
  extra: {
    gate?: LlmGate;
    now?: () => number;
    config?: () => ModelsConfig;
    // Installed Ollama artifacts (model -> digest). Default: every configured embed model.
    installed?: InstalledArtifacts;
  } = {},
) => {
  const residency: ResidencyChange[] = [];
  const { logger, events } = capturingLogger();
  const gate = extra.gate ?? new LlmGate({}, extra.now);
  const service = createInferenceService({
    gate,
    adapter,
    config: extra.config ?? modelsConfig,
    recordResidency: (change) => residency.push(change),
    profiles: createProfileRegistry({
      config: extra.config ?? modelsConfig,
      installed: extra.installed ?? installedFor(extra.config ?? modelsConfig),
    }),
    logger,
    ...(extra.now ? { now: extra.now } : {}),
  });
  return { service, gate, residency, events };
};

export const call = (
  priority: 'interactive' | 'background' = 'interactive',
  extra: { signal?: AbortSignal; deadline?: Date } = {},
) => ({
  priority,
  signal: extra.signal ?? new AbortController().signal,
  deadline: extra.deadline ?? new Date(Date.now() + 10_000),
});
