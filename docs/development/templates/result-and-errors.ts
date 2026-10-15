// Template: expected failures as values, mapped to HTTP once at the transport boundary.
// Real home: packages/shared/src/result.ts and packages/shared/src/errors/.
// Type-checked by `pnpm typecheck`; exercised by backend-feature/decide-approval.test.ts.

export type Ok<T> = { readonly ok: true; readonly value: T };
export type Err<E> = { readonly ok: false; readonly error: E };
export type Result<T, E> = Ok<T> | Err<E>;

export const ok = <T>(value: T): Ok<T> => ({ ok: true, value });
export const err = <E>(error: E): Err<E> => ({ ok: false, error });

// Error codes are a closed `as const` union (no enums: native TS stripping).
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

// An expected failure. `message` is safe to show the owner; never put private content,
// secrets or raw upstream errors in it.
export type AppError<C extends ErrorCode = ErrorCode> = {
  readonly code: C;
  readonly message: string;
  readonly details?: Readonly<Record<string, string | number | boolean>>;
};

export const appError = <C extends ErrorCode>(
  code: C,
  message: string,
  details?: Readonly<Record<string, string | number | boolean>>,
): AppError<C> => (details === undefined ? { code, message } : { code, message, details });

// The single mapping from error code to HTTP status. Exhaustive: adding a code without a
// status is a type error.
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

// The error envelope every API route returns (architecture-api guide). `details` carries
// safe field errors only, never raw payloads.
export type ErrorEnvelope = {
  error: {
    code: ErrorCode;
    message: string;
    requestId: string;
    details?: Readonly<Record<string, string | number | boolean>>;
  };
};

export const toErrorEnvelope = (error: AppError, requestId: string): ErrorEnvelope => ({
  error:
    error.details === undefined
      ? { code: error.code, message: error.message, requestId }
      : { code: error.code, message: error.message, requestId, details: error.details },
});
