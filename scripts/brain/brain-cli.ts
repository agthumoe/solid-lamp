// `pnpm run brain:query` / `brain:stats` (#96). The CLI calls the same protected brain api and
// contract as the MCP server (one shared client), so it cannot bypass authorization, relevance
// gates or bounds. Note text is untrusted: it is printed only after control sequences are removed.
import { parseArgs } from 'node:util';

import {
  createBrainApiClient,
  loadBrainClientConfig,
  toBrainSearchQuery,
  type BrainApiClient,
  type BrainApiErrorCode,
} from '@aetherion/shared';
import type { BrainSearchResponse, BrainStatsResponse } from '@aetherion/shared/contracts';

export const EXIT = { ok: 0, failed: 1, usage: 2 } as const;

const SEARCH_DEADLINE_MS = 20_000;
const STATS_DEADLINE_MS = 5_000;

export type Io = { readonly out: (text: string) => void; readonly err: (text: string) => void };
type Env = Readonly<Record<string, string | undefined>>;

// Removes everything a terminal could interpret or that could visually reorder text: C0/C1
// controls (including ESC, so no ANSI/OSC sequences), DEL, line/paragraph separators and bidi
// overrides/isolates. Tabs and line breaks inside note text become single spaces.
const UNSAFE = new RegExp(
  // eslint-disable-next-line no-control-regex -- matching control characters is the point
  '[\\u0000-\\u001f\\u007f-\\u009f\\u2028\\u2029\\u202a-\\u202e\\u2066-\\u2069]',
  'gu',
);
export const sanitizeForTerminal = (text: string): string =>
  text.replace(/[\t\n\r]+/g, ' ').replace(UNSAFE, '\ufffd');

const USAGE_QUERY = `usage: pnpm run brain:query "<question>" [--limit N] [--source ID]... [--tag TAG]...
       [--tag-mode any|all] [--path-prefix DIR] [--lexical] [--json]`;
const USAGE_STATS = 'usage: pnpm run brain:stats [--json]';

const MESSAGES: Record<BrainApiErrorCode, string> = {
  VALIDATION_FAILED: 'the request was rejected as invalid',
  UNAUTHENTICATED: 'the service key was rejected; check AETHERION_BRAIN_SERVICE_KEY',
  FORBIDDEN: 'the brain api refused this client (brain routes are loopback-only)',
  NOT_FOUND: 'not found',
  RATE_LIMITED: 'the brain api is busy; retry shortly',
  UNAVAILABLE: 'the brain api or its embedding service is unavailable (is `pnpm dev:api` running?)',
  DEADLINE_EXPIRED: 'the brain api did not answer in time',
  BAD_RESPONSE: 'the brain api returned a response that does not match the contract',
};

const fmt = (value: number | null) => (value === null ? '–' : value.toFixed(3));

export const formatSearch = (response: BrainSearchResponse): string => {
  const lines = [
    `${response.status} · ${response.mode} · corpus ${response.corpus} · version ${response.versionId ?? 'none'} · ${response.tookMs} ms`,
  ];
  if (response.mode === 'lexical_only') lines.push('degraded: lexical-only search');
  if (response.corpus === 'incomplete') lines.push('warning: the index is incomplete');
  if (response.status === 'not_indexed') lines.push('No active index yet.');
  if (response.status === 'no_match') lines.push('No note passed the relevance gates.');
  response.results.forEach((r, index) => {
    lines.push(
      '',
      `[${index + 1}] ${sanitizeForTerminal(r.citation.display)}`,
      `    fused ${r.fusedScore.toFixed(4)} · vector #${r.vectorRank ?? '–'} (${fmt(r.cosineSimilarity)}) · lexical #${r.lexicalRank ?? '–'} (${fmt(r.lexicalScore)})`,
    );
    if (r.title) lines.push(`    ${sanitizeForTerminal(r.title)}`);
    lines.push(`    ${sanitizeForTerminal(r.snippet)}`);
  });
  return lines.join('\n');
};

export const formatStats = (stats: BrainStatsResponse): string => {
  const version = stats.activeVersion;
  const lines = [
    version
      ? `active version ${version.id} · ${version.dimensions} dims · chunker ${version.chunkerVersion} · promoted ${version.promotedAt}`
      : 'no active version',
    `documents ${stats.documents} · chunks ${stats.chunks} · embedded ${stats.embeddedChunks} · corpus ${stats.corpus}`,
  ];
  for (const source of stats.sources)
    lines.push(
      `  ${source.id}: ${source.documents} documents · last ingest ${source.lastIngestAt ?? 'never'} · last scan ${source.lastScan}`,
    );
  return lines.join('\n');
};

const clientFrom = (env: Env, io: Io): BrainApiClient | undefined => {
  const config = loadBrainClientConfig(env);
  if (!config.ok) {
    io.err(config.error.message);
    return undefined;
  }
  return createBrainApiClient({
    baseUrl: config.value.apiUrl,
    serviceKey: config.value.serviceKey,
  });
};

const failed = (io: Io, code: BrainApiErrorCode) => {
  io.err(`brain api error: ${code}: ${MESSAGES[code]}`);
  return EXIT.failed;
};

const usage = (io: Io, message: string, text: string) => {
  io.err(`${message}\n${text}`);
  return EXIT.usage;
};

const QUERY_OPTIONS = {
  limit: { type: 'string' },
  source: { type: 'string', multiple: true },
  tag: { type: 'string', multiple: true },
  'tag-mode': { type: 'string' },
  'path-prefix': { type: 'string' },
  lexical: { type: 'boolean', default: false },
  json: { type: 'boolean', default: false },
  help: { type: 'boolean', default: false },
} as const;

const parseQueryArgs = (argv: readonly string[]) =>
  parseArgs({ args: [...argv], allowPositionals: true, strict: true, options: QUERY_OPTIONS });

export const runQuery = async (
  argv: readonly string[],
  env: Env,
  io: Io,
  client?: BrainApiClient,
): Promise<number> => {
  let parsed: ReturnType<typeof parseQueryArgs>;
  try {
    parsed = parseQueryArgs(argv);
  } catch (error) {
    return usage(io, (error as Error).message, USAGE_QUERY);
  }
  const { values, positionals } = parsed;
  if (values.help) {
    io.out(USAGE_QUERY);
    return EXIT.ok;
  }
  const tagMode = values['tag-mode'];
  if (tagMode !== undefined && tagMode !== 'any' && tagMode !== 'all')
    return usage(io, '--tag-mode must be any or all', USAGE_QUERY);
  if (values.limit !== undefined && !/^\d+$/.test(values.limit))
    return usage(io, '--limit must be a whole number', USAGE_QUERY);
  const query = toBrainSearchQuery({
    query: positionals.join(' '),
    limit: values.limit === undefined ? undefined : Number(values.limit),
    sources: values.source,
    tags: values.tag,
    tagMode,
    pathPrefix: values['path-prefix'],
    lexicalOnly: values.lexical,
  });
  if (!query.success) {
    const fields = new Set(query.error.issues.map((issue) => issue.path.join('.') || 'query'));
    return usage(io, `invalid ${[...fields].join(', ')}`, USAGE_QUERY);
  }
  const api = client ?? clientFrom(env, io);
  if (!api) return EXIT.failed;
  const result = await api.search(query.data, AbortSignal.timeout(SEARCH_DEADLINE_MS));
  if (!result.ok) return failed(io, result.code);
  io.out(values.json ? JSON.stringify(result.value, null, 2) : formatSearch(result.value));
  return EXIT.ok;
};

const parseStatsArgs = (argv: readonly string[]) =>
  parseArgs({
    args: [...argv],
    strict: true,
    options: {
      json: { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
  });

export const runStats = async (
  argv: readonly string[],
  env: Env,
  io: Io,
  client?: BrainApiClient,
): Promise<number> => {
  let parsed: ReturnType<typeof parseStatsArgs>;
  try {
    parsed = parseStatsArgs(argv);
  } catch (error) {
    return usage(io, (error as Error).message, USAGE_STATS);
  }
  if (parsed.values.help) {
    io.out(USAGE_STATS);
    return EXIT.ok;
  }
  const api = client ?? clientFrom(env, io);
  if (!api) return EXIT.failed;
  const result = await api.stats(AbortSignal.timeout(STATS_DEADLINE_MS));
  if (!result.ok) return failed(io, result.code);
  io.out(parsed.values.json ? JSON.stringify(result.value, null, 2) : formatStats(result.value));
  return EXIT.ok;
};

export const processIo: Io = {
  out: (text) => process.stdout.write(`${text}\n`),
  err: (text) => process.stderr.write(`${text}\n`),
};
