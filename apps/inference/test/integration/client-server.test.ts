// In-process contract test: the real packages/llm client against the real RPC server on an
// ephemeral loopback port, with a scripted Ollama adapter. No model or external service.
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import test from 'node:test';

import { collectStream, createInferenceClient } from '@aetherion/llm';

import { buildServer } from '../../src/server.ts';
import { capturingLogger, fakeAdapter, serviceWith } from '../support/fakes.ts';

const SECRET = 'k'.repeat(48);

const start = async (fake = fakeAdapter()) => {
  const { service, gate } = serviceWith(fake.adapter);
  const app = buildServer({
    service,
    readiness: {
      ollama: () => Promise.resolve(true),
      gate: () => gate.metrics(),
      residency: () => ({ coldLoads: 0, contextReloads: 0, evictions: 0, notResidentAfter: 0 }),
    },
    secret: SECRET,
    logger: capturingLogger().logger,
  });
  await app.listen({ host: '127.0.0.1', port: 0 });
  const { port } = app.server.address() as AddressInfo;
  return { app, fake, gate, baseUrl: `http://127.0.0.1:${port}` };
};

const options = (signal = new AbortController().signal) => ({
  priority: 'interactive' as const,
  signal,
  deadline: new Date(Date.now() + 10_000),
  runId: 'run_1',
});

const input = { role: 'chat' as const, messages: [{ role: 'user' as const, content: 'hi' }] };

await test('generate, stream and embed round-trip through the real server', async () => {
  const { app, baseUrl } = await start();
  const client = createInferenceClient({ baseUrl, secret: SECRET });

  const generated = await client.generate(input, options());
  const streamed = await collectStream(client.stream(input, options()));
  const embedded = await client.embed({ texts: ['x', 'y'], kind: 'query' }, options());
  const ready = await client.ready(AbortSignal.timeout(2_000));
  await app.close();

  assert.ok(generated.ok);
  assert.equal(generated.value.text, 'Hello');
  assert.ok(streamed.ok);
  assert.equal(streamed.value.text, 'Hello');
  assert.equal(streamed.value.model?.role, 'chat');
  assert.ok(embedded.ok);
  assert.equal(embedded.value.vectors.length, 2);
  assert.ok(ready.ok);
  assert.equal(ready.value.status, 'ready');
  assert.equal(ready.value.gate.completed, 3);
});

await test('a wrong secret surfaces as INFERENCE_UNAVAILABLE, not as a thrown error', async () => {
  const { app, baseUrl } = await start();
  const client = createInferenceClient({ baseUrl, secret: 'x'.repeat(48) });

  const result = await client.generate(input, options());
  const events = [];
  for await (const event of client.stream(input, options())) events.push(event);
  await app.close();

  assert.equal(result.ok ? null : result.error.code, 'INFERENCE_UNAVAILABLE');
  assert.deepEqual(
    events.map((event) => event.type),
    ['error'],
  );
});

await test('a request shape the server rejects is a programmer error', async () => {
  const { app, baseUrl } = await start();
  const client = createInferenceClient({ baseUrl, secret: SECRET });

  await assert.rejects(
    client.generate({ ...input, messages: [] }, options()),
    /inference request rejected/,
  );
  await app.close();
});

await test('client cancellation mid-stream cancels the server job and frees the gate', async () => {
  const fake = fakeAdapter({
    stream: async function* (_snapshot, _request, signal) {
      yield { type: 'token', text: 'first ' };
      await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve()));
      yield {
        type: 'error',
        error: { code: 'CANCELLED', message: 'request was cancelled' },
        partial: true,
      };
    },
  });
  const { app, baseUrl, gate } = await start(fake);
  const client = createInferenceClient({ baseUrl, secret: SECRET });
  const controller = new AbortController();

  const events = [];
  for await (const event of client.stream(input, options(controller.signal))) {
    events.push(event);
    if (event.type === 'token') controller.abort();
  }
  for (let i = 0; i < 50 && gate.metrics().active !== null; i++)
    await new Promise((resolve) => setTimeout(resolve, 5));
  await app.close();

  assert.deepEqual(events.at(-1), {
    type: 'error',
    error: { code: 'CANCELLED', message: 'request was cancelled' },
    partial: true,
  });
  assert.equal(gate.metrics().active, null);
});

await test('an unreachable inference service is INFERENCE_UNAVAILABLE', async () => {
  const { app, baseUrl } = await start();
  await app.close();
  const client = createInferenceClient({ baseUrl, secret: SECRET });

  const result = await client.embed({ texts: ['x'], kind: 'query' }, options());

  assert.equal(result.ok ? null : result.error.code, 'INFERENCE_UNAVAILABLE');
});
