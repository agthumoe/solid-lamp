import { createInferenceClient } from '@aetherion/llm';
import postgres, { type Sql } from 'postgres';

import type { ApiConfig } from './config.ts';
import type { ReadinessPorts } from './features/health/application/check-readiness.ts';
import { createInferenceProbe } from './features/health/infrastructure/inference-probe.ts';
import { createPostgresProbe } from './features/health/infrastructure/postgres-probe.ts';

// Composition root: constructs adapters once and wires them into ports.
export const composeApi = (config: ApiConfig) => {
  const sql: Sql | undefined = config.databaseUrl
    ? postgres(config.databaseUrl, {
        max: 4,
        connect_timeout: 2,
        idle_timeout: 30,
        onnotice: () => undefined,
      })
    : undefined;
  const inference = createInferenceClient({
    baseUrl: config.inferenceUrl,
    secret: config.inferenceSecret,
  });
  const readiness: ReadinessPorts = {
    database: createPostgresProbe(sql),
    inference: createInferenceProbe(inference),
  };
  return {
    readiness,
    inference,
    close: async () => {
      await sql?.end({ timeout: 5 });
    },
  };
};
