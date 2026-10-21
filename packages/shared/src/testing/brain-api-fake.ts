// Test-only fake of the protected brain api: records requests and answers with scripted bodies.
import { createServer, type IncomingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';

export type Scripted = {
  readonly status?: number;
  readonly body?: unknown;
  readonly raw?: string;
  readonly delayMs?: number;
  readonly headers?: Record<string, string>;
};
export type Recorded = {
  readonly path: string;
  readonly query: URLSearchParams;
  readonly headers: IncomingHttpHeaders;
};

export const startFakeApi = async (answer: (request: Recorded) => Scripted) => {
  const requests: Recorded[] = [];
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const recorded = { path: url.pathname, query: url.searchParams, headers: req.headers };
    requests.push(recorded);
    const scripted = answer(recorded);
    const send = () => {
      res.writeHead(scripted.status ?? 200, {
        'content-type': 'application/json',
        ...scripted.headers,
      });
      res.end(scripted.raw ?? JSON.stringify(scripted.body ?? {}));
    };
    if (scripted.delayMs) setTimeout(send, scripted.delayMs).unref();
    else send();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
};

export const HASH = 'c'.repeat(64);

export const citation = (overrides: Record<string, unknown> = {}) => ({
  display: 'vault:Projects/Plan.md#Goals@L3-7',
  sourceId: 'vault',
  documentId: 'doc-1',
  revision: 2,
  contentHash: HASH,
  chunkId: 'chunk-1',
  versionId: 'v-1',
  path: 'Projects/Plan.md',
  headingPath: ['Goals'],
  headingOccurrence: 1,
  lineStart: 3,
  lineEnd: 7,
  ...overrides,
});

export const searchOk = (snippet = 'Ship the brain.') => ({
  status: 'ok',
  versionId: 'v-1',
  corpus: 'complete',
  mode: 'hybrid',
  tookMs: 12,
  results: [
    {
      chunkId: 'chunk-1',
      documentPath: 'Projects/Plan.md',
      title: 'Plan',
      headingPath: ['Goals'],
      lineStart: 3,
      lineEnd: 7,
      snippet,
      fusedScore: 0.032,
      vectorRank: 1,
      lexicalRank: null,
      cosineSimilarity: 0.71,
      lexicalScore: null,
      citation: citation(),
    },
  ],
});

export const statsBody = {
  activeVersion: null,
  documents: 0,
  chunks: 0,
  embeddedChunks: 0,
  corpus: 'empty',
  sources: [],
};
