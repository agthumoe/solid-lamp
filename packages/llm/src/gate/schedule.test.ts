import assert from 'node:assert/strict';
import test from 'node:test';

import { ok, parseModelsConfig, type ModelsConfig, type Result } from '@aetherion/shared';

import type { InferenceError } from '../errors.ts';
import { LlmGate, type GateRunOptions } from './llm-gate.ts';
import { embedInBatches, scheduleGeneration } from './schedule.ts';

const configFor = (chatModel: string, chatCtx = 16384): ModelsConfig => {
  const parsed = parseModelsConfig(`
ollama: { base_url: 'http://localhost:11434' }
roles:
  chat: { model: '${chatModel}', num_ctx: ${chatCtx}, residency: resident, temperature: 0.6 }
  router: { model: 'qwen3.5:9b', num_ctx: 16384, residency: shared, temperature: 0.1 }
  coder: { model: 'qwen3.5:9b', num_ctx: 16384, residency: shared }
  embed: { model: 'qwen3-embedding:0.6b', num_ctx: 8192, residency: resident, dimensions: 4, query_prefix: 'q: ' }
`);
  assert.ok(parsed.ok);
  return parsed.value;
};

const callOptions = (priority: GateRunOptions['priority']) => ({
  priority,
  signal: new AbortController().signal,
  deadline: new Date(Date.now() + 10_000),
});

await test('role identity is snapshotted at enqueue, not at dispatch', async () => {
  const gate = new LlmGate();
  let config = configFor('qwen3.5:9b');
  const deps = { gate, config: () => config };
  let release: () => void = () => undefined;
  const hold = gate.run(
    () =>
      new Promise<Result<string, InferenceError>>(
        (resolve) => (release = () => resolve(ok('held'))),
      ),
    callOptions('interactive'),
  );
  const queued = scheduleGeneration(deps, 'chat', callOptions('interactive'), (snapshot) =>
    Promise.resolve(ok({ model: snapshot.model, numCtx: snapshot.numCtx })),
  );
  config = configFor('qwen3:8b', 8192); // reload while queued
  release();
  await hold;
  const result = await queued;
  assert.ok(result.ok);
  assert.equal(result.value.value.model, 'qwen3.5:9b');
  assert.equal(result.value.value.numCtx, 16384);
  assert.deepEqual(result.value.snapshot.options, { temperature: 0.6 });
  assert.ok(Object.isFrozen(result.value.snapshot));
  const later = await scheduleGeneration(deps, 'chat', callOptions('interactive'), (snapshot) =>
    Promise.resolve(ok({ model: snapshot.model })),
  );
  assert.ok(later.ok);
  assert.equal(later.value.value.model, 'qwen3:8b');
});

await test('primitive and array generation results are preserved, not spread', async () => {
  const deps = { gate: new LlmGate(), config: () => configFor('qwen3.5:9b') };
  const text = await scheduleGeneration(deps, 'chat', callOptions('interactive'), () =>
    Promise.resolve(ok('hello')),
  );
  assert.ok(text.ok);
  assert.equal(text.value.value, 'hello');
  assert.equal(text.value.snapshot.model, 'qwen3.5:9b');
  const list = await scheduleGeneration(deps, 'router', callOptions('interactive'), () =>
    Promise.resolve(ok(['a', 'b'])),
  );
  assert.ok(list.ok);
  assert.deepEqual(list.value.value, ['a', 'b']);
  assert.ok(Array.isArray(list.value.value));
});

await test('unbound role fails before reaching the gate', async () => {
  const gate = new LlmGate();
  let calls = 0;
  const result = await scheduleGeneration(
    { gate, config: () => configFor('qwen3.5:9b') },
    'deep',
    callOptions('interactive'),
    () => {
      calls++;
      return Promise.resolve(ok({}));
    },
  );
  assert.equal(result.ok ? null : result.error.code, 'INFERENCE_UNAVAILABLE');
  assert.equal(calls, 0);
  assert.equal(gate.metrics().completed, 0);
});

await test('embedding batches interleave with interactive work', async () => {
  const gate = new LlmGate();
  const deps = { gate, config: () => configFor('qwen3.5:9b') };
  const order: string[] = [];
  let interactive: Promise<unknown> | undefined;
  const result = await embedInBatches(
    deps,
    ['a', 'b', 'c', 'd', 'e'],
    2,
    callOptions('background'),
    (snapshot, batch) => {
      order.push(`embed:${batch.join('')}`);
      // Interactive request arrives while the first batch runs.
      interactive ??= gate.run(() => {
        order.push('chat');
        return Promise.resolve(ok('answer'));
      }, callOptions('interactive'));
      return Promise.resolve(
        ok(batch.map(() => Array.from({ length: snapshot.dimensions }, () => 0.5))),
      );
    },
  );
  await interactive;
  assert.ok(result.ok);
  assert.equal(result.value.vectors.length, 5);
  assert.equal(result.value.snapshot.queryPrefix, 'q: ');
  assert.deepEqual(order, ['embed:ab', 'chat', 'embed:cd', 'embed:e']);
});

await test('embedding batch count mismatch is INVALID_RESPONSE', async () => {
  const result = await embedInBatches(
    { gate: new LlmGate(), config: () => configFor('qwen3.5:9b') },
    ['a', 'b'],
    2,
    callOptions('background'),
    () => Promise.resolve(ok([[1, 2, 3, 4]])),
  );
  assert.equal(result.ok ? null : result.error.code, 'INVALID_RESPONSE');
});
