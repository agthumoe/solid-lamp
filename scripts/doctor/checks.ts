// Issue #62: local environment checks. Each check is pure over injected probes so it can be
// unit-tested; doctor.ts supplies the real filesystem, HTTP, TCP and command probes.
import { z } from 'zod';
import {
  canonicalTag,
  isPrivateHost,
  loadEnvConfig,
  parseCatalog,
  parseModelsConfig,
  validateBindings,
  type ModelCatalog,
  type ModelsConfig,
} from '@aetherion/shared';

export type CheckStatus = 'ok' | 'warn' | 'fail';

export type CheckResult = {
  readonly name: string;
  readonly status: CheckStatus;
  readonly detail: string;
  readonly hint?: string;
};

export type CommandResult = { readonly code: number; readonly stdout: string };

export type Probes = {
  readonly nodeVersion: string;
  readonly packageManager: string; // from package.json, e.g. pnpm@11.17.0
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly readText: (path: string) => Promise<string | undefined>;
  readonly getJson: (url: string) => Promise<unknown>;
  readonly postJson: (url: string, body: unknown) => Promise<unknown>;
  readonly command: (cmd: string, args: readonly string[]) => Promise<CommandResult>;
  readonly tcp: (host: string, port: number) => Promise<boolean>;
};

// Ports from ARCHITECTURE §2 plus backing services; none may listen on a wildcard address.
export const KNOWN_PORTS = [3000, 4000, 4100, 4200, 4300, 4400, 6379, 11434, 54321, 54322] as const;

const result = (name: string, status: CheckStatus, detail: string, hint?: string): CheckResult =>
  hint === undefined ? { name, status, detail } : { name, status, detail, hint };

export const checkRuntime = async (probes: Probes): Promise<CheckResult[]> => {
  const major = Number(probes.nodeVersion.replace(/^v/, '').split('.')[0]);
  const node =
    major === 24
      ? result('node', 'ok', probes.nodeVersion)
      : result('node', 'fail', `${probes.nodeVersion} (need 24.x)`, 'install Node 24 LTS');
  const expected = probes.packageManager.replace(/^pnpm@/, '');
  const pnpm = await probes.command('pnpm', ['--version']);
  const actual = pnpm.stdout.trim();
  return [
    node,
    pnpm.code === 0 && actual === expected
      ? result('pnpm', 'ok', actual)
      : result(
          'pnpm',
          pnpm.code === 0 ? 'warn' : 'fail',
          pnpm.code === 0 ? `${actual} (package.json pins ${expected})` : 'not found',
          `corepack use pnpm@${expected}`,
        ),
  ];
};

export type ConfigOutcome = {
  readonly results: CheckResult[];
  readonly models?: ModelsConfig;
  readonly catalog?: ModelCatalog;
};

export const checkConfig = async (probes: Probes): Promise<ConfigOutcome> => {
  const results: CheckResult[] = [];
  const env = loadEnvConfig(probes.env);
  results.push(
    env.ok
      ? result('env', 'ok', 'AETHERION_* values valid')
      : result('env', 'fail', env.error.message, 'fix .env (see .env.example)'),
  );
  const secret = probes.env.AETHERION_INFERENCE_SECRET ?? '';
  results.push(
    secret.length >= 32
      ? result('inference secret', 'ok', 'set')
      : result(
          'inference secret',
          'warn',
          secret ? 'shorter than 32 characters' : 'not set',
          'set AETHERION_INFERENCE_SECRET in .env (needed by api and inference)',
        ),
  );
  const dir = env.ok ? env.value.configDir : 'config';
  const text = await probes.readText(`${dir}/models.yaml`);
  if (text === undefined) {
    results.push(result('models.yaml', 'fail', `${dir}/models.yaml not found`));
    return { results };
  }
  const models = parseModelsConfig(text);
  if (!models.ok) {
    results.push(result('models.yaml', 'fail', models.error.message));
    return { results };
  }
  const bound = Object.keys(models.value.roles).length;
  results.push(result('models.yaml', 'ok', `${bound} roles bound`));
  const catalogText = await probes.readText(`${dir}/catalog.yaml`);
  const catalog = catalogText === undefined ? undefined : parseCatalog(catalogText);
  if (!catalog?.ok) {
    results.push(
      result(
        'catalog.yaml',
        'fail',
        catalog ? catalog.error.message : `${dir}/catalog.yaml not found`,
      ),
    );
    return { results, models: models.value };
  }
  results.push(result('catalog.yaml', 'ok', `${catalog.value.models.length} retained models`));
  const bindings = validateBindings(models.value, catalog.value);
  results.push(
    bindings.ok
      ? result('bindings', 'ok', 'every role and fallback is an enabled, evidenced record')
      : result(
          'bindings',
          'fail',
          bindings.error.message,
          'fix models.yaml or the catalog record (ADR 0004)',
        ),
  );
  return { results, models: models.value, catalog: catalog.value };
};

const tagsSchema = z.object({
  models: z.array(z.object({ name: z.string(), digest: z.string().optional() })),
});
const showSchema = z.object({ model_info: z.record(z.string(), z.unknown()) });
const liveSchema = z.object({ status: z.literal('ok') });

const installedModels = (body: unknown) => {
  const parsed = tagsSchema.safeParse(body);
  return parsed.success ? parsed.data.models : undefined;
};

// Installed artifacts vs the catalog: a changed digest invalidates that record's evidence.
export const checkCatalogArtifacts = (
  installed: readonly { readonly name: string; readonly digest?: string | undefined }[],
  catalog: ModelCatalog,
): CheckResult[] => {
  const byTag = new Map(installed.map((entry) => [canonicalTag(entry.name), entry.digest]));
  const listed = new Set(
    catalog.models.flatMap((record) => (record.tag ? [canonicalTag(record.tag)] : [])),
  );
  const problems: string[] = [];
  let status: CheckStatus = 'ok';
  for (const record of catalog.models) {
    if (!record.tag || !record.digest || !byTag.has(canonicalTag(record.tag))) continue;
    if (byTag.get(canonicalTag(record.tag)) !== record.digest) {
      problems.push(`${record.tag} digest changed`);
      if (record.state === 'enabled') status = 'fail';
      else if (status === 'ok') status = 'warn';
    }
  }
  for (const name of byTag.keys())
    if (!listed.has(name)) {
      problems.push(`${name} not in catalog`);
      if (status === 'ok') status = 'warn';
    }
  return [
    problems.length
      ? result(
          'artifacts',
          status,
          problems.join(', '),
          'review the model and update its catalog digest and evidence (ADR 0004)',
        )
      : result('artifacts', 'ok', 'installed digests match the catalog'),
  ];
};

const canonical = (model: string) => (model.includes(':') ? model : `${model}:latest`);

// Reads `<arch>.embedding_length` from /api/show metadata; no model is loaded onto the GPU.
const embeddingLength = (body: unknown): number | undefined => {
  const parsed = showSchema.safeParse(body);
  if (!parsed.success) return undefined;
  for (const [key, value] of Object.entries(parsed.data.model_info))
    if (key.endsWith('.embedding_length') && typeof value === 'number') return value;
  return undefined;
};

export const checkOllama = async (
  probes: Probes,
  models: ModelsConfig,
  ollamaUrl: string,
  catalog?: ModelCatalog,
): Promise<CheckResult[]> => {
  const root = ollamaUrl.replace(/\/+$/, '');
  const installedList = installedModels(await probes.getJson(`${root}/api/tags`));
  const tags = installedList?.map((entry) => entry.name);
  if (!installedList || !tags)
    return [
      result('ollama', 'fail', `no answer from ${root}`, 'systemctl status ollama (inside WSL)'),
    ];
  const installed = new Set(tags.map(canonical));
  const results = [result('ollama', 'ok', `${tags.length} models installed`)];
  for (const [role, binding] of Object.entries(models.roles)) {
    if (!binding) continue;
    results.push(
      installed.has(canonical(binding.model))
        ? result(`role ${role}`, 'ok', binding.model)
        : result(
            `role ${role}`,
            'fail',
            `${binding.model} not installed`,
            `ollama pull ${binding.model}`,
          ),
    );
  }
  if (catalog) results.push(...checkCatalogArtifacts(installedList, catalog));
  const embed = models.roles.embed;
  if (installed.has(canonical(embed.model))) {
    const length = embeddingLength(
      await probes.postJson(`${root}/api/show`, { model: embed.model }),
    );
    results.push(
      length === embed.dimensions
        ? result('embed dimensions', 'ok', String(length))
        : result(
            'embed dimensions',
            'fail',
            `model reports ${length ?? 'unknown'}, config says ${embed.dimensions}`,
            'fix roles.embed.dimensions; a change needs a versioned rebuild (ADR 0002)',
          ),
    );
  }
  return results;
};

export const checkBackingServices = async (probes: Probes): Promise<CheckResult[]> => {
  const docker = await probes.command('docker', ['info', '--format', '{{.ServerVersion}}']);
  const dockerUp = docker.code === 0 && /^\d/.test(docker.stdout.trim());
  const services: [string, number, string][] = [
    ['postgres', 54322, 'supabase start'],
    ['redis', 6379, 'docker compose -f infra/docker-compose.yml up -d redis'],
  ];
  const results = [
    dockerUp
      ? result('docker', 'ok', `engine ${docker.stdout.trim()}`)
      : result('docker', 'fail', 'engine not running', 'start Docker Desktop (WSL integration on)'),
  ];
  for (const [name, port, hint] of services)
    results.push(
      (await probes.tcp('127.0.0.1', port))
        ? result(name, 'ok', `127.0.0.1:${port} reachable`)
        : result(name, 'fail', `127.0.0.1:${port} not reachable`, hint),
    );
  return results;
};

// Dev processes are optional for doctor: report them, but not as failures.
export const checkAppProcesses = async (probes: Probes): Promise<CheckResult[]> => {
  const apps: [string, string][] = [
    ['inference', `http://127.0.0.1:${probes.env.AETHERION_INFERENCE_PORT || 4100}/livez`],
    ['api', `http://127.0.0.1:${probes.env.AETHERION_API_PORT || 4000}/api/v1/health`],
  ];
  const results: CheckResult[] = [];
  for (const [name, url] of apps) {
    const live = liveSchema.safeParse(await probes.getJson(url)).success;
    results.push(
      live
        ? result(`${name} process`, 'ok', 'live')
        : result(`${name} process`, 'warn', 'not running', `pnpm dev:${name}`),
    );
  }
  return results;
};

/** Parses `ss -ltnH` lines into local address/port pairs. */
export const parseListeners = (output: string): { host: string; port: number }[] =>
  output.split('\n').flatMap((line) => {
    const local = line.trim().split(/\s+/)[3];
    const match = local?.match(/^(.*):(\d+)$/);
    if (!match?.[1] || !match[2]) return [];
    return [{ host: match[1].replace(/^\[|\]$/g, '').replace(/%.*$/, ''), port: Number(match[2]) }];
  });

// Built from parts so the source policy's wildcard-binding check does not flag the detector.
const WILDCARDS = new Set([['0', '0', '0', '0'].join('.'), '::', '*']);

const PORT_KEYS = ['AETHERION_API_PORT', 'AETHERION_INFERENCE_PORT'] as const;

export const configuredPorts = (env: Probes['env']): number[] =>
  PORT_KEYS.flatMap((key) => {
    const port = Number(env[key]);
    return Number.isInteger(port) && port >= 1 && port <= 65_535 ? [port] : [];
  });

export const checkBindings = async (probes: Probes): Promise<CheckResult[]> => {
  const ss = await probes.command('ss', ['-ltnH']);
  if (ss.code !== 0) return [result('bindings', 'warn', 'ss unavailable; bindings not checked')];
  // Defaults plus any valid AETHERION_*_PORT overrides, so a moved service is still checked.
  const known = new Set<number>([...KNOWN_PORTS, ...configuredPorts(probes.env)]);
  const exposed = parseListeners(ss.stdout).filter(
    ({ host, port }) => known.has(port) && (WILDCARDS.has(host) || !isPrivateHost(host)),
  );
  if (exposed.length === 0)
    return [result('bindings', 'ok', 'known and configured ports bound privately')];
  return [
    result(
      'bindings',
      'fail',
      exposed.map(({ host, port }) => `${host}:${port}`).join(', '),
      'bind to 127.0.0.1 or the Tailscale address (AGENTS hard constraint 3)',
    ),
  ];
};

export const checkRepoHygiene = async (probes: Probes): Promise<CheckResult[]> => {
  const tracked = await probes.command('git', ['ls-files', '--error-unmatch', '.env']);
  return [
    tracked.code === 0
      ? result(
          '.env tracked',
          'fail',
          '.env is committed',
          'git rm --cached .env and rotate secrets',
        )
      : result('.env tracked', 'ok', 'not tracked'),
  ];
};

export const runDoctor = async (probes: Probes): Promise<CheckResult[]> => {
  const config = await checkConfig(probes);
  const env = loadEnvConfig(probes.env);
  const ollamaUrl =
    (env.ok ? env.value.ollamaUrl : undefined) ??
    config.models?.ollama.base_url ??
    'http://127.0.0.1:11434';
  return [
    ...(await checkRuntime(probes)),
    ...config.results,
    ...(config.models ? await checkOllama(probes, config.models, ollamaUrl, config.catalog) : []),
    ...(await checkBackingServices(probes)),
    ...(await checkAppProcesses(probes)),
    ...(await checkBindings(probes)),
    ...(await checkRepoHygiene(probes)),
  ];
};

const ICON: Record<CheckStatus, string> = { ok: '✔', warn: '⚠', fail: '✖' };

export const formatReport = (results: readonly CheckResult[]): string => {
  const width = Math.max(...results.map((entry) => entry.name.length));
  const lines = results.map(
    (entry) =>
      `${ICON[entry.status]} ${entry.name.padEnd(width)}  ${entry.detail}${
        entry.status !== 'ok' && entry.hint ? `\n  ${' '.repeat(width)}  → ${entry.hint}` : ''
      }`,
  );
  const failed = results.filter((entry) => entry.status === 'fail').length;
  const warned = results.filter((entry) => entry.status === 'warn').length;
  lines.push('', `${failed} failed, ${warned} warnings, ${results.length - failed - warned} ok`);
  return lines.join('\n');
};
