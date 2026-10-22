// Protected brain routes (#95). Registered inside the service scope (plugins/service-scope.ts), so
// key, loopback, origin and concurrency checks run before any of this; responses are no-store.
import { httpStatusFor, toErrorEnvelope, type AppError } from '@aetherion/shared';
import {
  brainNoteQuerySchema,
  brainNoteResponseSchema,
  brainSearchQuerySchema,
  brainSearchResponseSchema,
  brainStatsResponseSchema,
} from '@aetherion/shared/contracts';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';

import { getNote } from '../application/get-note.ts';
import { getStats } from '../application/get-stats.ts';
import type { BrainStore, QueryEmbedder } from '../application/ports.ts';
import { searchBrain } from '../application/search-brain.ts';

export type BrainRouteDeps = {
  readonly store: BrainStore;
  readonly embed: QueryEmbedder;
};

// Overall per-request deadline; a client disconnect aborts earlier.
const REQUEST_DEADLINE_MS = 20_000;

const requestSignal = (request: FastifyRequest, reply: FastifyReply) => {
  const controller = new AbortController();
  reply.raw.on('close', () => {
    if (!reply.raw.writableFinished) controller.abort();
  });
  void request;
  return AbortSignal.any([controller.signal, AbortSignal.timeout(REQUEST_DEADLINE_MS)]);
};

const fail = (request: FastifyRequest, reply: FastifyReply, error: AppError) =>
  reply.code(httpStatusFor(error.code)).send(toErrorEnvelope(error, request.id));

export const registerBrainRoutes = (scope: FastifyInstance, deps: BrainRouteDeps): void => {
  const app = scope.withTypeProvider<ZodTypeProvider>();

  app.get(
    '/api/v1/brain/search',
    {
      schema: { querystring: brainSearchQuerySchema, response: { 200: brainSearchResponseSchema } },
    },
    async (request, reply) => {
      const result = await searchBrain(deps, request.query, requestSignal(request, reply));
      return result.ok ? result.value : fail(request, reply, result.error);
    },
  );

  app.get(
    '/api/v1/brain/note',
    { schema: { querystring: brainNoteQuerySchema, response: { 200: brainNoteResponseSchema } } },
    async (request, reply) => {
      const result = await getNote(deps.store, request.query, requestSignal(request, reply));
      return result.ok ? result.value : fail(request, reply, result.error);
    },
  );

  app.get(
    '/api/v1/brain/stats',
    { schema: { response: { 200: brainStatsResponseSchema } } },
    async (request, reply) => getStats(deps.store, requestSignal(request, reply)),
  );
};
