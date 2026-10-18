import { createLogger } from '@aetherion/shared';

import { composeApi } from './composition.ts';
import { loadApiConfig } from './config.ts';
import { buildServer } from './server.ts';

const SHUTDOWN_GRACE_MS = 10_000;

// Process entry: validate config once, wire, bind loopback, drain on SIGTERM. No migrations
// or ingestion at startup (operations.md).
const config = loadApiConfig(process.env);
if (!config.ok) {
  console.error(config.error.message);
  process.exit(1);
}
const logger = createLogger({ service: 'api' }, undefined, config.value.logLevel);
const composed = composeApi(config.value);
const app = buildServer({ readiness: composed.readiness, logger });

const shutdown = () => {
  logger.info({ event: 'process.shutdown', outcome: 'started' });
  setTimeout(() => process.exit(1), SHUTDOWN_GRACE_MS).unref();
  void app
    .close()
    .then(composed.close)
    .then(() => process.exit(0));
};
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);

await app.listen({ host: config.value.host, port: config.value.port });
logger.info({ event: 'process.listening', outcome: 'complete', count: config.value.port });
