// `pnpm doctor`: read-only local environment report (#62). Exit code 1 when any check fails.
// It never changes host settings, installs anything or loads a model onto the GPU.
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { connect } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { formatReport, runDoctor, type CommandResult, type Probes } from './checks.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const TIMEOUT_MS = 3_000;

const readText = async (path: string) => {
  try {
    return await readFile(resolve(root, path), 'utf8');
  } catch {
    return undefined;
  }
};

const request = async (url: string, init?: RequestInit): Promise<unknown> => {
  try {
    const response = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
    return response.ok ? await response.json() : undefined;
  } catch {
    return undefined;
  }
};

const command = (cmd: string, args: readonly string[]) =>
  new Promise<CommandResult>((done) => {
    execFile(cmd, [...args], { cwd: root, timeout: TIMEOUT_MS * 2 }, (error, stdout) => {
      const code = error ? (typeof error.code === 'number' ? error.code : 1) : 0;
      done({ code, stdout: String(stdout) });
    });
  });

const tcp = (host: string, port: number) =>
  new Promise<boolean>((done) => {
    const socket = connect({ host, port, timeout: TIMEOUT_MS });
    const finish = (open: boolean) => {
      socket.destroy();
      done(open);
    };
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });

const manifest = JSON.parse((await readText('package.json')) ?? '{}') as {
  packageManager?: string;
};

const probes: Probes = {
  nodeVersion: process.version,
  packageManager: manifest.packageManager ?? 'pnpm@unknown',
  env: process.env,
  readText,
  getJson: (url) => request(url),
  postJson: (url, body) =>
    request(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  command,
  tcp,
};

const results = await runDoctor(probes);
console.log(formatReport(results));
if (results.some((entry) => entry.status === 'fail')) process.exitCode = 1;
