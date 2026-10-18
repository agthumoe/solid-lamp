import {
  appError,
  httpStatusFor,
  toErrorEnvelope,
  type AppError,
  type Logger,
} from '@aetherion/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { hasZodFastifySchemaValidationErrors } from 'fastify-type-provider-zod';

export const sendAppError = (request: FastifyRequest, reply: FastifyReply, error: AppError) =>
  reply.code(httpStatusFor(error.code)).send(toErrorEnvelope(error, request.id));

/**
 * Maps every failure to the stable `{ error: { code, message, requestId } }` envelope once, at
 * the transport boundary. Validation errors list field paths, never submitted values; stacks
 * and internal messages never reach the client.
 */
export const registerErrorEnvelope = (app: FastifyInstance, logger: Logger): void => {
  app.setErrorHandler((error, request, reply) => {
    if (hasZodFastifySchemaValidationErrors(error)) {
      const paths = error.validation.map((issue) => issue.instancePath || '<root>');
      return sendAppError(
        request,
        reply,
        appError('VALIDATION_FAILED', `invalid request at ${paths.join(', ')}`),
      );
    }
    const status = (error as { statusCode?: unknown }).statusCode;
    if (typeof status === 'number' && status >= 400 && status < 500)
      return sendAppError(request, reply, appError('VALIDATION_FAILED', 'malformed request'));
    logger.child({ requestId: request.id }).error({
      event: 'http.unhandled',
      outcome: 'failed',
      errorCode: 'UNAVAILABLE',
    });
    return sendAppError(request, reply, appError('UNAVAILABLE', 'internal error'));
  });

  app.setNotFoundHandler((request, reply) =>
    sendAppError(request, reply, appError('NOT_FOUND', 'unknown route')),
  );
};
