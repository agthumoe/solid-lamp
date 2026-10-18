import {
  collectStream,
  inferenceError,
  type GenerationSnapshot,
  type InferenceError,
  type NativeToolCall,
  type StreamDone,
  type StreamEvent,
  type StreamOutcome,
} from '@aetherion/llm';
import { err, ok, type Result } from '@aetherion/shared';
import { z } from 'zod';

import { NdjsonError, readNdjson } from './ndjson.ts';
import { abortError, type OllamaHttp } from './ollama-http.ts';
import { isTransient, type RetryPolicy, type Sleep } from './retry.ts';

export type ChatMessage = {
  readonly role: 'system' | 'user' | 'assistant' | 'tool';
  readonly content: string;
  readonly images?: readonly string[]; // base64, vision role only
  readonly tool_calls?: readonly {
    readonly function: { readonly name: string; readonly arguments: unknown };
  }[];
  readonly tool_name?: string;
};

export type ChatTool = {
  readonly type: 'function';
  readonly function: {
    readonly name: string;
    readonly description: string;
    readonly parameters: Readonly<Record<string, unknown>>;
  };
};

export type ChatRequest = {
  readonly messages: readonly ChatMessage[];
  readonly tools?: readonly ChatTool[];
  readonly think?: boolean; // per-request override of the role default
};

// The adapter yields everything but `started`; the gate wiring emits that with queue time.
export type AdapterStreamEvent = Exclude<StreamEvent, { readonly type: 'started' }>;

export type ChatDeps = {
  readonly http: OllamaHttp;
  readonly retry: RetryPolicy;
  readonly sleep: Sleep;
};

const counter = z.int().nonnegative().default(0); // token counts and nanosecond durations

const chunkSchema = z.object({
  message: z
    .object({
      content: z.string().default(''),
      tool_calls: z
        .array(
          z.object({ function: z.object({ name: z.string().min(1), arguments: z.unknown() }) }),
        )
        .optional(),
    })
    .optional(),
  done: z.boolean().default(false),
  done_reason: z.string().optional(),
  error: z.string().optional(),
  prompt_eval_count: counter,
  eval_count: counter,
  total_duration: counter,
  load_duration: counter,
  prompt_eval_duration: counter,
  eval_duration: counter,
});

type Chunk = z.infer<typeof chunkSchema>;

const ms = (value: number) => Math.round(value / 1e6);

// Every request states num_ctx and sampling explicitly; Modelfile defaults are never relied on.
export const chatBody = (snapshot: GenerationSnapshot, request: ChatRequest) => ({
  model: snapshot.model,
  messages: request.messages,
  ...(request.tools?.length ? { tools: request.tools } : {}),
  think: request.think ?? snapshot.think,
  stream: true,
  options: { ...snapshot.options, num_ctx: snapshot.numCtx },
});

const doneEvent = (chunk: Chunk, toolCalls: readonly NativeToolCall[]): StreamDone => ({
  type: 'done',
  finishReason: chunk.done_reason === 'length' ? 'length' : 'stop',
  tokensIn: chunk.prompt_eval_count,
  tokensOut: chunk.eval_count,
  toolCalls,
  timings: {
    totalMs: ms(chunk.total_duration),
    loadMs: ms(chunk.load_duration),
    promptEvalMs: ms(chunk.prompt_eval_duration),
    evalMs: ms(chunk.eval_duration),
  },
});

type Attempt =
  | { readonly kind: 'event'; readonly event: AdapterStreamEvent }
  | { readonly kind: 'failed'; readonly error: InferenceError };

// One HTTP attempt. Yields events, then at most one `failed` step as the last item, so the
// caller decides whether a retry is still allowed.
async function* attempt(
  http: OllamaHttp,
  body: unknown,
  signal: AbortSignal,
): AsyncGenerator<Attempt> {
  const opened = await http.postStream('/api/chat', body, signal);
  if (!opened.ok) {
    yield { kind: 'failed', error: opened.error };
    return;
  }
  const toolCalls: NativeToolCall[] = [];
  try {
    for await (const line of readNdjson(opened.value)) {
      const chunk = chunkSchema.safeParse(line);
      if (!chunk.success) {
        yield {
          kind: 'failed',
          error: inferenceError('INVALID_RESPONSE', 'unexpected chat chunk'),
        };
        return;
      }
      if (chunk.data.error !== undefined) {
        yield {
          kind: 'failed',
          error: inferenceError('INFERENCE_UNAVAILABLE', 'Ollama reported a stream error'),
        };
        return;
      }
      const message = chunk.data.message;
      for (const call of message?.tool_calls ?? []) toolCalls.push(call.function);
      if (message?.content)
        yield { kind: 'event', event: { type: 'token', text: message.content } };
      if (chunk.data.done) {
        yield { kind: 'event', event: doneEvent(chunk.data, toolCalls) };
        return;
      }
    }
  } catch (error) {
    yield {
      kind: 'failed',
      error: signal.aborted
        ? abortError(signal)
        : error instanceof NdjsonError
          ? inferenceError('INVALID_RESPONSE', 'chat stream was malformed')
          : inferenceError('INFERENCE_UNAVAILABLE', 'chat stream was interrupted'),
    };
    return;
  }
  yield {
    kind: 'failed',
    error: signal.aborted
      ? abortError(signal)
      : inferenceError('INVALID_RESPONSE', 'chat stream ended without done'),
  };
}

/**
 * Streams one chat generation. Transient failures are retried only while no token has been
 * emitted; once output starts, any failure is terminal with `partial: true`.
 */
export async function* streamChat(
  deps: ChatDeps,
  snapshot: GenerationSnapshot,
  request: ChatRequest,
  signal: AbortSignal,
): AsyncGenerator<AdapterStreamEvent> {
  const body = chatBody(snapshot, request);
  let emitted = false;
  for (let tries = 1; ; tries++) {
    let failure: InferenceError | undefined;
    for await (const step of attempt(deps.http, body, signal)) {
      if (step.kind === 'failed') failure = step.error;
      else {
        if (step.event.type === 'token') emitted = true;
        yield step.event;
      }
    }
    if (!failure) return;
    if (emitted || !isTransient(failure) || tries >= deps.retry.maxAttempts || signal.aborted) {
      yield { type: 'error', error: failure, partial: emitted };
      return;
    }
    await deps.sleep(deps.retry.backoffMs, signal);
    if (signal.aborted) {
      yield { type: 'error', error: abortError(signal), partial: false };
      return;
    }
  }
}

export const generateChat = async (
  deps: ChatDeps,
  snapshot: GenerationSnapshot,
  request: ChatRequest,
  signal: AbortSignal,
): Promise<Result<StreamOutcome, InferenceError>> => {
  const collected = await collectStream(streamChat(deps, snapshot, request, signal));
  return collected.ok ? ok(collected.value) : err(collected.error.error);
};
