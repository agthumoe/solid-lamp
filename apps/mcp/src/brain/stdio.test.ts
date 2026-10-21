// The real entry point over stdio: stdout must carry only MCP protocol frames (logs go to
// stderr), and a misconfigured server exits without writing to stdout.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import test from 'node:test';

import { startFakeApi, statsBody } from '@aetherion/shared/testing';

const entry = new URL('./main.ts', import.meta.url).pathname;
const KEY = 'k'.repeat(40);

const run = (env: Record<string, string>, frames: readonly object[], waitFor: number) =>
  new Promise<{ stdout: string; stderr: string; code: number | null }>((resolve, reject) => {
    const child = spawn(process.execPath, [entry], {
      env: { PATH: process.env.PATH ?? '', ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), 10_000);
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
      if (stdout.split('\n').filter(Boolean).length >= waitFor) child.stdin.end();
    });
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    child.on('error', reject);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, code });
    });
    for (const frame of frames) child.stdin.write(`${JSON.stringify(frame)}\n`);
    if (waitFor === 0) child.stdin.end();
  });

await test('stdout carries only JSON-RPC frames; the call reaches the api with the key', async () => {
  const api = await startFakeApi(() => ({ body: statsBody }));
  try {
    const { stdout, stderr, code } = await run(
      { AETHERION_API_URL: api.url, AETHERION_BRAIN_SERVICE_KEY: KEY },
      [
        {
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2025-06-18',
            capabilities: {},
            clientInfo: { name: 't', version: '0' },
          },
        },
        { jsonrpc: '2.0', method: 'notifications/initialized' },
        {
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/call',
          params: { name: 'brain_stats', arguments: {} },
        },
      ],
      2,
    );

    assert.equal(code, 0, stderr);
    const frames = stdout
      .split('\n')
      .filter(Boolean)
      .map(
        (line) =>
          JSON.parse(line) as { jsonrpc: string; id?: number; result?: { isError?: boolean } },
      );
    assert.ok(frames.every((frame) => frame.jsonrpc === '2.0'));
    assert.deepEqual(
      frames.map((frame) => frame.id),
      [1, 2],
    );
    assert.equal(frames[1]?.result?.isError, false);
    assert.equal(api.requests[0]?.headers['x-aetherion-service-key'], KEY);
    assert.match(stderr, /process\.listening/);
    assert.ok(!stderr.includes(KEY), 'key not logged');
  } finally {
    await api.close();
  }
});

await test('a missing key or non-loopback api URL exits 1 with nothing on stdout', async () => {
  for (const env of [
    {},
    { AETHERION_BRAIN_SERVICE_KEY: 'short' },
    { AETHERION_BRAIN_SERVICE_KEY: KEY, AETHERION_API_URL: 'http://100.101.102.103:4000' },
    { AETHERION_BRAIN_SERVICE_KEY: KEY, AETHERION_API_URL: 'https://127.0.0.1:4000' },
    { AETHERION_BRAIN_SERVICE_KEY: KEY, AETHERION_API_URL: 'http://user:pw@127.0.0.1:4000' },
  ]) {
    const { stdout, stderr, code } = await run(env, [], 0);
    assert.equal(code, 1, JSON.stringify(env));
    assert.equal(stdout, '');
    assert.match(stderr, /invalid environment: AETHERION_/);
    assert.ok(!stderr.includes('pw'));
  }
});
