import test from 'node:test';
import assert from 'node:assert/strict';
import { Writable } from 'node:stream';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { ESLint } from 'eslint';
import { modelsSchema, privateUrlSchema } from '../bench/schemas.ts';
import { parseOptions, scoreRefusal, completionStatus } from '../bench/policy.ts';
import { createLogger } from '../lib/logger.ts';
import { composeViolations } from './compose-policy.ts';
import { pinViolations } from './package-policy.ts';
import { sourceViolations } from './source-policy.ts';

await test('CLI refuses duplicate flags and refusal format is separate from semantic quality', () => {
  for (const args of [
    ['--label', 'a', '--label', 'b'],
    ['--no-think', '--no-think'],
  ])
    assert.throws(() => parseOptions(args), /duplicate/);
  assert.equal(parseOptions(['--label', 'test']).opt('label'), 'test');
  assert.deepEqual(scoreRefusal("I don't know"), { semantic: true, exact: false });
  assert.deepEqual(scoreRefusal('I don’t know.'), { semantic: true, exact: false });
  assert.deepEqual(scoreRefusal("I don't know."), { semantic: true, exact: true });
  assert.equal(scoreRefusal("I don't know, but here is a guess").semantic, false);
});
await test('required residency failures gate acceptance; eviction observations do not', () => {
  assert.equal(completionStatus(0, 0, [{ kind: 'residency', pass: false }]), 'residency_failed');
  assert.equal(completionStatus(0, 0, [{ kind: 'eviction', pass: false }]), 'complete');
  assert.equal(completionStatus(1, 0, []), 'incomplete');
  assert.equal(completionStatus(0, 1, []), 'complete_with_skips');
});
await test('config validates private endpoints, exact role shape and fallback options', () => {
  for (const url of [
    'https://api.openai.com',
    'http://0.0.0.0:11434',
    'http://user:secret@localhost:11434',
    'http://localhost?token=secret',
  ])
    assert.equal(privateUrlSchema.safeParse(url).success, false);
  for (const url of [
    'http://127.0.0.1:11434',
    'http://localhost:11434',
    'http://[::1]:11434',
    'http://100.64.1.1:11434',
  ])
    assert.equal(privateUrlSchema.safeParse(url).success, true);
  const original = modelsSchema.parse(parse(readFileSync('config/models.yaml', 'utf8')));
  assert.equal(modelsSchema.safeParse({ ...original, unknown: true }).success, false);
  assert.equal(
    modelsSchema.safeParse({ ...original, fallback_embedding_options: {} }).success,
    false,
  );
  assert.equal(
    modelsSchema.safeParse({
      ...original,
      roles: { ...original.roles, chat: { ...original.roles.chat, num_ctx: 0 } },
    }).success,
    false,
  );
});
await test('structured diagnostic logs refuse arbitrary private payloads', () => {
  let output = '';
  const destination = new Writable({
    write(chunk: Buffer, _encoding, done) {
      output += chunk.toString();
      done();
    },
  });
  const logger = createLogger(destination);
  logger.info({ event: 'benchmark.complete', outcome: 'complete', count: 2 });
  assert.ok(output.includes('benchmark.complete'));
  assert.throws(() => logger.info({ ...{ event: 'benchmark.failed', prompt: 'fake-secret' } }));
  assert.ok(!output.includes('fake-secret'));
});
await test('AST policies reject boundary, network and component-size violations', () => {
  assert.ok(
    sourceViolations('/repo/packages/agents/domain/run.ts', "import fastify from 'fastify';")
      .length,
  );
  assert.ok(
    sourceViolations('/repo/apps/api/transport/tasks.ts', "import db from '@aetherion/db';").length,
  );
  assert.ok(
    sourceViolations(
      '/repo/apps/web/src/features/chat/view.tsx',
      "import x from '../brain/queries';",
    ).length,
  );
  assert.ok(sourceViolations('/repo/apps/web/view.tsx', "import x from '../api/code';").length);
  assert.ok(sourceViolations('/repo/apps/api/index.ts', "const host = '0.0.0.0';").length);
  assert.ok(sourceViolations('/repo/packages/llm/index.ts', "import OpenAI from 'openai';").length);
  const huge =
    'export function View() {\n' +
    Array(151).fill('const item = 1;').join('\n') +
    '\nreturn <div/>;\n}';
  assert.ok(
    sourceViolations('/repo/apps/web/view.tsx', huge).some((value) =>
      value.includes('component exceeds'),
    ),
  );
  assert.ok(
    sourceViolations(
      '/repo/apps/web/view.tsx',
      huge.replace('export function View()', 'export default function()'),
    ).length,
  );
  assert.deepEqual(
    sourceViolations('/repo/apps/web/view.tsx', 'export function View(){return <div/>}'),
    [],
  );
});
await test('hook lint rules reject conditional useState and missing Effect dependencies', async () => {
  const eslint = new ESLint();
  const [result] = await eslint.lintText(
    'function View({open, value}) { if(open) useState(0); useEffect(() => console.log(value), []); return null; }',
    { filePath: 'apps/web/src/policy-sample.tsx' },
  );
  assert.ok(result?.messages.some((message) => message.ruleId === 'react-hooks/rules-of-hooks'));
  assert.ok(result?.messages.some((message) => message.ruleId === 'react-hooks/exhaustive-deps'));
});
await test('every manifest pins exact versions; only internal workspace links are exempt', () => {
  assert.deepEqual(
    pinViolations('apps/x/package.json', {
      fastify: '5.12.7',
      '@aetherion/llm': 'workspace:*',
      zod: '^4.0.0',
      left: 'workspace:*',
      next: 'latest',
    }),
    [
      'apps/x/package.json: dependency zod is not exact-pinned',
      'apps/x/package.json: dependency left is not exact-pinned',
      'apps/x/package.json: dependency next is not exact-pinned',
    ],
  );
});
await test('compose services publish only on private hosts and pin images by digest', () => {
  const pinned = 'redis:8@sha256:' + 'a'.repeat(64);
  const wildcard = ['0', '0', '0', '0'].join('.');
  assert.deepEqual(
    composeViolations(
      'infra/compose.yml',
      `
services:
  ok:
    image: ${pinned}
    ports: ['127.0.0.1:6379:6379', { host_ip: '100.64.1.2', published: 80 }, '[::1]:53:53']
  open:
    image: redis:latest
    ports: ['6379:6379', 8080, '${wildcard}:5432:5432', { published: 9000 }]
  host:
    image: ${pinned}
    network_mode: host
    privileged: true
`,
    ),
    [
      'infra/compose.yml: service open image is not pinned by digest',
      'infra/compose.yml: service open publishes "6379:6379" beyond loopback/Tailscale',
      'infra/compose.yml: service open publishes 8080 beyond loopback/Tailscale',
      `infra/compose.yml: service open publishes "${wildcard}:5432:5432" beyond loopback/Tailscale`,
      'infra/compose.yml: service open publishes {"published":9000} beyond loopback/Tailscale',
      'infra/compose.yml: service host uses host networking',
      'infra/compose.yml: service host is privileged',
    ],
  );
  assert.deepEqual(composeViolations('x.yml', 'version: 3'), [
    'x.yml: not a compose file with services',
  ]);
  assert.deepEqual(
    composeViolations('infra/docker-compose.yml', readFileSync('infra/docker-compose.yml', 'utf8')),
    [],
  );
});
await test('import boundaries: public entries only, no app imports, doubles only in tests', async () => {
  const eslint = new ESLint();
  const violations = async (filePath: string, source: string) => {
    const [result] = await eslint.lintText(`${source}\nexport {};\n`, { filePath });
    return (result?.messages ?? [])
      .filter(
        (message) =>
          message.ruleId === 'no-restricted-imports' ||
          message.ruleId === 'aetherion/cross-workspace-relative' ||
          message.ruleId === 'aetherion/restricted-dynamic-import',
      )
      .map((message) => message.message);
  };
  const imports = (...specifiers: string[]) =>
    specifiers.map((specifier, index) => `import * as m${index} from '${specifier}';`).join('\n');

  assert.equal(
    (await violations('apps/api/src/policy-sample.ts', imports('@aetherion/llm/src/errors.ts')))
      .length,
    1,
  );
  assert.equal(
    (
      await violations(
        'apps/api/src/policy-sample.ts',
        imports('../../../packages/llm/src/errors.ts'),
      )
    ).length,
    1,
  );
  // Sibling-package relative paths, re-exports and dynamic imports are resolved, not pattern-matched.
  assert.match(
    (
      await violations(
        'packages/shared/src/policy-sample.ts',
        imports('../../llm/src/gate/llm-gate.ts'),
      )
    )[0] ?? '',
    /leaves packages\/shared for packages\/llm/,
  );
  assert.equal(
    (
      await violations(
        'packages/shared/src/policy-sample.ts',
        "export { LlmGate } from '../../llm/src/gate/llm-gate.ts';",
      )
    ).length,
    1,
  );
  assert.equal(
    (
      await violations(
        'apps/api/src/policy-sample.ts',
        "await import('../../inference/src/server.ts');",
      )
    ).length,
    1,
  );
  // An expression-free template literal is the same static path (#86).
  assert.equal(
    (
      await violations(
        'packages/shared/src/policy-sample.ts',
        'void import(`../../llm/src/errors.ts`);',
      )
    ).length,
    1,
  );
  assert.equal(
    (
      await violations(
        'apps/api/src/policy-sample.ts',
        imports('../../../packages/llm/src/testing/index.ts'),
      )
    ).length,
    1,
  );
  assert.deepEqual(
    await violations(
      'packages/llm/src/policy-sample.ts',
      imports('./gate/llm-gate.ts', '../package.json'),
    ),
    [],
  );
  assert.match(
    (await violations('apps/api/src/policy-sample.ts', imports('@aetherion/llm/testing')))[0] ?? '',
    /Test doubles are for tests only/,
  );
  assert.deepEqual(
    await violations('packages/llm/src/policy-sample.test.ts', imports('@aetherion/llm/testing')),
    [],
  );
  assert.match(
    (await violations('packages/llm/src/policy-sample.ts', imports('@aetherion/api')))[0] ?? '',
    /Apps are entry points/,
  );
  assert.equal(
    (await violations('apps/api/src/policy-sample.ts', imports('@aetherion/inference'))).length,
    1,
  );
  assert.match(
    (await violations('packages/shared/src/policy-sample.ts', imports('@aetherion/llm')))[0] ?? '',
    /depends on nothing internal/,
  );
  assert.equal(
    (
      await violations(
        'apps/web/src/policy-sample.ts',
        imports('@aetherion/llm', '@aetherion/shared', '@aetherion/db'),
      )
    ).length,
    3,
  );
  assert.deepEqual(
    await violations(
      'apps/web/src/policy-sample.ts',
      imports('@aetherion/shared/contracts', 'react', './local.ts'),
    ),
    [],
  );
  assert.deepEqual(
    await violations(
      'apps/api/src/policy-sample.ts',
      imports('@aetherion/llm', '@aetherion/shared', 'fastify', './features/health/x.ts'),
    ),
    [],
  );
});

await test('dynamic imports obey the same package boundaries as static imports', async () => {
  const eslint = new ESLint();
  const dynamic = async (filePath: string, source: string) => {
    const [result] = await eslint.lintText(`${source}\nexport {};\n`, { filePath });
    return (result?.messages ?? []).filter(
      (message) => message.ruleId === 'aetherion/restricted-dynamic-import',
    ).length;
  };

  // The reviewer's reproduction: server packages and test doubles from apps/web.
  assert.equal(await dynamic('apps/web/src/policy-sample.ts', "void import('@aetherion/db');"), 1);
  assert.equal(
    await dynamic('apps/web/src/policy-sample.ts', "void import('@aetherion/llm/testing');"),
    1,
  );
  assert.equal(await dynamic('apps/web/src/policy-sample.ts', 'void import(`@aetherion/llm`);'), 1);
  assert.equal(
    await dynamic('packages/shared/src/policy-sample.ts', "void import('@aetherion/llm');"),
    1,
  );
  assert.equal(
    await dynamic('apps/api/src/policy-sample.ts', "void import('@aetherion/llm/src/errors.ts');"),
    1,
  );
  assert.equal(
    await dynamic('apps/api/src/policy-sample.ts', "void import('@aetherion/inference');"),
    1,
  );
  // Allowed: public entries where permitted, doubles in tests, contracts from web.
  assert.equal(await dynamic('apps/api/src/policy-sample.ts', "void import('@aetherion/llm');"), 0);
  assert.equal(
    await dynamic(
      'packages/llm/src/policy-sample.test.ts',
      "void import('@aetherion/llm/testing');",
    ),
    0,
  );
  assert.equal(
    await dynamic('apps/web/src/policy-sample.ts', "void import('@aetherion/shared/contracts');"),
    0,
  );
});
