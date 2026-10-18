import { join } from 'node:path';

import { createLogger, loadModelsConfig } from '@aetherion/shared';

import { composeInference } from './composition.ts';
import { loadInferenceConfig } from './config.ts';
import { buildServer } from './server.ts';

const SHUTDOWN_GRACE_MS = 10_000;

// Process entry: validate config once, wire, bind loopback, drain on SIGTERM.
const config = loadInferenceConfig(process.env);
if (!config.ok) {
  console.error(config.error.message);
  process.exit(1);
}
const logger = createLogger({ service: 'inference' }, undefined, config.value.logLevel);
const models = await loadModelsConfig(join(config.value.configDir, 'models.yaml'));
if (!models.ok) {
  logger.error({ event: 'config.invalid', outcome: 'failed', errorCode: models.error.code });
  process.exit(1);
}

const { service, readiness } = composeInference({
  models: models.value,
  ollamaUrl: config.value.ollamaUrl ?? models.value.ollama.base_url,
  logger,
});
const app = buildServer({ service, readiness, secret: config.value.secret, logger });

const shutdown = () => {
  logger.info({ event: 'process.shutdown', outcome: 'started' });
  // close() stops intake and waits for in-flight requests; the timer bounds a stuck stream.
  setTimeout(() => process.exit(1), SHUTDOWN_GRACE_MS).unref();
  void app.close().then(() => process.exit(0));
};
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);

await app.listen({ host: config.value.host, port: config.value.port });
logger.info({ event: 'process.listening', outcome: 'complete', count: config.value.port });
