import { LlmGate } from '@aetherion/llm';
import type { Logger, ModelsConfig } from '@aetherion/shared';

import { createInferenceService } from './gate/inference-service.ts';
import { createOllamaAdapter } from './ollama/ollama-adapter.ts';
import type { FetchLike } from './ollama/ollama-http.ts';
import { createResidencyMetrics } from './ollama/residency.ts';
import type { ReadinessProbe } from './rpc/health-routes.ts';

const READINESS_TIMEOUT_MS = 2_000;

export type CompositionInput = {
  readonly models: ModelsConfig;
  readonly ollamaUrl: string;
  readonly logger: Logger;
  readonly fetch?: FetchLike;
};

// Composition root: the process's single LlmGate and the only Ollama adapter.
export const composeInference = (input: CompositionInput) => {
  const gate = new LlmGate();
  const residency = createResidencyMetrics();
  const adapter = createOllamaAdapter({
    baseUrl: input.ollamaUrl,
    ...(input.fetch ? { fetch: input.fetch } : {}),
  });
  const service = createInferenceService({
    gate,
    adapter,
    config: () => input.models,
    recordResidency: residency.record,
    logger: input.logger.child({ traceId: 'gate' }),
  });
  const readiness: ReadinessProbe = {
    ollama: async () => (await adapter.loaded(AbortSignal.timeout(READINESS_TIMEOUT_MS))).ok,
    gate: () => gate.metrics(),
    residency: residency.snapshot,
  };
  return { gate, service, readiness };
};
