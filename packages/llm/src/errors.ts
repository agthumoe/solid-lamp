export const INFERENCE_ERROR_CODES = [
  'QUEUE_FULL',
  'DEADLINE_EXPIRED',
  'CANCELLED',
  'INFERENCE_UNAVAILABLE',
  'MODEL_NOT_LOADED',
  'INVALID_RESPONSE',
] as const;

export type InferenceErrorCode = (typeof INFERENCE_ERROR_CODES)[number];

export type InferenceError = {
  readonly code: InferenceErrorCode;
  readonly message: string;
};

export const inferenceError = (code: InferenceErrorCode, message: string): InferenceError => ({
  code,
  message,
});
