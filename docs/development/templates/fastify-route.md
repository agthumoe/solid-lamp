# Template: Fastify route (transport layer)

Real home: `apps/api/src/features/<feature>/transport/<feature>-routes.ts`. Not compiled until Phase 1 installs Fastify ([ADR 0005](../../adr/0005-phase1-stack-and-topology.md)); the use case it calls is the type-checked [decide-approval](backend-feature/decide-approval.ts).

A route does four things only: declare the schema, require auth, call one use case, map the `Result` to HTTP. No SQL, no business rules, no direct Drizzle import (the source policy rejects it).

```ts
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import {
  decideApprovalBodySchema,
  approvalDtoSchema,
  errorEnvelopeSchema,
} from '@aetherion/shared/contracts';
import { httpStatusFor, toErrorEnvelope } from '@aetherion/shared';
import type { DecideApprovalDeps } from '../application/decide-approval.ts';
import { decideApproval } from '../application/decide-approval.ts';
import { toApprovalDto } from './approval-dto.ts';

// Dependencies come in as plugin options from composition.ts; nothing is imported pre-configured.
export const approvalRoutes: FastifyPluginAsyncZod<{ deps: DecideApprovalDeps }> = async (
  app,
  { deps },
) => {
  app.post(
    '/api/v1/approvals/:approvalId/decision',
    {
      onRequest: [app.requireOwner], // auth + CSRF plugin (plugins/auth.ts)
      schema: {
        params: z.strictObject({ approvalId: z.string().min(1) }),
        body: decideApprovalBodySchema, // { decision, payloadHash }
        response: { 200: approvalDtoSchema, '4xx': errorEnvelopeSchema },
      },
    },
    async (request, reply) => {
      const result = await decideApproval(
        deps,
        { approvalId: request.params.approvalId, ...request.body },
        request.signal, // aborted when the client disconnects
      );
      if (!result.ok) {
        return reply
          .code(httpStatusFor(result.error.code))
          .send(toErrorEnvelope(result.error, request.id));
      }
      return toApprovalDto(result.value); // explicit DTO: never return DB rows
    },
  );
};
```

Checklist: params/query/body/response schemas; `requireOwner` on every route (SSE too); DTO mapping; `request.signal` passed down; contract tests via `app.inject` for 200, 400, 401, 404, 409, 410.
