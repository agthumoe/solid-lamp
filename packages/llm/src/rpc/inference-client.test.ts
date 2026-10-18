import assert from 'node:assert/strict';
import test from 'node:test';

import { createInferenceClient } from './inference-client.ts';

const SECRET = 'q'.repeat(40);

type Init = RequestInit & { headers: Record<string, string> };

const respond =
  (body: string, status = 200, seen: { url: string; init: Init }[] = []) =>
  (url: string, init: RequestInit) => {
    seen.push({ url, init: init as Init });
    return Promise.resolve(new Response(body, { status }));
  };

const options = (deadline = new Date(Date.now() + 10_000)) => ({
  priority: 'background' as const,
  signal: new AbortController().signal,
  deadline,
});

const input = { role: 'router' as const, messages: [{ role: 'user' as const, content: 'x' }] };

await test('requests carry the key header, priority, ISO deadline and run id', async () => {
  const seen: { url: string; init: Init }[] = [];
  const client = createInferenceClient({
    baseUrl: 'http://127.0.0.1:4100/',
    secret: SECRET,
    fetch: respond('{}', 200, seen),
  });
  const deadline = new Date(Date.now() + 5_000);

  await client.generate(input, { ...options(deadline), runId: 'run_9' });

  assert.equal(seen[0]?.url, 'http://127.0.0.1:4100/v1/generate');
  assert.equal(seen[0]?.init.headers['x-aetherion-inference-key'], SECRET);
  assert.deepEqual(JSON.parse(seen[0]?.init.body as string), {
    ...input,
    priority: 'background',
    deadline: deadline.toISOString(),
    runId: 'run_9',
  });
});

await test('a non-private URL is refused at construction', () => {
  assert.throws(
    () => createInferenceClient({ baseUrl: 'http://10.0.0.5:4100', secret: SECRET }),
    RangeError,
  );
});

await test('an expired deadline or aborted signal fails without a request', async () => {
  const seen: { url: string; init: Init }[] = [];
  const client = createInferenceClient({
    baseUrl: 'http://localhost:4100',
    secret: SECRET,
    fetch: respond('{}', 200, seen),
  });
  const aborted = new AbortController();
  aborted.abort();

  const expired = await client.generate(input, options(new Date(Date.now() - 1)));
  const cancelled = await client.embed(
    { texts: ['a'], kind: 'query' },
    { ...options(), signal: aborted.signal },
  );

  assert.equal(expired.ok ? null : expired.error.code, 'DEADLINE_EXPIRED');
  assert.equal(cancelled.ok ? null : cancelled.error.code, 'CANCELLED');
  assert.equal(seen.length, 0);
});

await test('server envelopes map to inference errors; unknown bodies are unavailable', async () => {
  const queueFull = createInferenceClient({
    baseUrl: 'http://localhost:4100',
    secret: SECRET,
    fetch: respond('{"error":{"code":"QUEUE_FULL","message":"full"}}', 429),
  });
  const html = createInferenceClient({
    baseUrl: 'http://localhost:4100',
    secret: SECRET,
    fetch: respond('<html>bad gateway</html>', 502),
  });

  const full = await queueFull.generate(input, options());
  const broken = await html.generate(input, options());

  assert.deepEqual(full.ok ? null : full.error, { code: 'QUEUE_FULL', message: 'full' });
  assert.equal(broken.ok ? null : broken.error.code, 'INFERENCE_UNAVAILABLE');
});

await test('a success body that breaks the contract is INVALID_RESPONSE', async () => {
  const client = createInferenceClient({
    baseUrl: 'http://localhost:4100',
    secret: SECRET,
    fetch: respond('{"vectors":"nope"}'),
  });

  const result = await client.embed({ texts: ['a'], kind: 'document' }, options());

  assert.equal(result.ok ? null : result.error.code, 'INVALID_RESPONSE');
});

await test('streams stop at the first invalid event or report a missing terminal event', async () => {
  const token = JSON.stringify({ type: 'token', text: 'a' });
  const cases = [
    `${token}\n{"type":"surprise"}\n`,
    `${token}\n`,
    `${token}\n{"type":"done"\n`, // malformed JSON line
  ];
  for (const body of cases) {
    const client = createInferenceClient({
      baseUrl: 'http://localhost:4100',
      secret: SECRET,
      fetch: respond(body),
    });

    const events = [];
    for await (const event of client.stream(input, options())) events.push(event);
    const last = events.at(-1);

    assert.equal(events.filter((event) => event.type === 'error').length, 1);
    assert.equal(last?.type === 'error' ? last.partial : null, true);
  }
});

await test('a body that stalls after the headers past the deadline is DEADLINE_EXPIRED', async () => {
  let now = 1_000;
  const stalled = (_url: string, init: RequestInit) =>
    Promise.resolve(
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            // The headers arrive at once; the body never does until the request signal fires.
            init.signal?.addEventListener('abort', () => {
              now += 60_000;
              controller.error(new DOMException('aborted', 'AbortError'));
            });
          },
        }),
      ),
    );
  const client = createInferenceClient({
    baseUrl: 'http://localhost:4100',
    secret: SECRET,
    fetch: stalled,
    now: () => now,
  });
  const caller = new AbortController();
  const pending = client.generate(input, {
    priority: 'interactive',
    signal: caller.signal,
    deadline: new Date(now + 30),
  });

  // AbortSignal.timeout is unref'd; a live server keeps the loop running, so the test does too.
  const keepAlive = setInterval(() => undefined, 1_000);
  const result = await pending.finally(() => clearInterval(keepAlive));

  assert.equal(result.ok ? null : result.error.code, 'DEADLINE_EXPIRED');
  assert.equal(caller.signal.aborted, false);
});

await test('an error response whose body stalls past the deadline is DEADLINE_EXPIRED', async () => {
  let now = 1_000;
  const stalledError = (_url: string, init: RequestInit) =>
    Promise.resolve(
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            init.signal?.addEventListener('abort', () => {
              now += 60_000;
              controller.error(new DOMException('aborted', 'AbortError'));
            });
          },
        }),
        { status: 503 },
      ),
    );
  const client = createInferenceClient({
    baseUrl: 'http://localhost:4100',
    secret: SECRET,
    fetch: stalledError,
    now: () => now,
  });

  const keepAlive = setInterval(() => undefined, 1_000);
  const result = await client
    .embed(
      { texts: ['a'], kind: 'query' },
      { ...options(new Date(now + 30)), priority: 'interactive' },
    )
    .finally(() => clearInterval(keepAlive));

  assert.equal(result.ok ? null : result.error.code, 'DEADLINE_EXPIRED');
});

await test('a caller abort while reading an error body is CANCELLED', async () => {
  const caller = new AbortController();
  const abortingBody = () =>
    Promise.resolve(
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            caller.abort();
            controller.error(new DOMException('aborted', 'AbortError'));
          },
        }),
        { status: 500 },
      ),
    );
  const client = createInferenceClient({
    baseUrl: 'http://localhost:4100',
    secret: SECRET,
    fetch: abortingBody,
  });

  const result = await client.generate(input, { ...options(), signal: caller.signal });

  assert.equal(result.ok ? null : result.error.code, 'CANCELLED');
});
