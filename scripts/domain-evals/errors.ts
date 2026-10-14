import { z } from 'zod';

export class FixtureError extends Error {
  // Callers supply only internal codes; never include arbitrary fixture strings.
  constructor(code: string) {
    super(code);
    this.name = 'FixtureError';
  }
}
export function fail(code: string): never {
  throw new FixtureError(code);
}
export function safeError(error: unknown): string {
  if (error instanceof FixtureError) return error.message;
  if (error instanceof z.ZodError) {
    // Dynamic record keys may contain private input. Only fixed message codes/count.
    return `DOMAIN_SCHEMA_INVALID:${error.issues.length}`;
  }
  return error instanceof SyntaxError ? 'DOMAIN_JSON_INVALID' : 'DOMAIN_READ_FAILED';
}
