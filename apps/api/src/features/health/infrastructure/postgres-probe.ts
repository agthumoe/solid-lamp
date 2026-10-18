import type { Sql } from 'postgres';

import type { DependencyStatus } from '../application/check-readiness.ts';

// `select 1` proves connectivity and auth; the abort signal bounds a hung connection attempt.
export const createPostgresProbe =
  (sql: Sql | undefined) =>
  async (signal: AbortSignal): Promise<DependencyStatus> => {
    if (!sql) return 'not_configured';
    if (signal.aborted) return 'unavailable';
    const query = sql`select 1 as ok`;
    const aborted = new Promise<'unavailable'>((resolve) =>
      signal.addEventListener(
        'abort',
        () => {
          void query.cancel();
          resolve('unavailable');
        },
        { once: true },
      ),
    );
    try {
      return await Promise.race([query.then(() => 'ok' as const), aborted]);
    } catch {
      return 'unavailable';
    }
  };
