import { err, ok, type Result } from '@aetherion/shared';

import { inferenceError, type InferenceError } from '../errors.ts';
import type { StreamDone, StreamEvent } from '../inference/stream-event.ts';
import type { EmbedResponse, GenerateResponse } from '../rpc/contract.ts';
import type {
  ClientCallOptions,
  EmbedInput,
  GenerateInput,
  InferenceClient,
} from '../rpc/inference-client.ts';

export type FakeScript = {
  readonly ollamaReady?: boolean;
  // Text the fake "model" answers with for a generation request; split into tokens by word.
  readonly reply?: (input: GenerateInput) => Result<string, InferenceError>;
  readonly toolCalls?: StreamDone['toolCalls'];
  readonly dimensions?: number;
};

export type FakeInferenceClient = InferenceClient & {
  readonly calls: readonly { readonly kind: string; readonly options: ClientCallOptions }[];
};

const done = (tokensOut: number, toolCalls: StreamDone['toolCalls']): StreamDone => ({
  type: 'done',
  finishReason: 'stop',
  tokensIn: 0,
  tokensOut,
  toolCalls,
  timings: { totalMs: 0, loadMs: 0, promptEvalMs: 0, evalMs: 0 },
});

/**
 * In-memory `InferenceClient` that honours the real contract: cancellation and expired
 * deadlines fail before any output, every stream ends with exactly one terminal event, and
 * embeddings have the configured dimensions. It never calls a model.
 */
export const createFakeInferenceClient = (
  script: FakeScript = {},
  now: () => number = Date.now,
): FakeInferenceClient => {
  const calls: { kind: string; options: ClientCallOptions }[] = [];
  const reply = script.reply ?? (() => ok('ok'));
  const model = (role: string) => ({ role, model: `fake-${role}`, numCtx: 4096 });

  const refused = (options: ClientCallOptions): InferenceError | undefined => {
    if (options.signal.aborted) return inferenceError('CANCELLED', 'request was cancelled');
    if (options.deadline.getTime() <= now())
      return inferenceError('DEADLINE_EXPIRED', 'request deadline expired');
    return undefined;
  };

  async function* stream(
    input: GenerateInput,
    options: ClientCallOptions,
  ): AsyncGenerator<StreamEvent> {
    calls.push({ kind: 'stream', options });
    const blocked = refused(options);
    if (blocked) {
      yield { type: 'error', error: blocked, partial: false };
      return;
    }
    const text = reply(input);
    if (!text.ok) {
      yield { type: 'error', error: text.error, partial: false };
      return;
    }
    yield { type: 'started', model: model(input.role), queuedMs: 0 };
    const tokens = text.value.match(/\S+\s*/g) ?? [];
    for (const [index, token] of tokens.entries()) {
      await Promise.resolve();
      const stopped = refused(options);
      if (stopped) {
        yield { type: 'error', error: stopped, partial: index > 0 };
        return;
      }
      yield { type: 'token', text: token };
    }
    yield done(tokens.length, script.toolCalls ?? []);
  }

  return {
    calls,
    stream,
    generate: async (input, options): Promise<Result<GenerateResponse, InferenceError>> => {
      calls.push({ kind: 'generate', options });
      await Promise.resolve();
      const blocked = refused(options);
      if (blocked) return err(blocked);
      const text = reply(input);
      if (!text.ok) return text;
      const tokens = text.value.match(/\S+\s*/g) ?? [];
      return ok({
        text: text.value,
        model: model(input.role),
        done: done(tokens.length, script.toolCalls ?? []),
      });
    },
    ready: async () => {
      await Promise.resolve();
      const up = script.ollamaReady ?? true;
      return ok({
        status: up ? 'ready' : 'not_ready',
        ollama: up ? 'ok' : 'unavailable',
        gate: {
          active: null,
          queued: { interactive: 0, background: 0 },
          oldestQueuedMs: 0,
          completed: calls.length,
          rejected: 0,
        },
        residency: { coldLoads: 0, contextReloads: 0, evictions: 0, notResidentAfter: 0 },
      } as const);
    },
    embed: async (input: EmbedInput, options): Promise<Result<EmbedResponse, InferenceError>> => {
      calls.push({ kind: 'embed', options });
      await Promise.resolve();
      const blocked = refused(options);
      if (blocked) return err(blocked);
      const dimensions = script.dimensions ?? 4;
      return ok({
        vectors: input.texts.map((text) =>
          Array.from({ length: dimensions }, (_, i) => ((text.length + i) % 7) / 7),
        ),
        model: { model: 'fake-embed', numCtx: 2048, dimensions },
        tokensIn: input.texts.length,
        totalMs: 0,
      });
    },
  };
};
