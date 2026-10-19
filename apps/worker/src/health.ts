import { createServer, type Server, type ServerResponse } from 'node:http';

import type { QueueCounts } from './runtime.ts';

export type HealthProbe = {
  // True when Redis answers PING within the probe's own timeout.
  readonly redis: () => Promise<boolean>;
  readonly counts: () => Promise<QueueCounts>;
};

const send = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
};

/**
 * Liveness and readiness only; no payloads, paths or URLs. Not a public API: bound to the
 * configured private host by main.ts.
 */
export const createHealthServer = (probe: HealthProbe): Server =>
  createServer((req, res) => {
    if (req.method !== 'GET') return send(res, 405, { error: 'method not allowed' });
    if (req.url === '/livez') return send(res, 200, { status: 'ok' });
    if (req.url === '/readyz') {
      void (async () => {
        const redis = await probe.redis().catch(() => false);
        const counts = redis ? await probe.counts().catch(() => undefined) : undefined;
        send(res, redis && counts ? 200 : 503, {
          status: redis && counts ? 'ready' : 'not_ready',
          redis: redis ? 'ok' : 'unavailable',
          ...(counts ? { queue: counts } : {}),
        });
      })();
      return;
    }
    send(res, 404, { error: 'not found' });
  });
