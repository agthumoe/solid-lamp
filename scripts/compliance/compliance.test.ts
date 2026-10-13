import test from 'node:test';
import assert from 'node:assert/strict';
import { Writable } from 'node:stream';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { ESLint } from 'eslint';
import { modelsSchema, privateUrlSchema } from '../bench/schemas.ts';
import { parseOptions, scoreRefusal, completionStatus } from '../bench/policy.ts';
import { createLogger } from '../lib/logger.ts';
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
