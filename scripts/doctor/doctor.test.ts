import assert from 'node:assert/strict';
import test from 'node:test';

import {
  checkBindings,
  checkCatalogArtifacts,
  checkConfig,
  checkOllama,
  checkRuntime,
  formatReport,
  parseListeners,
  runDoctor,
  type CommandResult,
  type Probes,
} from './checks.ts';

const MODELS = `
ollama: { base_url: 'http://127.0.0.1:11434' }
roles:
  chat: { model: 'qwen3.5:9b', num_ctx: 16384, residency: resident }
  router: { model: 'qwen3.5:9b', num_ctx: 16384, residency: shared }
  coder: { model: 'qwen3.5:9b', num_ctx: 16384, residency: shared }
  embed: { model: 'qwen3-embedding:0.6b', num_ctx: 8192, residency: resident, dimensions: 1024 }
`;

const evidence = (scope: string) =>
  `[{ kind: gpu_context, status: passed, scope: [${scope}], ref: docs/HARDWARE.md }]`;
const CATALOG = `
revision: 1
models:
  - { id: general, tag: qwen3.5:9b, digest: ${'a'.repeat(64)}, upstream: x, state: enabled, retained: true, capabilities: [text, tools], roles: [chat, router, coder], evidence: ${evidence('chat, router, coder')} }
  - { id: embed, tag: qwen3-embedding:0.6b, digest: ${'b'.repeat(64)}, upstream: x, state: enabled, retained: true, capabilities: [embedding], dimensions: 1024, roles: [embed], evidence: ${evidence('embed')} }
`;
const INSTALLED = {
  models: [
    { name: 'qwen3.5:9b', digest: 'a'.repeat(64) },
    { name: 'qwen3-embedding:0.6b', digest: 'b'.repeat(64) },
  ],
};

const healthyCommands: Record<string, CommandResult> = {
  pnpm: { code: 0, stdout: '11.17.0\n' },
  docker: { code: 0, stdout: '28.1.1\n' },
  ss: {
    code: 0,
    stdout: 'LISTEN 0 511 127.0.0.1:4100 0.0.0.0:*\nLISTEN 0 4096 127.0.0.1:11434 0.0.0.0:*\n',
  },
  git: { code: 1, stdout: '' },
};

const probes = (
  overrides: Partial<Probes> & { commands?: Record<string, CommandResult> } = {},
): Probes => {
  const commands = { ...healthyCommands, ...overrides.commands };
  return {
    nodeVersion: 'v24.17.0',
    packageManager: 'pnpm@11.17.0',
    env: { AETHERION_INFERENCE_SECRET: 'x'.repeat(40) },
    readText: (path) =>
      Promise.resolve(
        path === 'config/models.yaml'
          ? MODELS
          : path === 'config/catalog.yaml'
            ? CATALOG
            : undefined,
      ),
    getJson: (url) => Promise.resolve(url.endsWith('/api/tags') ? INSTALLED : { status: 'ok' }),
    postJson: () => Promise.resolve({ model_info: { 'qwen3.embedding_length': 1024 } }),
    command: (cmd, args) =>
      Promise.resolve(commands[`${cmd} ${args[0]}`] ?? commands[cmd] ?? { code: 127, stdout: '' }),
    tcp: () => Promise.resolve(true),
    ...overrides,
  };
};

const statuses = (results: { name: string; status: string }[]) =>
  Object.fromEntries(results.map((entry) => [entry.name, entry.status]));

await test('a healthy host passes every check', async () => {
  const results = await runDoctor(probes());

  assert.deepEqual(
    results.filter((entry) => entry.status !== 'ok'),
    [],
  );
});

await test('wrong Node major fails; a pnpm version drift warns', async () => {
  const results = await checkRuntime(
    probes({ nodeVersion: 'v22.3.0', commands: { pnpm: { code: 0, stdout: '10.0.0' } } }),
  );

  assert.deepEqual(statuses(results), { node: 'fail', pnpm: 'warn' });
  assert.match(results[1]?.hint ?? '', /corepack use pnpm@11\.17\.0/);
});

await test('invalid env or models.yaml fail; a missing secret only warns', async () => {
  const badEnv = await checkConfig(probes({ env: { AETHERION_LOG_LEVEL: 'loud' } }));
  const badYaml = await checkConfig(probes({ readText: () => Promise.resolve('roles: {}') }));
  const missing = await checkConfig(probes({ readText: () => Promise.resolve(undefined) }));

  assert.equal(statuses(badEnv.results).env, 'fail');
  assert.equal(statuses(badEnv.results)['inference secret'], 'warn');
  assert.equal(statuses(badYaml.results)['models.yaml'], 'fail');
  assert.equal(statuses(missing.results)['models.yaml'], 'fail');
  assert.equal(badYaml.models, undefined);
});

await test('unreachable Ollama, missing role models and wrong embed dimensions fail', async () => {
  const config = await checkConfig(probes());
  assert.ok(config.models);

  const down = await checkOllama(
    probes({ getJson: () => Promise.resolve(undefined) }),
    config.models,
    'http://127.0.0.1:11434',
  );
  const missing = await checkOllama(
    probes({ getJson: () => Promise.resolve({ models: [{ name: 'qwen3.5:9b' }] }) }),
    config.models,
    'http://127.0.0.1:11434',
  );
  const dims = await checkOllama(
    probes({ postJson: () => Promise.resolve({ model_info: { 'qwen3.embedding_length': 768 } }) }),
    config.models,
    'http://127.0.0.1:11434',
  );

  assert.deepEqual(statuses(down), { ollama: 'fail' });
  assert.equal(statuses(missing)['role embed'], 'fail');
  assert.equal(
    missing.find((entry) => entry.name === 'role embed')?.hint,
    'ollama pull qwen3-embedding:0.6b',
  );
  assert.equal(statuses(dims)['embed dimensions'], 'fail');
});

await test('stopped Docker and unreachable Postgres/Redis fail with hints', async () => {
  const results = await runDoctor(
    probes({ commands: { docker: { code: 1, stdout: '' } }, tcp: () => Promise.resolve(false) }),
  );
  const byName = statuses(results);

  assert.equal(byName.docker, 'fail');
  assert.equal(byName.postgres, 'fail');
  assert.equal(byName.redis, 'fail');
  assert.match(results.find((entry) => entry.name === 'docker')?.hint ?? '', /Docker Desktop/);
});

await test('app processes that are not running are warnings, not failures', async () => {
  const results = await runDoctor(
    probes({
      getJson: (url) => Promise.resolve(url.endsWith('/api/tags') ? INSTALLED : undefined),
    }),
  );

  assert.equal(statuses(results)['inference process'], 'warn');
  assert.equal(statuses(results)['api process'], 'warn');
});

await test('listener parsing handles IPv4, IPv6, wildcards and scoped addresses', () => {
  assert.deepEqual(
    parseListeners(
      [
        'LISTEN 0 511 127.0.0.1:4000 0.0.0.0:*',
        'LISTEN 0 511 0.0.0.0:6379 0.0.0.0:*',
        'LISTEN 0 511 [::]:3000 [::]:*',
        'LISTEN 0 511 *:54322 *:*',
        'LISTEN 0 511 [fe80::1%eth0]:4100 [::]:*',
        '',
      ].join('\n'),
    ),
    [
      { host: '127.0.0.1', port: 4000 },
      { host: '0.0.0.0', port: 6379 },
      { host: '::', port: 3000 },
      { host: '*', port: 54322 },
      { host: 'fe80::1', port: 4100 },
    ],
  );
});

await test('wildcard or LAN binds on known ports fail; unrelated ports are ignored', async () => {
  const exposed = await checkBindings(
    probes({
      commands: {
        ss: {
          code: 0,
          stdout: [
            'LISTEN 0 511 0.0.0.0:6379 0.0.0.0:*',
            'LISTEN 0 511 192.168.1.20:4000 0.0.0.0:*',
            'LISTEN 0 511 0.0.0.0:8080 0.0.0.0:*',
            'LISTEN 0 511 100.100.1.2:3000 0.0.0.0:*',
          ].join('\n'),
        },
      },
    }),
  );
  const unavailable = await checkBindings(probes({ commands: { ss: { code: 127, stdout: '' } } }));

  assert.equal(exposed[0]?.status, 'fail');
  assert.equal(exposed[0]?.detail, '0.0.0.0:6379, 192.168.1.20:4000');
  assert.equal(unavailable[0]?.status, 'warn');
});

await test('a committed .env fails', async () => {
  const results = await runDoctor(probes({ commands: { git: { code: 0, stdout: '.env\n' } } }));

  assert.equal(statuses(results)['.env tracked'], 'fail');
});

await test('the report shows hints only for problems and a summary line', () => {
  const report = formatReport([
    { name: 'node', status: 'ok', detail: 'v24', hint: 'unused' },
    { name: 'docker', status: 'fail', detail: 'down', hint: 'start it' },
  ]);

  assert.doesNotMatch(report, /unused/);
  assert.match(report, /✖ docker {2}down\n.*→ start it/);
  assert.match(report, /1 failed, 0 warnings, 1 ok$/);
});

await test('a missing catalog or a contradictory binding fails', async () => {
  const missing = await checkConfig(
    probes({
      readText: (path) => Promise.resolve(path.endsWith('models.yaml') ? MODELS : undefined),
    }),
  );
  const contradictory = await checkConfig(
    probes({
      readText: (path) =>
        Promise.resolve(
          path.endsWith('models.yaml')
            ? MODELS
            : CATALOG.replace('roles: [chat, router, coder]', 'roles: [chat]'),
        ),
    }),
  );

  assert.equal(statuses(missing.results)['catalog.yaml'], 'fail');
  assert.equal(statuses(contradictory.results).bindings, 'fail');
  assert.match(
    contradictory.results.find((entry) => entry.name === 'bindings')?.detail ?? '',
    /general is not accepted for router/,
  );
});

await test('changed digests fail for enabled records; uncatalogued models warn', async () => {
  const config = await checkConfig(probes());
  assert.ok(config.catalog);

  const changed = checkCatalogArtifacts(
    [
      { name: 'qwen3.5:9b', digest: 'f'.repeat(64) },
      { name: 'qwen3-embedding:0.6b', digest: 'b'.repeat(64) },
    ],
    config.catalog,
  );
  const extra = checkCatalogArtifacts(
    [...INSTALLED.models, { name: 'llama9:70b' }],
    config.catalog,
  );
  const clean = checkCatalogArtifacts(INSTALLED.models, config.catalog);

  assert.equal(changed[0]?.status, 'fail');
  assert.equal(changed[0]?.detail, 'qwen3.5:9b digest changed');
  assert.equal(extra[0]?.status, 'warn');
  assert.equal(extra[0]?.detail, 'llama9:70b not in catalog');
  assert.equal(clean[0]?.status, 'ok');
});

await test('a missing docker compose plugin warns with the WSL integration hint', async () => {
  const results = await runDoctor(
    probes({ commands: { 'docker compose': { code: 1, stdout: '' } } }),
  );
  const compose = results.find((entry) => entry.name === 'docker compose');

  assert.equal(compose?.status, 'warn');
  assert.match(compose?.hint ?? '', /WSL integration/);
  assert.equal(statuses(results).docker, 'ok');
});
