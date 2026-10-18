import { isPrivateHost } from '@aetherion/shared';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres, { type Sql } from 'postgres';

import { brainTables } from './schema/brain.ts';

export type Database = PostgresJsDatabase<typeof brainTables>;

export type DatabaseClient = {
  readonly db: Database;
  readonly sql: Sql;
  readonly close: () => Promise<void>;
};

export type DatabaseOptions = {
  readonly url: string;
  readonly maxConnections?: number;
};

// Factory, never a module-level singleton: each process builds one client in its composition
// root and passes it down. The URL must point at a private host (AGENTS hard constraint 3).
export const createDatabaseClient = (options: DatabaseOptions): DatabaseClient => {
  const url = URL.canParse(options.url) ? new URL(options.url) : undefined;
  if (!url || !['postgres:', 'postgresql:'].includes(url.protocol) || !isPrivateHost(url.hostname))
    throw new RangeError('database URL must be postgres:// on loopback or Tailscale');
  const sql = postgres(options.url, {
    max: options.maxConnections ?? 4,
    connect_timeout: 5,
    idle_timeout: 30,
    onnotice: () => undefined,
  });
  return {
    db: drizzle(sql, { schema: brainTables }),
    sql,
    close: () => sql.end({ timeout: 5 }),
  };
};
