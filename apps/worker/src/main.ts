import { createLogger } from '@aetherion/shared';

import { composeWorker } from './composition.ts';
import { loadWorkerConfig } from './config.ts';
import { createHealthServer } from './health.ts';

const SHUTDOWN_GRACE_MS = 35_000;

// Process entry: validate config once, wire, serve health on the private host, drain on
// SIGTERM (stop intake, finish active jobs within the grace period, close Redis).
const config = loadWorkerConfig(process.env);
if (!config.ok) {
  console.error(config.error.message);
  process.exit(1);
}
const logger = createLogger({ service: 'worker' }, undefined, config.value.logLevel);
const worker = composeWorker({
  redisUrl: config.value.redisUrl,
  logger,
  concurrency: config.value.concurrency,
});
const server = createHealthServer(worker.health);

const shutdown = () => {
  logger.info({ event: 'process.shutdown', outcome: 'started' });
  setTimeout(() => process.exit(1), SHUTDOWN_GRACE_MS).unref();
  server.close();
  void worker.close().then(() => process.exit(0));
};
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);

server.listen(config.value.port, config.value.host, () =>
  logger.info({ event: 'process.listening', outcome: 'complete', count: config.value.port }),
);
