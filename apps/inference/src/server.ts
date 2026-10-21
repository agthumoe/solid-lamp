import { randomUUID } from 'node:crypto';

import { INFERENCE_KEY_HEADER, RPC_PATHS } from '@aetherion/llm';
import { createSecretCheck, type Logger } from '@aetherion/shared';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  hasZodFastifySchemaValidationErrors,
  serializerCompiler,
  validatorCompiler,
} from 'fastify-type-provider-zod';

import type { InferenceService } from './gate/inference-service.ts';
import { registerHealthRoutes, type ReadinessProbe } from './rpc/health-routes.ts';
import { registerInferenceRoutes, sendError } from './rpc/inference-routes.ts';

export type ServerDeps = {
  readonly service: InferenceService;
  readonly readiness: ReadinessProbe;
  readonly secret: string;
  readonly logger: Logger;
  readonly now?: () => number;
};

// Up to 8 base64 images per vision request; text-only requests are far smaller.
const BODY_LIMIT_BYTES = 64 * 1024 * 1024;

/** Builds the internal RPC server without listening; `main.ts` binds it to loopback. */
export const buildServer = (deps: ServerDeps): FastifyInstance => {
  const now = deps.now ?? Date.now;
  const authorized = createSecretCheck(deps.secret);
  // Fastify's own logger would print raw requests; events go through the safe shared logger.
  const app = Fastify({ logger: false, bodyLimit: BODY_LIMIT_BYTES, genReqId: () => randomUUID() });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.addHook('onRequest', async (request, reply) => {
    if (request.url === RPC_PATHS.live) return;
    if (!authorized(request.headers[INFERENCE_KEY_HEADER]))
      return sendError(reply, 'UNAUTHENTICATED', 'missing or invalid inference key');
  });

  app.addHook('onResponse', async (request, reply) => {
    deps.logger.child({ requestId: request.id }).info({
      event: 'http.request',
      outcome: reply.statusCode < 400 ? 'complete' : 'failed',
      durationMs: Math.round(reply.elapsedTime),
      count: reply.statusCode,
    });
  });

  app.setErrorHandler((error, request, reply) => {
    if (hasZodFastifySchemaValidationErrors(error)) {
      const paths = error.validation.map((issue) => issue.instancePath || '<root>');
      return sendError(reply, 'VALIDATION_FAILED', `invalid request at ${paths.join(', ')}`);
    }
    const status = (error as { statusCode?: unknown }).statusCode;
    if (typeof status === 'number' && status >= 400 && status < 500)
      return sendError(reply, 'VALIDATION_FAILED', 'malformed request');
    deps.logger.child({ requestId: request.id }).error({
      event: 'http.unhandled',
      outcome: 'failed',
      errorCode: 'INTERNAL',
    });
    return sendError(reply, 'INTERNAL', 'internal error');
  });

  app.setNotFoundHandler((_request, reply) => sendError(reply, 'NOT_FOUND', 'unknown route'));

  registerHealthRoutes(app, deps.readiness);
  registerInferenceRoutes(app, deps.service, now);
  return app;
};
