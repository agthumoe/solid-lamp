import type { Result } from './result.ts';

export const ERROR_CODES = [
  'VALIDATION_FAILED',
  'UNAUTHENTICATED',
  'NOT_FOUND',
  'CONFLICT',
  'APPROVAL_EXPIRED',
  'APPROVAL_ALREADY_DECIDED',
  'PAYLOAD_MISMATCH',
  'FORBIDDEN',
  'RATE_LIMITED',
  'UNAVAILABLE',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];
export type SafeErrorDetails = Readonly<Record<string, string | number | boolean>>;

export type AppError<C extends ErrorCode = ErrorCode> = {
  readonly code: C;
  readonly message: string;
  readonly details?: SafeErrorDetails;
};

export const appError = <C extends ErrorCode>(
  code: C,
  message: string,
  details?: SafeErrorDetails,
): AppError<C> => (details === undefined ? { code, message } : { code, message, details });

const HTTP_STATUS: Record<ErrorCode, number> = {
  VALIDATION_FAILED: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  APPROVAL_ALREADY_DECIDED: 409,
  PAYLOAD_MISMATCH: 409,
  APPROVAL_EXPIRED: 410,
  RATE_LIMITED: 429,
  UNAVAILABLE: 503,
};

export const httpStatusFor = (code: ErrorCode): number => HTTP_STATUS[code];

export type ErrorEnvelope = {
  readonly error: {
    readonly code: ErrorCode;
    readonly message: string;
    readonly requestId: string;
    readonly details?: SafeErrorDetails;
  };
};

export const toErrorEnvelope = (error: AppError, requestId: string): ErrorEnvelope => ({
  error:
    error.details === undefined
      ? { code: error.code, message: error.message, requestId }
      : { code: error.code, message: error.message, requestId, details: error.details },
});

export type ApiResult<T, C extends ErrorCode = ErrorCode> = Result<T, AppError<C>>;
