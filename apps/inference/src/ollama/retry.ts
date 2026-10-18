import type { InferenceError } from '@aetherion/llm';

export type RetryPolicy = {
  readonly maxAttempts: number;
  readonly backoffMs: number;
};

export type Sleep = (ms: number, signal: AbortSignal) => Promise<void>;

// One retry: a transient failure before output, bounded by the gate's deadline signal.
export const DEFAULT_RETRY: RetryPolicy = { maxAttempts: 2, backoffMs: 250 };

// Only a transport/server failure is transient. Model-not-found, invalid responses,
// cancellation and deadline expiry are final.
export const isTransient = (error: InferenceError): boolean =>
  error.code === 'INFERENCE_UNAVAILABLE';

export const abortableSleep: Sleep = (ms, signal) =>
  new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal.addEventListener('abort', done, { once: true });
  });
