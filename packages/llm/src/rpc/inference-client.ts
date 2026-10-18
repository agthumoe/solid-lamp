import { err, isPrivateHttpUrl, ok, type Result } from '@aetherion/shared';
import type { z } from 'zod';

import { inferenceError, type InferenceError } from '../errors.ts';
import type { CallOptions } from '../gate/schedule.ts';
import { readNdjson } from '../inference/ndjson.ts';
import type { StreamEvent } from '../inference/stream-event.ts';
import {
  embedResponseSchema,
  generateResponseSchema,
  INFERENCE_KEY_HEADER,
  isInferenceErrorCode,
  RPC_PATHS,
  rpcErrorEnvelopeSchema,
  streamEventSchema,
  type EmbedRequest,
  type EmbedResponse,
  type GenerateRequest,
  type GenerateResponse,
} from './contract.ts';

type CallFields = 'priority' | 'deadline' | 'runId';

export type GenerateInput = Omit<GenerateRequest, CallFields>;
export type EmbedInput = Omit<EmbedRequest, CallFields>;
export type ClientCallOptions = CallOptions & { readonly runId?: string };

/** The only way api/worker reach the GPU: the inference process's gate, over loopback RPC. */
export type InferenceClient = {
  readonly generate: (
    input: GenerateInput,
    options: ClientCallOptions,
  ) => Promise<Result<GenerateResponse, InferenceError>>;
  // Never throws for an expected failure; always ends with exactly one terminal event.
  readonly stream: (input: GenerateInput, options: ClientCallOptions) => AsyncIterable<StreamEvent>;
  readonly embed: (
    input: EmbedInput,
    options: ClientCallOptions,
  ) => Promise<Result<EmbedResponse, InferenceError>>;
};

export type InferenceClientOptions = {
  readonly baseUrl: string;
  readonly secret: string;
  readonly fetch?: (url: string, init: RequestInit) => Promise<Response>;
  readonly now?: () => number;
};

// The server enforces the deadline; the client stops waiting shortly after it in case the
// server itself is stuck.
const CLIENT_GRACE_MS = 2_000;

export const createInferenceClient = (options: InferenceClientOptions): InferenceClient => {
  if (!isPrivateHttpUrl(options.baseUrl))
    throw new RangeError('inference URL must be loopback or Tailscale');
  const root = options.baseUrl.replace(/\/+$/, '');
  const fetch = options.fetch ?? globalThis.fetch;
  const now = options.now ?? Date.now;

  const abortedError = (call: ClientCallOptions): InferenceError =>
    call.signal.aborted
      ? inferenceError('CANCELLED', 'request was cancelled')
      : inferenceError('DEADLINE_EXPIRED', 'request deadline expired');

  const post = async (
    path: string,
    body: object,
    call: ClientCallOptions,
  ): Promise<Result<Response, InferenceError>> => {
    if (call.signal.aborted) return err(abortedError(call));
    const remaining = call.deadline.getTime() - now();
    if (remaining <= 0) return err(abortedError(call));
    const signal = AbortSignal.any([call.signal, AbortSignal.timeout(remaining + CLIENT_GRACE_MS)]);
    const payload = {
      ...body,
      priority: call.priority,
      deadline: call.deadline.toISOString(),
      ...(call.runId === undefined ? {} : { runId: call.runId }),
    };
    let response: Response;
    try {
      response = await fetch(`${root}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', [INFERENCE_KEY_HEADER]: options.secret },
        body: JSON.stringify(payload),
        signal,
      });
    } catch {
      return err(
        signal.aborted
          ? abortedError(call)
          : inferenceError('INFERENCE_UNAVAILABLE', 'inference service unreachable'),
      );
    }
    if (response.ok) return ok(response);
    return err(await failure(response));
  };

  const failure = async (response: Response): Promise<InferenceError> => {
    const envelope = rpcErrorEnvelopeSchema.safeParse(await response.json().catch(() => null));
    if (!envelope.success)
      return inferenceError('INFERENCE_UNAVAILABLE', `inference service error ${response.status}`);
    const { code, message } = envelope.data.error;
    if (isInferenceErrorCode(code)) return inferenceError(code, message);
    // A rejected request shape is a caller bug, not a runtime condition to handle.
    if (code === 'VALIDATION_FAILED')
      throw new RangeError(`inference request rejected: ${message}`);
    return inferenceError('INFERENCE_UNAVAILABLE', `inference service ${code.toLowerCase()}`);
  };

  const json = async <T>(
    response: Response,
    schema: z.ZodType<T>,
    call: ClientCallOptions,
  ): Promise<Result<T, InferenceError>> => {
    try {
      const parsed = schema.safeParse(await response.json());
      return parsed.success
        ? ok(parsed.data)
        : err(inferenceError('INVALID_RESPONSE', 'unexpected inference response'));
    } catch {
      return err(
        call.signal.aborted
          ? abortedError(call)
          : inferenceError('INVALID_RESPONSE', 'inference response is not JSON'),
      );
    }
  };

  async function* stream(
    input: GenerateInput,
    call: ClientCallOptions,
  ): AsyncGenerator<StreamEvent> {
    const response = await post(RPC_PATHS.stream, input, call);
    if (!response.ok) {
      yield { type: 'error', error: response.error, partial: false };
      return;
    }
    const body = response.value.body;
    let partial = false;
    const fail = (error: InferenceError): StreamEvent => ({ type: 'error', error, partial });
    if (!body) {
      yield fail(inferenceError('INVALID_RESPONSE', 'empty inference stream'));
      return;
    }
    try {
      for await (const line of readNdjson(body)) {
        const event = streamEventSchema.safeParse(line);
        if (!event.success) {
          yield fail(inferenceError('INVALID_RESPONSE', 'unexpected stream event'));
          return;
        }
        yield event.data;
        if (event.data.type === 'token') partial = true;
        if (event.data.type === 'done' || event.data.type === 'error') return;
      }
      yield fail(inferenceError('INVALID_RESPONSE', 'stream ended without a terminal event'));
    } catch {
      yield fail(
        call.signal.aborted || call.deadline.getTime() <= now()
          ? abortedError(call)
          : inferenceError('INFERENCE_UNAVAILABLE', 'inference stream was interrupted'),
      );
    }
  }

  return {
    generate: async (input, call) => {
      const response = await post(RPC_PATHS.generate, input, call);
      return response.ok ? json(response.value, generateResponseSchema, call) : response;
    },
    stream,
    embed: async (input, call) => {
      const response = await post(RPC_PATHS.embed, input, call);
      return response.ok ? json(response.value, embedResponseSchema, call) : response;
    },
  };
};
