import assert from 'node:assert/strict';
import test from 'node:test';

import { createFakeInferenceClient } from '@aetherion/llm/testing';
import { err } from '@aetherion/shared';
import postgres from 'postgres';

import { createInferenceProbe } from './inference-probe.ts';
import { createPostgresProbe } from './postgres-probe.ts';

await test('the inference probe reports inference and Ollama separately', async () => {
  const up = createInferenceProbe(createFakeInferenceClient());
  const noOllama = createInferenceProbe(createFakeInferenceClient({ ollamaReady: false }));
  const down = createInferenceProbe({
    ready: () => Promise.resolve(err({ code: 'INFERENCE_UNAVAILABLE', message: 'down' })),
  });
  const signal = new AbortController().signal;

  assert.deepEqual(await up(signal), { inference: 'ok', ollama: 'ok' });
  assert.deepEqual(await noOllama(signal), { inference: 'ok', ollama: 'unavailable' });
  assert.deepEqual(await down(signal), { inference: 'unavailable', ollama: 'unavailable' });
});

await test('no database URL is not_configured; an unreachable database is unavailable', async () => {
  // Port 1 on loopback refuses connections, exercising the real driver without Docker.
  const sql = postgres('postgres://probe:probe@127.0.0.1:1/probe', {
    max: 1,
    connect_timeout: 1,
    onnotice: () => undefined,
  });

  const missing = await createPostgresProbe(undefined)(new AbortController().signal);
  const refused = await createPostgresProbe(sql)(AbortSignal.timeout(3_000));
  await sql.end({ timeout: 1 });

  assert.equal(missing, 'not_configured');
  assert.equal(refused, 'unavailable');
});

await test('an already-aborted probe does not touch the database', async () => {
  const controller = new AbortController();
  controller.abort();
  let queried = false;
  const sql = new Proxy(() => undefined, {
    apply: () => {
      queried = true;
      return Promise.resolve([]);
    },
  }) as unknown as Parameters<typeof createPostgresProbe>[0];

  const status = await createPostgresProbe(sql)(controller.signal);

  assert.equal(status, 'unavailable');
  assert.equal(queried, false);
});
