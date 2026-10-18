// `pnpm db:migrate` / `pnpm db:status` (#75): run the pinned Supabase CLI as the single
// migration operator against the loopback Postgres from infra/docker-compose.yml.
// The password travels in PGPASSWORD, never in process arguments, and CLI telemetry is off.
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isPrivateHost } from '@aetherion/shared';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

const COMMANDS = {
  migrate: ['migration', 'up'],
  status: ['migration', 'list'],
} as const;

export type DbCommand = keyof typeof COMMANDS;

export type CliInvocation = {
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string>>;
};

/** Builds the CLI call without running it; throws on a missing or non-private URL. */
export const supabaseInvocation = (
  command: DbCommand,
  env: Readonly<Record<string, string | undefined>>,
): CliInvocation => {
  const raw = env.AETHERION_DATABASE_URL;
  if (!raw || !URL.canParse(raw)) throw new Error('set AETHERION_DATABASE_URL in .env');
  const url = new URL(raw);
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !isPrivateHost(url.hostname))
    throw new Error('AETHERION_DATABASE_URL must be postgres:// on loopback or Tailscale');
  const password = decodeURIComponent(url.password);
  url.password = '';
  return {
    args: [...COMMANDS[command], '--db-url', url.toString()],
    env: {
      SUPABASE_TELEMETRY_DISABLED: '1',
      DO_NOT_TRACK: '1',
      ...(password ? { PGPASSWORD: password } : {}),
    },
  };
};

const main = async () => {
  const command = process.argv[2];
  if (command !== 'migrate' && command !== 'status') {
    console.error('usage: supabase-cli.ts <migrate|status>');
    process.exitCode = 2;
    return;
  }
  let invocation: CliInvocation;
  try {
    invocation = supabaseInvocation(command, process.env);
  } catch (error) {
    console.error((error as Error).message);
    process.exitCode = 1;
    return;
  }
  const child = spawn('pnpm', ['exec', 'supabase', ...invocation.args], {
    cwd: root,
    env: { ...process.env, ...invocation.env },
    stdio: 'inherit',
  });
  process.exitCode = await new Promise<number>((done) =>
    child.on('close', (code) => done(code ?? 1)),
  );
};

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
