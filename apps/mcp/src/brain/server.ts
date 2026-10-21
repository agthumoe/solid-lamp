import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import type { BrainApiClient } from '@aetherion/shared';
import { createBrainTools } from './tools.ts';

export const BRAIN_SERVER_NAME = 'aetherion-brain';

/** Builds the brain MCP server without a transport; `main.ts` connects it to stdio. */
export const createBrainMcpServer = (client: BrainApiClient): McpServer => {
  const server = new McpServer({ name: BRAIN_SERVER_NAME, version: '0.1.0' });
  for (const tool of createBrainTools(client)) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.input,
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
        _meta: { sideEffect: tool.sideEffect, risk: tool.risk, timeoutMs: tool.timeoutMs },
      },
      async (input: unknown, extra: { signal: AbortSignal }) => {
        const signal = AbortSignal.any([extra.signal, AbortSignal.timeout(tool.timeoutMs)]);
        const output = await tool.run(tool.input.parse(input), signal);
        return { content: [{ type: 'text' as const, text: output.text }], isError: output.isError };
      },
    );
  }
  return server;
};
