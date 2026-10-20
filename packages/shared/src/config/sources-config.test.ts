import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { parseSourcesConfig, resolveSourceRoot, type SourceConfig } from './sources-config.ts';

const parse = (text: string) => {
  const result = parseSourcesConfig(text);
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
};

await test('defaults keep sources disabled with safe exclusions', () => {
  const config = parse(
    'sources:\n  - { id: notes, kind: obsidian, root: { env: AETHERION_NOTES } }\n',
  );

  assert.deepEqual(config.sources[0], {
    id: 'notes',
    kind: 'obsidian',
    root: { env: 'AETHERION_NOTES' },
    enabled: false,
    include_extensions: ['.md'],
    exclude_dirs: ['.obsidian', '.trash', 'AI-Inbox'],
    max_file_bytes: 2 * 1024 * 1024,
  });
});

await test('the committed sources.yaml keeps the real vault disabled', () => {
  const config = parse(readFileSync('config/sources.yaml', 'utf8'));
  const byId = new Map(config.sources.map((source) => [source.id, source]));

  assert.equal(byId.get('vault')?.enabled, false);
  assert.deepEqual(byId.get('vault')?.root, { env: 'AETHERION_VAULT_ROOT' });
  assert.deepEqual(byId.get('fixture-vault')?.root, { repo_path: 'evals/brain/vault' });
});

await test('invalid configs are rejected with paths, never values', () => {
  const cases = [
    'sources:\n  - { id: a1, kind: obsidian, root: { env: AETHERION_X } }\n  - { id: a1, kind: obsidian, root: { env: AETHERION_Y } }\n',
    'sources:\n  - { id: a1, kind: obsidian, root: { env: HOME } }\n',
    'sources:\n  - { id: a1, kind: obsidian, root: { repo_path: ../secret } }\n',
    'sources:\n  - { id: a1, kind: obsidian, root: { repo_path: /etc } }\n',
    'sources:\n  - { id: a1, kind: obsidian, root: { env: AETHERION_X }, surprise: 1 }\n',
    'sources:\n  - { id: a1, kind: gmail, root: { env: AETHERION_X } }\n',
    'sources:\n  - { id: a1, kind: obsidian, root: { env: AETHERION_X }, exclude_dirs: [../up] }\n',
    'sources: [',
  ];
  for (const text of cases) {
    const result = parseSourcesConfig(text);
    assert.equal(result.ok, false, text);
    assert.doesNotMatch(result.ok ? '' : result.error.message, /secret|\/etc/);
  }
});

const source = (root: SourceConfig['root']): SourceConfig => ({
  id: 'vault',
  kind: 'obsidian',
  root,
  enabled: true,
  include_extensions: ['.md'],
  exclude_dirs: [],
  max_file_bytes: 1024,
});

await test('roots resolve from env (absolute only) or inside the repository', () => {
  const env = { AETHERION_VAULT_ROOT: '/home/owner/vault', AETHERION_REL: 'vault' };

  assert.deepEqual(resolveSourceRoot(source({ env: 'AETHERION_VAULT_ROOT' }), env, '/repo'), {
    ok: true,
    value: '/home/owner/vault',
  });
  assert.deepEqual(resolveSourceRoot(source({ repo_path: 'evals/brain/vault' }), env, '/repo'), {
    ok: true,
    value: '/repo/evals/brain/vault',
  });
  const missing = resolveSourceRoot(source({ env: 'AETHERION_MISSING' }), env, '/repo');
  const relative = resolveSourceRoot(source({ env: 'AETHERION_REL' }), env, '/repo');
  assert.equal(missing.ok ? null : missing.error.message, 'AETHERION_MISSING is not set');
  assert.equal(
    relative.ok ? null : relative.error.message,
    'AETHERION_REL must be an absolute path',
  );
  assert.doesNotMatch(JSON.stringify([missing, relative]), /owner|vault"/);
});
