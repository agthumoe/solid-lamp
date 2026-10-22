import { randomUUID } from 'node:crypto';

import type { Logger } from '@aetherion/shared';
import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';

import {
  registerBrainRoutes,
  type BrainRouteDeps,
} from './features/brain/transport/brain-routes.ts';
import type { ReadinessPorts } from './features/health/application/check-readiness.ts';
import { healthRoutes } from './features/health/transport/health-routes.ts';
import { registerErrorEnvelope } from './plugins/error-envelope.ts';
import { registerServiceScope } from './plugins/service-scope.ts';

export type ServerDeps = {
  readonly readiness: ReadinessPorts;
  readonly logger: Logger;
  // Brain routes (#95), mounted only when a database is configured. They sit behind the
  // fail-closed service scope: no key configured means every brain request is refused.
  readonly brain?: BrainRouteDeps & {
    readonly serviceKey: string | undefined;
    readonly boundHost: string;
  };
};

// Concurrent brain requests (single-user service; embedding is serialized by the gate anyway).
const BRAIN_MAX_IN_FLIGHT = 4;

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
  const brain = deps.brain;
  if (brain)
    registerServiceScope(
      app,
      {
        serviceKey: brain.serviceKey,
        boundHost: brain.boundHost,
        maxInFlight: BRAIN_MAX_IN_FLIGHT,
        logger: deps.logger,
      },
      (scope) => registerBrainRoutes(scope, brain),
    );
  return app;
};
