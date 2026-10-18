import { err, isPrivateHttpUrl, ok, type Result } from '@aetherion/shared';
import { inferenceError, type InferenceError } from '@aetherion/llm';

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export type OllamaHttp = {
  readonly getJson: (path: string, signal: AbortSignal) => Promise<Result<unknown, InferenceError>>;
  readonly postJson: (
    path: string,
    body: unknown,
    signal: AbortSignal,
  ) => Promise<Result<unknown, InferenceError>>;
  // Resolves once response headers arrive; the body is streamed by the caller.
  readonly postStream: (
    path: string,
    body: unknown,
    signal: AbortSignal,
  ) => Promise<Result<ReadableStream<Uint8Array>, InferenceError>>;
};

// The gate aborts with its termination reason; anything else is a caller cancellation.
export const abortError = (signal: AbortSignal): InferenceError =>
  signal.reason === 'DEADLINE_EXPIRED'
    ? inferenceError('DEADLINE_EXPIRED', 'request deadline expired')
    : inferenceError('CANCELLED', 'request was cancelled');

// Response bodies are never echoed: Ollama errors can quote prompt or model details.
const statusError = (path: string, status: number): InferenceError => {
  if (status === 404) return inferenceError('MODEL_NOT_LOADED', `${path}: model not found`);
  if (status >= 500) return inferenceError('INFERENCE_UNAVAILABLE', `${path}: Ollama ${status}`);
  return inferenceError('INVALID_RESPONSE', `${path}: Ollama rejected the request (${status})`);
};

export const createOllamaHttp = (baseUrl: string, fetch: FetchLike): OllamaHttp => {
  if (!isPrivateHttpUrl(baseUrl)) throw new RangeError('Ollama URL must be loopback or Tailscale');
  const root = baseUrl.replace(/\/+$/, '');

  const send = async (
    path: string,
    init: RequestInit,
    signal: AbortSignal,
  ): Promise<Result<Response, InferenceError>> => {
    if (signal.aborted) return err(abortError(signal));
    try {
      const response = await fetch(`${root}${path}`, { ...init, signal });
      if (response.ok) return ok(response);
      await response.body?.cancel();
      return err(statusError(path, response.status));
    } catch {
      return err(
        signal.aborted
          ? abortError(signal)
          : inferenceError('INFERENCE_UNAVAILABLE', `${path}: Ollama unreachable`),
      );
    }
  };

  const readJson = async (
    path: string,
    response: Response,
    signal: AbortSignal,
  ): Promise<Result<unknown, InferenceError>> => {
    try {
      return ok(await response.json());
    } catch {
      return err(
        signal.aborted
          ? abortError(signal)
          : inferenceError('INVALID_RESPONSE', `${path}: response is not JSON`),
      );
    }
  };

  const post = (path: string, body: unknown, signal: AbortSignal) =>
    send(
      path,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      },
      signal,
    );

  return {
    getJson: async (path, signal) => {
      const response = await send(path, { method: 'GET' }, signal);
      return response.ok ? readJson(path, response.value, signal) : response;
    },
    postJson: async (path, body, signal) => {
      const response = await post(path, body, signal);
      return response.ok ? readJson(path, response.value, signal) : response;
    },
    postStream: async (path, body, signal) => {
      const response = await post(path, body, signal);
      if (!response.ok) return response;
      const stream = response.value.body;
      return stream ? ok(stream) : err(inferenceError('INVALID_RESPONSE', `${path}: empty body`));
    },
  };
};
