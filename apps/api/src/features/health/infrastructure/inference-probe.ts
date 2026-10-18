import type { InferenceClient } from '@aetherion/llm';

import type { DependencyStatus } from '../application/check-readiness.ts';

export const createInferenceProbe =
  (client: Pick<InferenceClient, 'ready'>) =>
  async (
    signal: AbortSignal,
  ): Promise<{ readonly inference: DependencyStatus; readonly ollama: DependencyStatus }> => {
    const ready = await client.ready(signal);
    if (!ready.ok) return { inference: 'unavailable', ollama: 'unavailable' };
    return { inference: 'ok', ollama: ready.value.ollama === 'ok' ? 'ok' : 'unavailable' };
  };
