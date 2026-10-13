import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { modelsSchema } from './schemas.ts';
import { requiredAt } from '../lib/required-at.ts';
import { parse as parseYaml } from 'yaml';
import {
  Ollama,
  parseTextToolCalls,
  validateArgs,
  validateEmbeddings,
  cosine,
  type JsonSchema,
} from './ollama.ts';
import { claimArtifact, saveArtifact, scoreCalls, residencyCheck } from './integrity.ts';

const artifactSchema = z.object({
  status: z.string(),
  harnessVersion: z.number(),
  error: z.string().default(''),
  finishedAt: z.string().nullable(),
  config: z.object({ roles: z.object({ embed: z.object({ dimensions: z.number() }) }) }),
  embeds: z.array(z.object({ dims: z.number() })).optional(),
  gens: z
    .array(z.object({ required: z.boolean().default(false), skipped: z.string().default('') }))
    .default([]),
  skipped: z.array(z.object({ required: z.boolean(), error: z.string() })).default([]),
  missingRequired: z.array(z.unknown()).default([]),
  coResidency: z.array(z.unknown()).default([]),
  residencySkipped: z.string().default(''),
});

const schema: JsonSchema = {
  type: 'object',
  required: ['query'],
  properties: {
    query: { type: 'string' },
    k: { type: 'integer' },
    tags: { type: 'array', items: { type: 'string' } },
    urgent: { type: 'boolean' },
    status: { type: 'string', enum: ['open', 'done'] },
  },
};
const schemas = new Map([['search', schema]]);
const call = { name: 'search', arguments: { query: 'notes', k: 3 } };
const expected = { name: 'search', args: { query: 'notes', k: 3 } };

await test('scoring rejects extra calls, unknown tools, coercions, and unknown arguments', () => {
  assert.equal(scoreCalls([call], expected, schemas), '');
  assert.match(scoreCalls([call, { name: 'notify', arguments: {} }], expected, schemas), /got 2/);
  assert.match(scoreCalls([{ ...call, name: 'notify' }], expected, schemas), /unknown tool/);
  for (const argumentsValue of [
    { query: 'notes', k: '3' },
    { query: 123 },
    { query: 'notes', urgent: 'true' },
    { query: 'notes', tags: [123] },
    { query: 'notes', unknown: true },
    { query: 'notes', status: 'bad' },
  ]) {
    assert.match(
      scoreCalls([{ name: 'search', arguments: argumentsValue }], expected, schemas),
      /schema:/,
    );
  }
  assert.equal(scoreCalls([], null, schemas), '');
  assert.match(scoreCalls([call], null, schemas), /none was needed/);
  assert.match(scoreCalls([], expected, schemas), /got 0/);
});

await test('repair accepts only whole explicit responses with object arguments', () => {
  const json = JSON.stringify(call);
  for (const text of [json, `<tool_call>${json}</tool_call>`, `\`\`\`json\n${json}\n\`\`\``]) {
    assert.deepEqual(parseTextToolCalls(text), [call]);
  }
  assert.equal(
    parseTextToolCalls(`<tool_call>${json}</tool_call>\n<tool_call>${json}</tool_call>`).length,
    2,
  );
  assert.deepEqual(
    parseTextToolCalls(
      JSON.stringify({ name: 'search', arguments: JSON.stringify(call.arguments) }),
    ),
    [call],
  );
  for (const text of [
    `An example, do not execute: ${json}`,
    `Do not execute <tool_call>${json}</tool_call>`,
    `\`\`\`json\n${json}\n\`\`\`\nThis is an example.`,
    JSON.stringify({ name: 'search', arguments: 42 }),
    JSON.stringify({ name: 'search', arguments: [] }),
    JSON.stringify({ name: 'search' }),
    JSON.stringify({ name: 'search', arguments: null }),
    `${json}\n{bad}`,
    'null',
  ]) {
    assert.deepEqual(parseTextToolCalls(text), []);
  }
});

await test('required keys must be own properties; nonfinite numbers fail', () => {
  assert.ok(validateArgs(schema, Object.create({ query: 'notes' })).length);
  assert.ok(validateArgs({ type: 'number' }, Infinity).length);
});

await test('residency requires presence, context, and full allocation without rounding', () => {
  const requested = [
    { model: 'chat', num_ctx: 4096 },
    { model: 'embed', num_ctx: 2048 },
  ];
  const loaded = requested.map((m) => ({
    name: `${m.model}:latest`,
    context_length: m.num_ctx,
    size: 1000,
    size_vram: 1000,
  }));
  assert.equal(residencyCheck(requested, loaded).pass, true);
  assert.equal(residencyCheck(requested, []).pass, false);
  assert.equal(residencyCheck([], []).pass, false);
  assert.equal(residencyCheck(requested, loaded.slice(1)).pass, false);
  assert.equal(
    residencyCheck(requested, [
      { ...requiredAt(loaded, 0), context_length: 1024 },
      requiredAt(loaded, 1),
    ]).pass,
    false,
  );
  assert.equal(
    residencyCheck(requested, [{ ...requiredAt(loaded, 0), size_vram: 999 }, requiredAt(loaded, 1)])
      .pass,
    false,
  );
  assert.equal(
    residencyCheck(requested, [{ ...requiredAt(loaded, 0), size: 0 }, requiredAt(loaded, 1)]).pass,
    false,
  );
});

await test('atomic artifacts retain partial results and cannot be reclaimed', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aetherion-bench-'));
  try {
    const file = join(dir, 'result.json');
    claimArtifact(file, { status: 'running' });
    saveArtifact(file, { status: 'running', gens: [{ tools: { native: 18 } }] });
    assert.throws(() => claimArtifact(file, {}), /EEXIST/);
    assert.equal(
      z
        .object({ gens: z.array(z.object({ tools: z.object({ native: z.number() }) })) })
        .parse(JSON.parse(readFileSync(file, 'utf8')))
        .gens.map((g) => g.tools.native)
        .join(),
      '18',
    );
    saveArtifact(file, { status: 'failed', gens: [{ tools: { native: 18 } }], error: 'timeout' });
    assert.equal(
      z.object({ status: z.string() }).parse(JSON.parse(readFileSync(file, 'utf8'))).status,
      'failed',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

await test('HTTP paths check status and supply abort signals; stream handles final unterminated line', async (t) => {
  const original = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = original;
  });
  globalThis.fetch = (_url, options) => {
    assert.ok(options?.signal);
    return Promise.resolve(new Response('unavailable', { status: 503 }));
  };
  const client = new Ollama('http://localhost:11434', 1000);
  await assert.rejects(client.version(), /503/);
  await assert.rejects(client.ps(), /503/);
  await assert.rejects(client.chat({ model: 'chat', messages: [] }), /503/);
  globalThis.fetch = () =>
    Promise.resolve(
      new Response(
        JSON.stringify({ message: { role: 'assistant', content: 'OK' }, done: false }) +
          '\n' +
          JSON.stringify({
            message: { role: 'assistant', content: '' },
            done: true,
            eval_count: 1,
            eval_duration: 1,
            total_duration: 1,
            load_duration: 0,
            prompt_eval_count: 0,
            prompt_eval_duration: 0,
          }),
      ),
    );
  const stream = await client.chatStream({ model: 'chat', messages: [] });
  assert.equal(stream.content, 'OK');
  assert.equal(stream.final.eval_count, 1);
  globalThis.fetch = async (_url, options) =>
    new Promise((_resolve, reject) => {
      const signal = options?.signal;
      if (!signal) throw new Error('missing signal');
      signal.addEventListener(
        'abort',
        () => reject(signal.reason instanceof Error ? signal.reason : new Error('request aborted')),
        { once: true },
      );
    });
  // AbortSignal timers are unref'd; keep the event loop alive until this assertion completes.
  const timer = setTimeout(() => {}, 100);
  try {
    await assert.rejects(new Ollama('http://localhost', 10).ps(), /timeout/i);
  } finally {
    clearTimeout(timer);
  }
});

await test('harness writes complete/failed artifacts with stubbed inference and protects existing evidence', () => {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  for (const fail of [false, true]) {
    const label = `test-${randomUUID()}`;
    const file = join(root, 'docs/bench', `results-${label}.json`);
    const preload = `globalThis.fetch = async (url, options) => {
      if (url.endsWith('/api/version')) return Response.json({ version: 'test' });
      if (url.endsWith('/api/ps')) return Response.json({ models: [] });
      if (url.endsWith('/api/embed')) {
        if (${fail}) throw new Error('synthetic embed failure');
        const body = JSON.parse(options.body);
        return Response.json({ embeddings: body.input.map(() => [1, ...Array(1023).fill(0)]) });
      }
      throw new Error('unexpected HTTP path: ' + url);
    };`;
    const args = [
      '--import',
      `data:text/javascript,${encodeURIComponent(preload)}`,
      'scripts/bench/models.ts',
      '--only',
      'embed',
      '--no-fallbacks',
      '--no-coresidency',
      '--label',
      label,
    ];
    try {
      const run = spawnSync(process.execPath, args, {
        cwd: root,
        encoding: 'utf8',
        timeout: 30_000,
      });
      assert.equal(run.status, fail ? 1 : 0, run.stderr);
      const artifact = artifactSchema.parse(JSON.parse(readFileSync(file, 'utf8')));
      assert.equal(artifact.status, fail ? 'failed' : 'complete');
      assert.equal(artifact.harnessVersion, 5);
      assert.ok(artifact.config.roles.embed);
      if (fail) assert.match(artifact.error, /synthetic embed failure/);
      else assert.equal(requiredAt(artifact.embeds ?? [], 0).dims, 1024);
      const before = readFileSync(file, 'utf8');
      const duplicate = spawnSync(process.execPath, args, {
        cwd: root,
        encoding: 'utf8',
        timeout: 30_000,
      });
      assert.equal(duplicate.status, 1);
      assert.equal(readFileSync(file, 'utf8'), before);
    } finally {
      rmSync(file, { force: true });
    }
  }
});

await test('embedding validation rejects malformed batches, invalid values, and bad norms', () => {
  assert.deepEqual(
    validateEmbeddings(
      [
        [1, 0],
        [0, 1],
      ],
      2,
      2,
    ),
    [
      [1, 0],
      [0, 1],
    ],
  );
  for (const vectors of [
    null,
    {},
    [],
    [[1, 0]],
    [[1, 0], [1]],
    [
      [0, 0],
      [1, 0],
    ],
    [
      [NaN, 1],
      [1, 0],
    ],
    [
      [Infinity, 0],
      [1, 0],
    ],
    [
      ['1', 0],
      [1, 0],
    ],
    [
      [null, 0],
      [1, 0],
    ],
    [
      [Number.MAX_VALUE, Number.MAX_VALUE],
      [1, 0],
    ],
  ]) {
    assert.throws(() => validateEmbeddings(vectors, 2, 2), /expected/);
  }
  assert.throws(() => validateEmbeddings([[1]], 1, 1024), /1024 dimensions/);
  assert.throws(() => validateEmbeddings([[]], 1), /positive dimensions/);
  assert.equal(cosine([1, 0], [0, 1]), 0);
  assert.equal(cosine([1e-300, 0], [1e-300, 0]), 1);
  assert.equal(cosine([1e300, 0], [1e300, 0]), 1);
  for (const [left, right] of [
    [
      [0, 0],
      [1, 0],
    ],
    [[1], [1, 0]],
    [[NaN], [1]],
    [[], []],
  ] satisfies [number[], number[]][]) {
    assert.throws(() => cosine(left, right));
  }
});

await test('embed HTTP response must match input count and configured dimensions', async (t) => {
  const original = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = original;
  });
  const client = new Ollama('http://localhost');
  for (const response of [
    null,
    { embeddings: [] },
    { embeddings: [[1]] },
    { embeddings: [[0, 0]] },
  ]) {
    globalThis.fetch = () => Promise.resolve(Response.json(response));
    await assert.rejects(client.embed('embed', ['note'], {}, 2), /expected/);
  }
  globalThis.fetch = () => Promise.resolve(Response.json({ embeddings: [[1, 0]] }));
  assert.deepEqual(await client.embed('embed', ['note'], {}, 2), [[1, 0]]);
});

function stubbedRun(
  mode: string,
  inspect: (artifact: z.infer<typeof artifactSchema>, exitCode: number | null) => void,
) {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const label = `test-${randomUUID()}`;
  const file = join(root, 'docs/bench', `results-${label}.json`);
  // Derive the model from the real YAML config; no runtime/model API calls are made.
  const preload = `
    const cfg = ${JSON.stringify(modelsSchema.parse(parseYaml(readFileSync(join(root, 'config/models.yaml'), 'utf8'))))};
    let primaryBatch = 0;
    let fallbackBatch = 0;
    globalThis.fetch = async (url, options) => {
      if (url.endsWith('/api/version')) return Response.json({ version: 'test' });
      if (url.endsWith('/api/ps')) return Response.json({ models: [] });
      if (url.endsWith('/api/chat')) return Response.json({message:{role:'assistant',content:'OK'},total_duration:1,load_duration:0,prompt_eval_count:1,prompt_eval_duration:1,eval_count:1,eval_duration:1});
      if (url.endsWith('/api/show')) return new Response('synthetic model unavailable', { status: 503 });
      if (url.endsWith('/api/embed')) {
        const body = JSON.parse(options.body);
        const primary = body.model === cfg.roles.embed.model;
        if (primary) primaryBatch++; else fallbackBatch++;
        let dimensions = primary ? cfg.roles.embed.dimensions : 768;
        if ('${mode}' === 'wrong-dimension') dimensions = 1;
        if ('${mode}' === 'dimension-change' && primaryBatch === 5) dimensions--;
        if ('${mode}' === 'optional-fallback' && !primary && fallbackBatch === 2) dimensions--;
        const vectors = body.input.map(() => [1, ...Array(dimensions - 1).fill(0)]);
        if ('${mode}' === 'wrong-count' && primaryBatch === 4) vectors.pop();
        if ('${mode}' === 'zero-norm') vectors.forEach(v => v.fill(0));
        return Response.json({ embeddings: vectors });
      }
      throw new Error('unexpected HTTP path: ' + url);
    };`;
  const args = [
    '--import',
    `data:text/javascript,${encodeURIComponent(preload)}`,
    'scripts/bench/models.ts',
    '--only',
    mode === 'required-skip' ? 'chat' : 'embed',
    '--no-think',
    '--label',
    label,
  ];
  if (mode !== 'optional-fallback') args.push('--no-fallbacks');
  if (!['required-skip', 'residency-failure'].includes(mode)) args.push('--no-coresidency');
  try {
    const run = spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8', timeout: 30_000 });
    assert.ok(readFileSync(file, 'utf8'), run.stderr);
    inspect(artifactSchema.parse(JSON.parse(readFileSync(file, 'utf8'))), run.status);
  } finally {
    rmSync(file, { force: true });
  }
}

await test('required skipped targets exit nonzero and retain partial evidence without residency probes', () => {
  stubbedRun('required-skip', (artifact, exitCode) => {
    assert.equal(exitCode, 1);
    assert.equal(artifact.status, 'incomplete');
    assert.ok(artifact.finishedAt);
    assert.equal(requiredAt(artifact.embeds ?? [], 0).dims, 1024);
    assert.equal(requiredAt(artifact.gens, 0).required, true);
    assert.match(requiredAt(artifact.gens, 0).skipped, /503/);
    assert.equal(artifact.missingRequired.length, 1);
    assert.deepEqual(artifact.coResidency, []);
    assert.match(artifact.residencySkipped, /unavailable/);
  });
});

await test('optional embedding fallback failure is persisted without failing required coverage', () => {
  stubbedRun('optional-fallback', (artifact, exitCode) => {
    assert.equal(exitCode, 0);
    assert.equal(artifact.status, 'complete_with_skips');
    assert.equal(requiredAt(artifact.skipped, 0).required, false);
    assert.match(requiredAt(artifact.skipped, 0).error, /768 dimensions/);
    assert.deepEqual(artifact.missingRequired, []);
    assert.equal(artifact.embeds?.length, 1);
  });
});

await test('harness rejects invalid primary embeddings before accepting retrieval evidence', () => {
  for (const mode of ['wrong-dimension', 'dimension-change', 'wrong-count', 'zero-norm']) {
    stubbedRun(mode, (artifact, exitCode) => {
      assert.equal(exitCode, 1);
      assert.equal(artifact.status, 'failed');
      assert.match(artifact.error, /expected/);
      assert.equal(artifact.embeds, undefined);
      assert.equal(artifact.finishedAt, null);
    });
  }
});

await test('full harness exits nonzero when required residency is absent', () => {
  stubbedRun('residency-failure', (artifact, exitCode) => {
    assert.equal(exitCode, 1);
    assert.equal(artifact.status, 'residency_failed');
    const probes = z
      .array(z.object({ kind: z.string(), pass: z.boolean() }))
      .parse(artifact.coResidency);
    assert.ok(probes.some((probe) => probe.kind === 'residency' && !probe.pass));
    assert.ok(artifact.finishedAt);
  });
});
