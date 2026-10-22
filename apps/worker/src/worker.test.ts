import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import test from 'node:test';

import { err, ok, type LogEvent, type Logger } from '@aetherion/shared';
import { UnrecoverableError } from 'bullmq';

import { UNWIRED_HANDLERS } from './composition.ts';
import { loadWorkerConfig } from './config.ts';
import {
  createMemoryPendingEventStore,
  relayPendingEvents,
  type PendingEvent,
} from './dispatch/pending-events.ts';
import { createHealthServer } from './health.ts';
import {
  INGEST_DOCUMENT,
  INGEST_RESYNC,
  ingestDocumentJobId,
  ingestDocumentPayloadSchema,
  ingestResyncPayloadSchema,
} from './jobs/contracts.ts';
import { createProcessor, type JobError, type JobHandlers } from './jobs/processor.ts';

const REV = 'a'.repeat(64);

const capture = () => {
  const events: LogEvent[] = [];
  const logger: Logger = {
    child: () => logger,
    debug: (event) => events.push(event),
    info: (event) => events.push(event),
    warn: (event) => events.push(event),
    error: (event) => events.push(event),
  };
  return { logger, events };
};

await test('config defaults to loopback Redis and health port 4400, refusing public hosts', () => {
  const config = loadWorkerConfig({});

  assert.ok(config.ok);
  assert.equal(config.value.redisUrl, 'redis://127.0.0.1:6379');
  assert.equal(config.value.host, '127.0.0.1');
  assert.equal(config.value.port, 4400);
  assert.equal(config.value.concurrency, 1);
  for (const env of [
    { AETHERION_REDIS_URL: 'redis://cache.example.com:6379' },
    { AETHERION_REDIS_URL: 'rediss://127.0.0.1:6379' },
    { AETHERION_WORKER_HOST: ['0', '0', '0', '0'].join('.') },
    { AETHERION_WORKER_CONCURRENCY: '64' },
  ]) {
    const result = loadWorkerConfig(env);
    assert.equal(result.ok, false);
    assert.doesNotMatch(result.ok ? '' : result.error.message, /example/);
  }
});

await test('payloads are references only, with normalized paths and exact revisions', () => {
  assert.ok(
    ingestDocumentPayloadSchema.safeParse({ sourceId: 'vault', path: 'notes/a.md', revision: REV })
      .success,
  );
  for (const payload of [
    { sourceId: 'vault', path: '/etc/passwd', revision: REV },
    { sourceId: 'vault', path: 'a/../b.md', revision: REV },
    { sourceId: 'vault', path: 'a//b.md', revision: REV },
    { sourceId: 'vault', path: 'a\0.md', revision: REV },
    { sourceId: 'vault', path: 'a.md', revision: 'not-a-hash' },
    { sourceId: 'vault', path: 'a.md', revision: REV, content: '# private' },
    { sourceId: 'Vault!', path: 'a.md', revision: REV },
  ])
    assert.equal(
      ingestDocumentPayloadSchema.safeParse(payload).success,
      false,
      JSON.stringify(payload),
    );
  assert.ok(ingestResyncPayloadSchema.safeParse({ sourceId: 'vault', scanId: 'scan_1' }).success);
});

await test('job IDs are deterministic, colon-free and change with the revision', () => {
  const base = { sourceId: 'vault', path: 'notes/a.md', revision: REV };
  const id = ingestDocumentJobId(base);

  assert.equal(id, ingestDocumentJobId({ ...base }));
  assert.match(id, /^ingest-document-[0-9a-f]{64}$/);
  assert.notEqual(id, ingestDocumentJobId({ ...base, revision: 'b'.repeat(64) }));
  assert.notEqual(id, ingestDocumentJobId({ ...base, path: 'notes/A.md' }));
  assert.doesNotMatch(id, /notes|:/);
});

await test('job identity follows the durable event: a new event for the same bytes is a new job', () => {
  const base = { sourceId: 'vault', path: 'notes/a.md', revision: REV };
  // A relay re-send of the same event deduplicates...
  assert.equal(
    ingestDocumentJobId({ ...base, eventId: '41' }),
    ingestDocumentJobId({ ...base, eventId: '41' }),
  );
  // ...but a delete after an edit, or an A→B→A edit, is a different event and must run.
  assert.notEqual(
    ingestDocumentJobId({ ...base, eventId: '41' }),
    ingestDocumentJobId({ ...base, eventId: '42' }),
  );
  assert.equal(ingestDocumentPayloadSchema.safeParse({ ...base, eventId: 'x' }).success, false);
});

const handlers = (
  result: () => Promise<{ ok: true; value: void } | { ok: false; error: JobError }>,
) => ({ [INGEST_DOCUMENT]: result, [INGEST_RESYNC]: result }) as unknown as JobHandlers;

const job = (data: unknown, name: string = INGEST_DOCUMENT) => ({
  id: 'j1',
  name,
  data,
  attemptsMade: 0,
});
const valid = { sourceId: 'vault', path: 'notes/a.md', revision: REV };

await test('the processor maps outcomes: retryable throws, permanent and not-wired are unrecoverable', async () => {
  const { logger, events } = capture();

  await createProcessor(
    handlers(() => Promise.resolve(ok(undefined))),
    logger,
  )(job(valid));
  await assert.rejects(
    createProcessor(
      handlers(() => Promise.resolve(err({ code: 'RETRYABLE', message: 'db down' }))),
      logger,
    )(job(valid)),
    (error: Error) => !(error instanceof UnrecoverableError) && error.message === 'db down',
  );
  for (const code of ['PERMANENT', 'NOT_WIRED'] as const)
    await assert.rejects(
      createProcessor(
        handlers(() => Promise.resolve(err({ code, message: code }))),
        logger,
      )(job(valid)),
      UnrecoverableError,
    );
  assert.deepEqual(
    events.map((event) => [event.event, event.errorCode]),
    [
      ['job.complete', undefined],
      ['job.failed', 'RETRYABLE'],
      ['job.failed', 'PERMANENT'],
      ['job.failed', 'NOT_WIRED'],
    ],
  );
});

await test('invalid payloads and unknown jobs fail permanently without calling a handler', async () => {
  const { logger } = capture();
  let calls = 0;
  const processor = createProcessor(
    handlers(() => {
      calls++;
      return Promise.resolve(ok(undefined));
    }),
    logger,
  );

  await assert.rejects(processor(job({ ...valid, path: '../x.md' })), UnrecoverableError);
  await assert.rejects(processor(job(valid, 'ingest.delete-everything')), UnrecoverableError);
  assert.equal(calls, 0);
});

await test('unwired handlers report NOT_WIRED so nothing is silently dropped', async () => {
  const result = await UNWIRED_HANDLERS[INGEST_DOCUMENT](valid, {
    jobId: 'j',
    attempt: 1,
    signal: new AbortController().signal,
    logger: capture().logger,
  });

  assert.equal(result.ok ? null : result.error.code, 'NOT_WIRED');
});

const event = (id: string, path: string): PendingEvent => ({
  id,
  name: INGEST_DOCUMENT,
  payload: { sourceId: 'vault', path, revision: REV },
});

await test('the relay enqueues pending events with deterministic IDs and marks only what it sent', async () => {
  const store = createMemoryPendingEventStore([
    event('e1', 'a.md'),
    event('e2', 'b.md'),
    event('e3', 'c.md'),
  ]);
  const sent: string[] = [];
  const signal = new AbortController().signal;

  const first = await relayPendingEvents(
    store,
    (_name, payload, jobId) => {
      if ((payload as { path: string }).path === 'b.md')
        return Promise.reject(new Error('redis down'));
      sent.push(jobId);
      return Promise.resolve();
    },
    signal,
  );

  assert.deepEqual(first, { dispatched: 2, failed: 1 });
  assert.deepEqual(store.dispatchedIds().sort(), ['e1', 'e3']);
  assert.deepEqual(sent, [
    ingestDocumentJobId(event('e1', 'a.md').payload as never),
    ingestDocumentJobId(event('e3', 'c.md').payload as never),
  ]);

  // The failed event stays pending and is re-sent with the same ID on the next run.
  const second = await relayPendingEvents(
    store,
    (_n, _p, jobId) => (sent.push(jobId), Promise.resolve()),
    signal,
  );
  assert.deepEqual(second, { dispatched: 1, failed: 0 });
  assert.equal(sent.at(-1), ingestDocumentJobId(event('e2', 'b.md').payload as never));
  assert.deepEqual(await relayPendingEvents(store, () => Promise.resolve(), signal), {
    dispatched: 0,
    failed: 0,
  });
});

await test('health reports liveness, readiness with queue counts, and no internals', async () => {
  const counts = { waiting: 2, active: 1, delayed: 0, failed: 3 };
  const up = createHealthServer({
    redis: () => Promise.resolve(true),
    counts: () => Promise.resolve(counts),
  });
  const down = createHealthServer({
    redis: () => Promise.resolve(false),
    counts: () => Promise.resolve(counts),
  });
  const listen = (server: typeof up) =>
    new Promise<string>((resolve) =>
      server.listen(0, '127.0.0.1', () =>
        resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`),
      ),
    );
  try {
    const a = await listen(up);
    const b = await listen(down);

    assert.deepEqual(await (await fetch(`${a}/livez`)).json(), { status: 'ok' });
    const ready = await fetch(`${a}/readyz`);
    assert.equal(ready.status, 200);
    assert.deepEqual(await ready.json(), { status: 'ready', redis: 'ok', queue: counts });
    const notReady = await fetch(`${b}/readyz`);
    assert.equal(notReady.status, 503);
    assert.deepEqual(await notReady.json(), { status: 'not_ready', redis: 'unavailable' });
    assert.equal((await fetch(`${a}/other`)).status, 404);
    assert.equal((await fetch(`${a}/livez`, { method: 'POST' })).status, 405);
  } finally {
    up.close();
    down.close();
  }
});
