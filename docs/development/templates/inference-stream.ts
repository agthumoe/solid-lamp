// Template: the streaming contract of the InferenceClient (packages/llm) and a consumer.
// Guide: docs/development/ai-orchestration.md#llmgate-client-interface-packagesllm
//
// Contract: `stream()` never throws for an expected failure. Every stream yields zero or
// more `token` events and ends with exactly ONE terminal event, `done` or `error`.
// `error.partial` says whether tokens were already emitted; partial output is never
// retried (OUTPUT_ALREADY_STARTED semantics). A thrown error means a programmer bug.

import { err, ok, type Result } from './result-and-errors.ts';

export const INFERENCE_ERROR_CODES = [
  'QUEUE_FULL',
  'DEADLINE_EXPIRED',
  'CANCELLED',
  'INFERENCE_UNAVAILABLE',
  'MODEL_NOT_LOADED',
  'INVALID_RESPONSE',
] as const;
export type InferenceErrorCode = (typeof INFERENCE_ERROR_CODES)[number];

export type InferenceError = { readonly code: InferenceErrorCode; readonly message: string };

// The model identity the gate actually used (resolved from a role at enqueue time).
export type ResolvedModel = {
  readonly role: string;
  readonly model: string;
  readonly numCtx: number;
};

export type StreamEvent =
  | { readonly type: 'started'; readonly model: ResolvedModel; readonly queuedMs: number }
  | { readonly type: 'token'; readonly text: string }
  | {
      readonly type: 'done';
      readonly finishReason: 'stop' | 'length';
      readonly tokensIn: number;
      readonly tokensOut: number;
    }
  | { readonly type: 'error'; readonly error: InferenceError; readonly partial: boolean };

export type StreamOutcome = {
  readonly text: string;
  readonly model: ResolvedModel | undefined;
  readonly finishReason: 'stop' | 'length';
};

// Failure keeps any partial text so the caller can show it (marked incomplete) or
// discard it. It must not re-request when `partial` is true.
export type StreamFailure = {
  readonly error: InferenceError;
  readonly partial: boolean;
  readonly partialText: string;
};

// Consume a stream into a Result, forwarding tokens (for SSE) as they arrive.
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
        return ok({ text, model, finishReason: event.finishReason });
      case 'error':
        return err({ error: event.error, partial: event.partial, partialText: text });
    }
  }
  // A stream that ends without a terminal event broke the contract: treat as invalid.
  return err({
    error: { code: 'INVALID_RESPONSE', message: 'Stream ended without a terminal event.' },
    partial: text.length > 0,
    partialText: text,
  });
};
