import { appError, createSecretCheck, type AppError, type Logger } from '@aetherion/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { sendAppError } from './error-envelope.ts';

export const SERVICE_KEY_HEADER = 'x-aetherion-service-key';

export type ServiceScopeOptions = {
  // Undefined: no key configured, so every scoped request is refused (fail closed).
  readonly serviceKey: string | undefined;
  // The address the API listens on; service routes refuse to serve from a non-loopback bind.
  readonly boundHost: string;
  readonly maxInFlight: number;
  readonly logger: Logger;
};

const isLoopback = (address: string | undefined): boolean => {
  if (address === undefined) return false;
  const host = address
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/^::ffff:/, '');
  return host === 'localhost' || host === '::1' || /^127(?:\.\d{1,3}){3}$/.test(host);
};

/**
 * Registers `routes` behind the service-only boundary (docs/specs/brain-access.md). Every check
 * runs in `onRequest`, before body parsing, validation or any handler work, and every scoped
 * response (errors included) is `no-store`. Logs never carry the URL, query, headers or key.
 */
export const registerServiceScope = (
  app: FastifyInstance,
  options: ServiceScopeOptions,
  routes: (scope: FastifyInstance) => void | Promise<void>,
): void => {
  const check =
    options.serviceKey === undefined ? undefined : createSecretCheck(options.serviceKey);
  const servesLoopbackOnly = isLoopback(options.boundHost);
  let inFlight = 0;

  const reject = (request: FastifyRequest, reply: FastifyReply, error: AppError) => {
    options.logger.child({ requestId: request.id }).warn({
      event: 'http.service_scope',
      outcome: 'skipped',
      errorCode: error.code,
    });
    return sendAppError(request, reply, error);
  };

  void app.register(async (scope) => {
    scope.addHook('onRequest', async (request, reply) => {
      void reply.header('cache-control', 'no-store');
      if (!check)
        return reject(request, reply, appError('UNAVAILABLE', 'service routes are not configured'));
      if (!servesLoopbackOnly || !isLoopback(request.socket.remoteAddress))
        return reject(request, reply, appError('FORBIDDEN', 'service routes are loopback-only'));
      if (request.headers.origin !== undefined || request.headers['sec-fetch-site'] !== undefined)
        return reject(request, reply, appError('FORBIDDEN', 'browser requests are not allowed'));
      if (!check(request.headers[SERVICE_KEY_HEADER]))
        return reject(
          request,
          reply,
          appError('UNAUTHENTICATED', 'missing or invalid service key'),
        );
      if (inFlight >= options.maxInFlight)
        return reject(request, reply, appError('RATE_LIMITED', 'too many concurrent requests'));
      inFlight += 1;
      // `close` fires once whether the response finished or the client went away.
      reply.raw.once('close', () => {
        inFlight -= 1;
      });
    });
    await routes(scope);
  });
};
