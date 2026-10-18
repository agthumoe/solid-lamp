import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { checkReadiness, type ReadinessPorts } from '../application/check-readiness.ts';

const dependencyStatus = z.enum(['ok', 'unavailable', 'not_configured']);

const readinessSchema = z.strictObject({
  status: z.enum(['ready', 'not_ready']),
  checks: z.strictObject({
    database: dependencyStatus,
    inference: dependencyStatus,
    ollama: dependencyStatus,
  }),
});

// Liveness vs readiness: statuses only, no versions, URLs, counters or error text. Owner
// authentication for detailed health arrives with the auth plugin in Phase 3.
export const healthRoutes: FastifyPluginAsyncZod<{ ports: ReadinessPorts }> = (app, { ports }) => {
  app.get(
    '/api/v1/health',
    { schema: { response: { 200: z.strictObject({ status: z.literal('ok') }) } } },
    () => ({ status: 'ok' as const }),
  );

  app.get(
    '/api/v1/health/ready',
    { schema: { response: { 200: readinessSchema, 503: readinessSchema } } },
    async (_request, reply) => {
      const controller = new AbortController();
      // IncomingMessage 'close' fires once the body is read; the response closing early is the
      // signal that the client went away.
      reply.raw.on('close', () => {
        if (!reply.raw.writableFinished) controller.abort();
      });
      const readiness = await checkReadiness(ports, controller.signal);
      return reply.code(readiness.status === 'ready' ? 200 : 503).send(readiness);
    },
  );
  return Promise.resolve();
};
