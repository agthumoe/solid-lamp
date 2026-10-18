import assert from 'node:assert/strict';
import test from 'node:test';

import { checkReadiness, type DependencyStatus, type ReadinessPorts } from './check-readiness.ts';

const ports = (
  database: DependencyStatus,
  inference: DependencyStatus = 'ok',
  ollama: DependencyStatus = 'ok',
): ReadinessPorts => ({
  database: () => Promise.resolve(database),
  inference: () => Promise.resolve({ inference, ollama }),
});

await test('ready only when the database, inference and Ollama are all ok', async () => {
  const ready = await checkReadiness(ports('ok'), new AbortController().signal);

  assert.deepEqual(ready, {
    status: 'ready',
    checks: { database: 'ok', inference: 'ok', ollama: 'ok' },
  });
});

await test('any unavailable or unconfigured dependency makes the service not ready', async () => {
  for (const degraded of [
    ports('unavailable'),
    ports('not_configured'),
    ports('ok', 'unavailable', 'unavailable'),
    ports('ok', 'ok', 'unavailable'),
  ]) {
    const readiness = await checkReadiness(degraded, new AbortController().signal);

    assert.equal(readiness.status, 'not_ready');
  }
});

await test('a hung probe is cut off by the timeout and reported unavailable', async () => {
  const hung: ReadinessPorts = {
    database: (signal) =>
      new Promise((resolve) => signal.addEventListener('abort', () => resolve('unavailable'))),
    inference: () => Promise.resolve({ inference: 'ok', ollama: 'ok' }),
  };

  const started = Date.now();
  const readiness = await checkReadiness(hung, new AbortController().signal, 20);

  assert.equal(readiness.checks.database, 'unavailable');
  assert.ok(Date.now() - started < 1_000);
});
