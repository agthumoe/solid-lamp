import { Readable } from 'node:stream';

import {
  embedProfilesResponseSchema,
  embedRequestSchema,
  embedResponseSchema,
  generateRequestSchema,
  generateResponseSchema,
  RPC_PATHS,
  rpcStatusFor,
  type CallOptions,
  type InferenceError,
  type RpcErrorCode,
} from '@aetherion/llm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';

import type { InferenceService } from '../gate/inference-service.ts';

// Long generations fit well inside this; a far-future deadline is a caller bug.
export const MAX_DEADLINE_MS = 15 * 60_000;

export const sendError = (reply: FastifyReply, code: RpcErrorCode, message: string) =>
  reply.code(rpcStatusFor(code)).send({ error: { code, message } });

const sendInferenceError = (reply: FastifyReply, error: InferenceError) =>
  sendError(reply, error.code, error.message);

type CallFields = {
  readonly priority: CallOptions['priority'];
  readonly deadline: string;
};

// The caller's disconnect cancels its gate job (queued: removed; active: aborted, then torn down).
const callOptions = (
  request: FastifyRequest,
  reply: FastifyReply,
  fields: CallFields,
  now: number,
): CallOptions | string => {
  const deadline = new Date(fields.deadline);
  if (deadline.getTime() - now > MAX_DEADLINE_MS) return 'deadline is too far in the future';
  const controller = new AbortController();
  reply.raw.on('close', () => {
    if (!reply.raw.writableFinished) controller.abort('CANCELLED');
  });
  request.raw.on('aborted', () => controller.abort('CANCELLED'));
  return { priority: fields.priority, deadline, signal: controller.signal };
};

export const registerInferenceRoutes = (
  app: FastifyInstance,
  service: InferenceService,
  now: () => number,
): void => {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.post(
    RPC_PATHS.generate,
    { schema: { body: generateRequestSchema, response: { 200: generateResponseSchema } } },
    async (request, reply) => {
      const options = callOptions(request, reply, request.body, now());
      if (typeof options === 'string') return sendError(reply, 'VALIDATION_FAILED', options);
      const result = await service.generate(request.body, options);
      if (!result.ok) return sendInferenceError(reply, result.error);
      const { text, model, done } = result.value;
      if (!model) return sendError(reply, 'INTERNAL', 'generation did not report its model');
      return { text, model, done };
    },
  );

  // NDJSON: one StreamEvent per line. Failures, including QUEUE_FULL, arrive as the terminal
  // `error` event inside a 200 response, matching the in-process streaming contract.
  typed.post(RPC_PATHS.stream, { schema: { body: generateRequestSchema } }, (request, reply) => {
    const options = callOptions(request, reply, request.body, now());
    if (typeof options === 'string') return sendError(reply, 'VALIDATION_FAILED', options);
    const events = service.stream(request.body, options);
    const lines = async function* () {
      for await (const event of events) yield `${JSON.stringify(event)}\n`;
    };
    return reply
      .header('content-type', 'application/x-ndjson')
      .header('cache-control', 'no-store')
      .send(Readable.from(lines()));
  });

  typed.post(
    RPC_PATHS.embed,
    { schema: { body: embedRequestSchema, response: { 200: embedResponseSchema } } },
    async (request, reply) => {
      const options = callOptions(request, reply, request.body, now());
      if (typeof options === 'string') return sendError(reply, 'VALIDATION_FAILED', options);
      const result = await service.embed(request.body, options);
      if (!result.ok) return sendInferenceError(reply, result.error);
      const { vectors, model, profile, tokensIn, totalMs } = result.value;
      return {
        vectors: vectors.map((vector) => [...vector]),
        profile: { ...profile },
        model,
        tokensIn,
        totalMs,
      };
    },
  );

  typed.get(
    RPC_PATHS.embedProfiles,
    { schema: { response: { 200: embedProfilesResponseSchema } } },
    async (request, reply) => {
      const listing = await service.embedProfiles(AbortSignal.timeout(5_000));
      if (!listing.ok) return sendInferenceError(reply, listing.error);
      return {
        defaultProfileId: listing.value.defaultProfileId,
        profiles: listing.value.profiles.map((profile) => ({ ...profile })),
      };
    },
  );
};
