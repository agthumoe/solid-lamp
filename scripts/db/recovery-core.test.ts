import assert from 'node:assert/strict';
import test from 'node:test';

import { restorableEntries } from './recovery-io.ts';
import {
  dumpName,
  dumpsToPrune,
  loadRecoveryConfig,
  manifestDifferences,
  restoreTargetName,
  unsafeTarget,
  type Manifest,
} from './recovery-core.ts';

const env = {
  AETHERION_MAINTENANCE_DATABASE_URL: 'postgresql://postgres:p%40ss@127.0.0.1:54322/postgres',
  AETHERION_DATABASE_URL: 'postgresql://app:x@127.0.0.1:54322/aetherion',
};

const manifest = (extra: Partial<Manifest> = {}): Manifest => ({
  format: 1,
  createdAt: '2026-10-18T00:00:00Z',
  sourceDatabase: 'aetherion',
  migrations: ['20261018120000'],
  counts: { documents: 2, chunks: 5 },
  activeVersionId: '1',
  searchConfigVersionId: '1',
  fingerprints: { chunks: 'a', tsv: 'b' },
  vectorProbe: ['3', '1', '2'],
  searchProbe: ['2', '3'],
  ...extra,
});

await test('config separates maintenance and primary databases and redacts the password', () => {
  const config = loadRecoveryConfig(env);

  assert.equal(config.maintenance.user, 'postgres');
  assert.equal(config.maintenance.password, 'p@ss');
  assert.equal(config.maintenance.database, 'postgres');
  assert.equal(config.primaryDatabase, 'aetherion');
  assert.equal(config.maintenance.redacted, 'postgresql://postgres@127.0.0.1:54322/postgres');
  assert.equal(config.container, 'aetherion-postgres-1');
  assert.equal(config.keep, 7);
});

await test('missing, public or malformed settings are refused', () => {
  const cases = [
    { ...env, AETHERION_MAINTENANCE_DATABASE_URL: undefined },
    { ...env, AETHERION_MAINTENANCE_DATABASE_URL: 'postgresql://u:p@db.example.com/x' },
    { ...env, AETHERION_MAINTENANCE_DATABASE_URL: 'postgresql://127.0.0.1:54322/' },
    { ...env, AETHERION_BACKUP_KEEP: '0' },
    { ...env, AETHERION_BACKUP_KEEP: 'many' },
    { ...env, AETHERION_PG_CONTAINER: 'x; rm -rf /' },
    // Primary and maintenance on different servers (port or host).
    { ...env, AETHERION_DATABASE_URL: 'postgresql://app:x@127.0.0.1:54323/aetherion' },
    { ...env, AETHERION_DATABASE_URL: 'postgresql://app:x@100.64.0.1:54322/aetherion' },
  ];
  for (const values of cases) assert.throws(() => loadRecoveryConfig(values));
});

await test('restore targets must be fresh, stamped and never the primary or maintenance db', () => {
  const config = loadRecoveryConfig(env);
  const target = restoreTargetName(new Date('2026-10-18T12:34:56.789Z'));

  assert.equal(target, 'aetherion_restore_20261018t123456z');
  assert.equal(unsafeTarget(target, config), undefined);
  for (const name of [
    'aetherion',
    'postgres',
    'aetherion_restore_',
    'aetherion_restore_latest',
    'aetherion_restore_20261018t123456z; drop database aetherion',
  ])
    assert.ok(unsafeTarget(name, config), name);
  assert.match(
    unsafeTarget(target, { ...config, primaryDatabase: target }) ?? '',
    /primary database/,
  );
});

await test('manifest comparison names every differing field', () => {
  assert.deepEqual(manifestDifferences(manifest(), manifest()), []);

  const problems = manifestDifferences(
    manifest(),
    manifest({
      migrations: [],
      counts: { documents: 2, chunks: 4, links: 1 },
      activeVersionId: '2',
      searchConfigVersionId: '1',
      fingerprints: { chunks: 'a', tsv: 'changed' },
      vectorProbe: ['1', '3', '2'],
      searchProbe: ['3', '2'],
    }),
  );

  assert.deepEqual(problems, [
    'migrations differ',
    'count chunks: expected 5, got 4',
    'count links: expected undefined, got 1',
    'active embedding version differs',
    'search_config does not point at the active version',
    'fingerprint tsv differs',
    'vector probe differs',
    'search probe differs',
  ]);
});

await test('retention keeps the newest dumps and ignores foreign files', () => {
  const names = [
    dumpName(new Date('2026-10-15T00:00:00Z')),
    dumpName(new Date('2026-10-17T00:00:00Z')),
    'notes.txt',
    dumpName(new Date('2026-10-16T00:00:00Z')),
    'aetherion-20261018t000000z.dump.sha256',
    dumpName(new Date('2026-10-18T00:00:00Z')),
  ];

  assert.deepEqual(dumpsToPrune(names, 2), [
    'aetherion-20261015t000000z.dump',
    'aetherion-20261016t000000z.dump',
  ]);
  assert.deepEqual(dumpsToPrune(names, 10), []);
});

await test('restore skips image-owned default privileges but keeps grants and policies', () => {
  const list = [
    ';',
    '; Archive created at 2026-10-18',
    '215; 1259 17001 TABLE public chunks postgres',
    '4021; 0 0 ACL public TABLE chunks postgres',
    '4022; 826 16999 DEFAULT ACL public DEFAULT PRIVILEGES FOR SEQUENCES supabase_admin',
    '4030; 3256 17100 POLICY public chunks select postgres',
  ].join('\n');

  assert.equal(
    restorableEntries(list),
    [
      ';',
      '; Archive created at 2026-10-18',
      '215; 1259 17001 TABLE public chunks postgres',
      '4021; 0 0 ACL public TABLE chunks postgres',
      '4030; 3256 17100 POLICY public chunks select postgres',
    ].join('\n'),
  );
});
