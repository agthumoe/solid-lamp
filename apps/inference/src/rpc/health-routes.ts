import { RPC_PATHS, type GateMetrics } from '@aetherion/llm';
import type { FastifyInstance } from 'fastify';

import type { ResidencyMetrics } from '../ollama/residency.ts';

export type ReadinessProbe = {
  // True when Ollama answers within the probe's own short timeout.
  readonly ollama: () => Promise<boolean>;
  readonly gate: () => GateMetrics;
  readonly residency: () => ResidencyMetrics;
};

// Liveness proves the process answers. Readiness reports dependencies and counters only:
// no model output, prompts, URLs or secrets.
export const registerHealthRoutes = (app: FastifyInstance, probe: ReadinessProbe): void => {
  app.get(RPC_PATHS.live, () => ({ status: 'ok' }));

  app.get(RPC_PATHS.ready, async (_request, reply) => {
    const ollama = await probe.ollama();
    return reply.code(ollama ? 200 : 503).send({
      status: ollama ? 'ready' : 'not_ready',
      ollama: ollama ? 'ok' : 'unavailable',
      gate: probe.gate(),
      residency: probe.residency(),
    });
  });
};
