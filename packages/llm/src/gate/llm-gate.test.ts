import assert from 'node:assert/strict';
import test from 'node:test';

import { err, ok, type Result } from '@aetherion/shared';

import { inferenceError, type InferenceError } from '../errors.ts';
import { LlmGate, type GateRunOptions, type Priority } from './llm-gate.ts';

type Outcome = Result<string, InferenceError>;

const deferred = <T>() => {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
};

const options = (priority: Priority, extra: Partial<GateRunOptions> = {}): GateRunOptions => ({
  priority,
  signal: new AbortController().signal,
  deadline: new Date(Date.now() + 10_000),
  ...extra,
});

// A job that stays active until released; resolves with its id.
const blocker = (gate: LlmGate, priority: Priority = 'interactive') => {
  const release = deferred<void>();
  const result = gate.run(async () => {
    await release.promise;
    return ok('blocker');
  }, options(priority));
  return { release: () => release.resolve(), result };
};

const recorder = () => {
  const order: string[] = [];
  const job = (id: string) => () => {
    order.push(id);
    return Promise.resolve<Outcome>(ok(id));
  };
  return { order, job };
};

await test('queue limits reject overflow explicitly per priority', async () => {
  const gate = new LlmGate({ maxInteractive: 2, maxBackground: 1 });
  const active = blocker(gate);
  const { job } = recorder();
  const queued = [
    gate.run(job('i1'), options('interactive')),
    gate.run(job('i2'), options('interactive')),
  ];
  const overflow = await gate.run(job('i3'), options('interactive'));
  assert.deepEqual(overflow.ok ? null : overflow.error.code, 'QUEUE_FULL');
  const bg = gate.run(job('b1'), options('background'));
  const bgOverflow = await gate.run(job('b2'), options('background'));
  assert.equal(bgOverflow.ok ? null : bgOverflow.error.code, 'QUEUE_FULL');
  assert.deepEqual(gate.metrics().queued, { interactive: 2, background: 1 });
  assert.equal(gate.metrics().rejected, 2);
  active.release();
  await Promise.all([active.result, ...queued, bg]);
  assert.equal(gate.metrics().completed, 4);
});

await test('interactive dispatches first; FIFO within a priority', async () => {
  const gate = new LlmGate();
  const active = blocker(gate);
  const { order, job } = recorder();
  const runs = [
    gate.run(job('b1'), options('background')),
    gate.run(job('i1'), options('interactive')),
    gate.run(job('i2'), options('interactive')),
    gate.run(job('b2'), options('background')),
  ];
  active.release();
  await Promise.all(runs);
  assert.deepEqual(order, ['i1', 'i2', 'b1', 'b2']);
});

await test('one waiting background job runs after the interactive streak bound', async () => {
  const gate = new LlmGate({ backgroundEvery: 2 });
  const active = blocker(gate);
  const { order, job } = recorder();
  const runs = [gate.run(job('b1'), options('background'))];
  for (const id of ['i1', 'i2', 'i3', 'i4']) runs.push(gate.run(job(id), options('interactive')));
  active.release();
  await Promise.all(runs);
  // blocker + i1 complete the streak of two, so b1 is admitted before i2.
  assert.deepEqual(order, ['i1', 'b1', 'i2', 'i3', 'i4']);
});

await test('cancelled queued work never reaches the executor', async () => {
  const gate = new LlmGate();
  const active = blocker(gate);
  const controller = new AbortController();
  let calls = 0;
  const queued = gate.run(
    () => {
      calls++;
      return Promise.resolve<Outcome>(ok('x'));
    },
    options('interactive', { signal: controller.signal }),
  );
  controller.abort();
  const result = await queued;
  assert.equal(result.ok ? null : result.error.code, 'CANCELLED');
  assert.equal(gate.metrics().queued.interactive, 0);
  active.release();
  await active.result;
  assert.equal(calls, 0);
  const pre = await gate.run(
    () => Promise.resolve<Outcome>(ok('x')),
    options('interactive', { signal: controller.signal }),
  );
  assert.equal(pre.ok ? null : pre.error.code, 'CANCELLED');
});

await test('active cancellation aborts the job and releases the slot only after teardown', async () => {
  const gate = new LlmGate();
  const controller = new AbortController();
  const events: string[] = [];
  const active = gate.run(
    (signal) =>
      new Promise<Outcome>((resolve) => {
        signal.addEventListener('abort', () => {
          events.push(`aborted:${String(signal.reason)}`);
          setTimeout(() => {
            events.push('teardown');
            resolve(ok('late'));
          }, 20);
        });
      }),
    options('interactive', { signal: controller.signal }),
  );
  const next = gate.run(() => {
    events.push('next');
    return Promise.resolve<Outcome>(ok('next'));
  }, options('interactive'));
  controller.abort();
  const result = await active;
  assert.equal(result.ok ? null : result.error.code, 'CANCELLED');
  await next;
  assert.deepEqual(events, ['aborted:CANCELLED', 'teardown', 'next']);
});

await test('deadline covers queue wait and execution', async () => {
  const gate = new LlmGate();
  const active = blocker(gate);
  let queuedCalls = 0;
  const expired = await gate.run(
    () => {
      queuedCalls++;
      return Promise.resolve<Outcome>(ok('x'));
    },
    options('interactive', { deadline: new Date(Date.now() + 15) }),
  );
  assert.equal(expired.ok ? null : expired.error.code, 'DEADLINE_EXPIRED');
  active.release();
  await active.result;
  assert.equal(queuedCalls, 0);

  let reason: unknown;
  const running = await gate.run(
    (signal) =>
      new Promise<Outcome>((resolve) =>
        signal.addEventListener('abort', () => {
          reason = signal.reason;
          resolve(err(inferenceError('INFERENCE_UNAVAILABLE', 'aborted request')));
        }),
      ),
    options('interactive', { deadline: new Date(Date.now() + 15) }),
  );
  assert.equal(running.ok ? null : running.error.code, 'DEADLINE_EXPIRED');
  assert.equal(reason, 'DEADLINE_EXPIRED');

  const past = await gate.run(
    () => Promise.resolve<Outcome>(ok('x')),
    options('interactive', { deadline: new Date(Date.now() - 1) }),
  );
  assert.equal(past.ok ? null : past.error.code, 'DEADLINE_EXPIRED');

  for (const deadline of [new Date(Number.NaN), new Date(Date.now() + 30 * 86_400_000)])
    assert.throws(
      () => gate.run(() => Promise.resolve<Outcome>(ok('x')), options('interactive', { deadline })),
      RangeError,
    );
});

await test('deadline is enforced at dispatch and settlement even when timers lag', async () => {
  let now = 1_000;
  const gate = new LlmGate({}, () => now);
  const release = deferred<void>();
  const active = gate.run(
    async () => {
      await release.promise;
      now += 100; // clock passes the queued deadline before its timer can fire
      return ok('slow');
    },
    { ...options('interactive'), deadline: new Date(now + 50) },
  );
  let queuedCalls = 0;
  const queued = gate.run(
    () => {
      queuedCalls++;
      return Promise.resolve<Outcome>(ok('x'));
    },
    { ...options('interactive'), deadline: new Date(now + 50) },
  );
  release.resolve();
  const [settled, dispatched] = await Promise.all([active, queued]);
  assert.equal(settled.ok ? null : settled.error.code, 'DEADLINE_EXPIRED');
  assert.equal(dispatched.ok ? null : dispatched.error.code, 'DEADLINE_EXPIRED');
  assert.equal(queuedCalls, 0);
  assert.equal(gate.metrics().active, null);
  const after = await gate.run(() => Promise.resolve<Outcome>(ok('after')), {
    ...options('interactive'),
    deadline: new Date(now + 50),
  });
  assert.deepEqual(after, ok('after'));
});

await test('slot is released after error results and thrown jobs', async () => {
  const gate = new LlmGate();
  const failed = await gate.run(
    () => Promise.resolve<Outcome>(err(inferenceError('INFERENCE_UNAVAILABLE', 'down'))),
    options('interactive'),
  );
  assert.equal(failed.ok ? null : failed.error.code, 'INFERENCE_UNAVAILABLE');
  await assert.rejects(
    gate.run(() => Promise.reject(new Error('bug')), options('interactive')),
    /bug/,
  );
  await assert.rejects(
    gate.run(() => {
      throw new Error('sync bug');
    }, options('interactive')),
    /sync bug/,
  );
  const after = await gate.run(() => Promise.resolve<Outcome>(ok('after')), options('interactive'));
  assert.deepEqual(after, ok('after'));
  assert.equal(gate.metrics().active, null);
});

await test('runs one job at a time and each job exactly once', async () => {
  const gate = new LlmGate();
  let running = 0;
  let peak = 0;
  const calls = new Map<number, number>();
  const runs = Array.from({ length: 20 }, (_, index) =>
    gate.run(
      async () => {
        running++;
        peak = Math.max(peak, running);
        calls.set(index, (calls.get(index) ?? 0) + 1);
        await new Promise((resolve) => setTimeout(resolve, 1));
        running--;
        return ok(String(index));
      },
      options(index % 3 ? 'interactive' : 'background'),
    ),
  );
  const results = await Promise.all(runs);
  assert.equal(peak, 1);
  assert.equal(results.filter((result) => result.ok).length, 20);
  assert.ok([...calls.values()].every((count) => count === 1));
});

await test('metrics report the active label and oldest queue age', async () => {
  let now = 1_000;
  const gate = new LlmGate({}, () => now);
  const release = deferred<void>();
  const active = gate.run(
    async () => {
      await release.promise;
      return ok('x');
    },
    { ...options('interactive'), deadline: new Date(now + 10_000), label: 'chat' },
  );
  const queued = gate.run(() => Promise.resolve<Outcome>(ok('y')), {
    ...options('background'),
    deadline: new Date(now + 10_000),
  });
  now += 250;
  assert.deepEqual(gate.metrics(), {
    active: 'chat',
    queued: { interactive: 0, background: 1 },
    oldestQueuedMs: 250,
    completed: 0,
    rejected: 0,
  });
  release.resolve();
  await Promise.all([active, queued]);
});
