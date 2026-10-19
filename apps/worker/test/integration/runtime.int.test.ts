// Worker runtime against real Redis (#92). Needs AETHERION_TEST_REDIS_URL (CI service or a
// local throwaway container). Each test uses a unique key prefix and removes its keys.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';

import { err, ok, type Logger } from '@aetherion/shared';
import { QueueEvents } from 'bullmq';
import { Redis } from 'ioredis';

import { INGEST_DOCUMENT, INGEST_RESYNC } from '../../src/jobs/contracts.ts';
import type { JobHandler, JobHandlers } from '../../src/jobs/processor.ts';
import { createWorkerRuntime } from '../../src/runtime.ts';

const URL_ = process.env.AETHERION_TEST_REDIS_URL;
const skip = URL_ ? false : 'AETHERION_TEST_REDIS_URL not set (CI service or local Docker)';

const quiet: Logger = {
  child: () => quiet,
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

const REV = 'c'.repeat(64);
const payload = (path = 'notes/a.md', revision = REV) => ({ sourceId: 'vault', path, revision });

const harness = (document: JobHandler<typeof INGEST_DOCUMENT>) => {
  const connection = new Redis(URL_ ?? '', { maxRetriesPerRequest: null });
  const prefix = `aetherion-test-${randomBytes(4).toString('hex')}`;
  const handlers: JobHandlers = {
    [INGEST_DOCUMENT]: document,
    [INGEST_RESYNC]: () => Promise.resolve(ok(undefined)),
  };
  const runtime = createWorkerRuntime({
    connection,
    handlers,
    logger: quiet,
    prefix,
    drainTimeoutMs: 10_000,
  });
  // QueueEvents needs its own blocking connection; close() does not close one it was given.
  const eventsConnection = connection.duplicate();
  const events = new QueueEvents('ingest', { connection: eventsConnection, prefix });
  const done = (jobId: string) =>
    new Promise<'completed' | 'failed'>((resolve) => {
      events.on('completed', ({ jobId: id }) => id === jobId && resolve('completed'));
      events.on('failed', ({ jobId: id }) => id === jobId && resolve('failed'));
    });
  const cleanup = async () => {
    await runtime.close();
    await runtime.queue.obliterate({ force: true }).catch(() => undefined);
    await events.close();
    const keys = await connection.keys(`${prefix}:*`);
    if (keys.length) await connection.del(...keys);
    eventsConnection.disconnect();
    connection.disconnect();
  };
  return { runtime, events, done, cleanup };
};

await test('an enqueued job reaches its handler with the validated payload', { skip }, async () => {
  const seen: unknown[] = [];
  const h = harness((data) => (seen.push(data), Promise.resolve(ok(undefined))));
  try {
    await h.events.waitUntilReady();
    const jobId = await h.runtime.enqueue(INGEST_DOCUMENT, payload());

    assert.equal(await h.done(jobId), 'completed');
    assert.deepEqual(seen, [payload()]);
  } finally {
    await h.cleanup();
  }
});

await test('a retryable failure is retried, then succeeds', { skip }, async () => {
  let attempts = 0;
  const h = harness(() => {
    attempts++;
    return Promise.resolve(
      attempts < 2 ? err({ code: 'RETRYABLE', message: 'db down' }) : ok(undefined),
    );
  });
  try {
    await h.events.waitUntilReady();
    const jobId = await h.runtime.enqueue(INGEST_DOCUMENT, payload());

    assert.equal(await h.done(jobId), 'completed');
    assert.equal(attempts, 2);
  } finally {
    await h.cleanup();
  }
});

await test('a permanent failure is not retried', { skip }, async () => {
  let attempts = 0;
  const h = harness(() => {
    attempts++;
    return Promise.resolve(err({ code: 'PERMANENT', message: 'refused' }));
  });
  try {
    await h.events.waitUntilReady();
    const jobId = await h.runtime.enqueue(INGEST_DOCUMENT, payload());

    assert.equal(await h.done(jobId), 'failed');
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    assert.equal(attempts, 1);
    assert.equal((await h.runtime.counts()).failed, 1);
  } finally {
    await h.cleanup();
  }
});

await test(
  'the same deterministic job is processed once; a new revision is a new job',
  { skip },
  async () => {
    const seen: string[] = [];
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const h = harness(async (data) => {
      seen.push(data.revision);
      await gate;
      return ok(undefined);
    });
    try {
      await h.events.waitUntilReady();
      const first = await h.runtime.enqueue(INGEST_DOCUMENT, payload());
      const again = await h.runtime.enqueue(INGEST_DOCUMENT, payload());
      const newer = await h.runtime.enqueue(INGEST_DOCUMENT, payload('notes/a.md', 'd'.repeat(64)));
      const finished = Promise.all([h.done(first), h.done(newer)]);
      release();

      assert.equal(first, again);
      assert.notEqual(first, newer);
      assert.deepEqual(await finished, ['completed', 'completed']);
      assert.deepEqual(seen.sort(), [REV, 'd'.repeat(64)]);
    } finally {
      await h.cleanup();
    }
  },
);

await test('close() waits for the active job to finish before returning', { skip }, async () => {
  const order: string[] = [];
  let started: () => void = () => undefined;
  const running = new Promise<void>((resolve) => (started = resolve));
  const h = harness(async () => {
    started();
    await new Promise((resolve) => setTimeout(resolve, 400));
    order.push('job-finished');
    return ok(undefined);
  });
  try {
    await h.events.waitUntilReady();
    await h.runtime.enqueue(INGEST_DOCUMENT, payload());
    await running;

    await h.runtime.close();
    order.push('closed');

    assert.deepEqual(order, ['job-finished', 'closed']);
  } finally {
    await h.cleanup();
  }
});
