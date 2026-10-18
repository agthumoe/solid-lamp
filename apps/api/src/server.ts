import { randomUUID } from 'node:crypto';

import type { Logger } from '@aetherion/shared';
import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';

import type { ReadinessPorts } from './features/health/application/check-readiness.ts';
import { healthRoutes } from './features/health/transport/health-routes.ts';
import { registerErrorEnvelope } from './plugins/error-envelope.ts';

export type ServerDeps = {
  readonly readiness: ReadinessPorts;
  readonly logger: Logger;
};

const BODY_LIMIT_BYTES = 1024 * 1024;

/** Builds the public API without listening or doing I/O; `main.ts` binds it to loopback. */
export const buildServer = (deps: ServerDeps): FastifyInstance => {
  // Inbound request IDs are not trusted; every request gets a fresh one.
  const app = Fastify({
    logger: false,
    bodyLimit: BODY_LIMIT_BYTES,
    requestIdHeader: false,
    genReqId: () => randomUUID(),
  });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  registerErrorEnvelope(app, deps.logger);

  app.addHook('onSend', async (request, reply) => {
    void reply.header('x-request-id', request.id);
  });
  app.addHook('onResponse', async (request, reply) => {
    deps.logger.child({ requestId: request.id }).info({
      event: 'http.request',
      outcome: reply.statusCode < 400 ? 'complete' : 'failed',
      durationMs: Math.round(reply.elapsedTime),
      count: reply.statusCode,
    });
  });

  void app.register(healthRoutes, { ports: deps.readiness });
  return app;
};
