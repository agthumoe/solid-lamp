// Brain MCP server over stdio (`pnpm dev:mcp-brain`). stdout carries only MCP protocol frames;
// logs go to stderr. No network listener: the trusted boundary is the spawning process.
import { createBrainApiClient, createLogger, loadBrainClientConfig } from '@aetherion/shared';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { createBrainMcpServer } from './server.ts';

const config = loadBrainClientConfig(process.env);
if (!config.ok) {
  process.stderr.write(`${config.error.message}\n`);
  process.exit(1);
}
const logger = createLogger(
  { service: 'mcp', component: 'brain' },
  process.stderr,
  config.value.logLevel,
);
const server = createBrainMcpServer(
  createBrainApiClient({ baseUrl: config.value.apiUrl, serviceKey: config.value.serviceKey }),
);

const shutdown = () => {
  void server.close().then(() => process.exit(0));
};
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
process.stdin.once('end', shutdown);

await server.connect(new StdioServerTransport());
logger.info({ event: 'process.listening', outcome: 'complete' });
