import { err, ok, type Result } from '@aetherion/shared';

import type { InferenceError } from '../errors.ts';

// The identity the gate actually used, resolved from a role at enqueue time.
export type ResolvedModel = {
  readonly role: string;
  readonly model: string;
  readonly numCtx: number;
};

// A tool call as the model emitted it natively; validate with `validateToolCall` before use.
export type NativeToolCall = {
  readonly name: string;
  readonly arguments: unknown;
};

export type GenerationTimings = {
  readonly totalMs: number;
  readonly loadMs: number;
  readonly promptEvalMs: number;
  readonly evalMs: number;
};

export type FinishReason = 'stop' | 'length';

export type StreamDone = {
  readonly type: 'done';
  readonly finishReason: FinishReason;
  readonly tokensIn: number;
  readonly tokensOut: number;
  readonly toolCalls: readonly NativeToolCall[];
  readonly timings: GenerationTimings;
};

/**
 * Streaming contract: zero or more `token` events, then exactly ONE terminal event, `done`
 * or `error`. `error.partial` is true when tokens were already emitted; partial output is
 * never retried. A thrown iterator error is a programmer bug, not a handled case.
 */
export type StreamEvent =
  | { readonly type: 'started'; readonly model: ResolvedModel; readonly queuedMs: number }
  | { readonly type: 'token'; readonly text: string }
  | StreamDone
  | { readonly type: 'error'; readonly error: InferenceError; readonly partial: boolean };

export type StreamOutcome = {
  readonly text: string;
  readonly model: ResolvedModel | undefined;
  readonly done: StreamDone;
};

export type StreamFailure = {
  readonly error: InferenceError;
  readonly partial: boolean;
  readonly partialText: string;
};

// Consumes a stream into a Result, forwarding tokens (for SSE) as they arrive.
export const collectStream = async (
  events: AsyncIterable<StreamEvent>,
  onToken: (text: string) => void = () => undefined,
): Promise<Result<StreamOutcome, StreamFailure>> => {
  let text = '';
  let model: ResolvedModel | undefined;
  for await (const event of events) {
    switch (event.type) {
      case 'started':
        model = event.model;
        break;
      case 'token':
        text += event.text;
        onToken(event.text);
        break;
      case 'done':
        return ok({ text, model, done: event });
      case 'error':
        return err({ error: event.error, partial: event.partial, partialText: text });
    }
  }
  return err({
    error: { code: 'INVALID_RESPONSE', message: 'stream ended without a terminal event' },
    partial: text.length > 0,
    partialText: text,
  });
};
