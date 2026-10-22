// Pure recovery-gate rules (#87): configuration, restore-target safety, manifest comparison
// and retention. No I/O here, so every rule is unit-tested.
import { isPrivateHost } from '@aetherion/shared';

export type MaintenanceTarget = {
  readonly user: string;
  readonly password: string;
  readonly database: string;
  // The URL with its password removed, safe to print.
  readonly redacted: string;
};

export type RecoveryConfig = {
  readonly maintenance: MaintenanceTarget;
  readonly maintenanceUrl: string;
  readonly primaryDatabase: string;
  readonly container: string;
  readonly backupDir: string;
  readonly keep: number;
};

const parsePostgresUrl = (raw: string | undefined, key: string): URL => {
  if (!raw || !URL.canParse(raw)) throw new Error(`set ${key} in .env`);
  const url = new URL(raw);
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !isPrivateHost(url.hostname))
    throw new Error(`${key} must be postgres:// on loopback or Tailscale`);
  if (!url.username || url.pathname.length < 2) throw new Error(`${key} needs a user and database`);
  return url;
};

export const loadRecoveryConfig = (env: Readonly<Record<string, string | undefined>>) => {
  const url = parsePostgresUrl(
    env.AETHERION_MAINTENANCE_DATABASE_URL,
    'AETHERION_MAINTENANCE_DATABASE_URL',
  );
  const primary = parsePostgresUrl(env.AETHERION_DATABASE_URL, 'AETHERION_DATABASE_URL');
  // Every connection and the container tools must reach one server; the runtime identity
  // check (recovery.ts) proves the container half before any write.
  if (url.hostname !== primary.hostname || (url.port || '5432') !== (primary.port || '5432'))
    throw new Error(
      'AETHERION_DATABASE_URL and AETHERION_MAINTENANCE_DATABASE_URL must name the same server',
    );
  const keep = Number(env.AETHERION_BACKUP_KEEP || 7);
  if (!Number.isInteger(keep) || keep < 1 || keep > 90)
    throw new Error('AETHERION_BACKUP_KEEP must be an integer from 1 to 90');
  const redacted = new URL(url);
  redacted.password = '';
  const config: RecoveryConfig = {
    maintenance: {
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      database: decodeURIComponent(url.pathname.slice(1)),
      redacted: redacted.toString(),
    },
    maintenanceUrl: url.toString(),
    primaryDatabase: decodeURIComponent(primary.pathname.slice(1)),
    container: env.AETHERION_PG_CONTAINER || 'aetherion-postgres-1',
    backupDir: env.AETHERION_BACKUP_DIR || 'backups',
    keep,
  };
  if (!/^[a-zA-Z0-9_.-]{1,128}$/.test(config.container))
    throw new Error('AETHERION_PG_CONTAINER is not a valid container name');
  return config;
};

const STAMP = /^\d{8}t\d{6}z$/;

export const utcStamp = (now: Date): string =>
  now
    .toISOString()
    .replace(/\.\d{3}Z$/, 'z')
    .replace(/[-:]/g, '')
    .replace('T', 't');

export const restoreTargetName = (now: Date): string => `aetherion_restore_${utcStamp(now)}`;

/** Returns why a restore target is unsafe, or undefined. Existence is checked separately. */
export const unsafeTarget = (
  name: string,
  config: Pick<RecoveryConfig, 'primaryDatabase' | 'maintenance'>,
): string | undefined => {
  const match = /^aetherion_restore_(.+)$/.exec(name);
  if (!match?.[1] || !STAMP.test(match[1]))
    return 'target must be named aetherion_restore_<UTC stamp>';
  if (name === config.primaryDatabase) return 'target is the primary database';
  if (name === config.maintenance.database) return 'target is the maintenance database';
  return undefined;
};

export type Manifest = {
  readonly format: 1;
  readonly createdAt: string;
  readonly sourceDatabase: string;
  readonly migrations: readonly string[];
  readonly counts: Readonly<Record<string, number>>;
  readonly activeVersionId: string | null;
  readonly searchConfigVersionId: string | null;
  // Hashes of ordered content hashes and tsvectors: detect drift without storing note text.
  readonly fingerprints: Readonly<Record<string, string>>;
  // Exact (sequential-scan) nearest neighbours of a fixed vector on the active version.
  readonly vectorProbe: readonly string[];
  // Ordered chunk IDs from brain_search_candidates (hybrid, fixed vector + text) on the active
  // version: the final-schema end-to-end query (#95). Empty without an active version.
  readonly searchProbe: readonly string[];
};

/** Lists every field where the restored database differs from the manifest. */
export const manifestDifferences = (expected: Manifest, actual: Manifest): string[] => {
  const problems: string[] = [];
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  if (!same(expected.migrations, actual.migrations)) problems.push('migrations differ');
  for (const table of new Set([...Object.keys(expected.counts), ...Object.keys(actual.counts)]))
    if (expected.counts[table] !== actual.counts[table])
      problems.push(
        `count ${table}: expected ${expected.counts[table]}, got ${actual.counts[table]}`,
      );
  if (expected.activeVersionId !== actual.activeVersionId)
    problems.push('active embedding version differs');
  if (expected.searchConfigVersionId !== actual.searchConfigVersionId)
    problems.push('search_config pointer differs');
  if (actual.searchConfigVersionId !== actual.activeVersionId)
    problems.push('search_config does not point at the active version');
  for (const key of new Set([
    ...Object.keys(expected.fingerprints),
    ...Object.keys(actual.fingerprints),
  ]))
    if (expected.fingerprints[key] !== actual.fingerprints[key])
      problems.push(`fingerprint ${key} differs`);
  if (!same(expected.vectorProbe, actual.vectorProbe)) problems.push('vector probe differs');
  if (!same(expected.searchProbe, actual.searchProbe)) problems.push('search probe differs');
  return problems;
};

const DUMP = /^aetherion-(\d{8}t\d{6}z)\.dump$/;

/** Dumps beyond the newest `keep`, oldest first; names that are not ours are never touched. */
export const dumpsToPrune = (names: readonly string[], keep: number): string[] =>
  names
    .filter((name) => DUMP.test(name))
    .sort()
    .reverse()
    .slice(keep)
    .reverse();

export const dumpName = (now: Date) => `aetherion-${utcStamp(now)}.dump`;
export const isDumpName = (name: string) => DUMP.test(name);
