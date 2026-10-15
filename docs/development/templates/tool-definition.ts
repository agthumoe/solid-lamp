// Template: an agent tool and the executor that decides whether it may run.
// Real home: packages/agents/src/tools/tool.ts (type + executor) and
// packages/agents/src/tools/<tool-name>/tool.ts (one tool per folder).
// Guide: docs/development/ai-orchestration.md#tools

import { createHash } from 'node:crypto';

import { z } from 'zod';

import { appError, err, ok, type AppError, type Result } from './result-and-errors.ts';

export type ToolRisk = 'low' | 'medium' | 'high';

export type ToolContext = {
  readonly runId: string;
  readonly signal: AbortSignal;
};

export type ToolDefinition<I extends z.ZodType, O extends z.ZodType> = {
  readonly name: string; // domain.verb_object; stable, used in allowlists
  readonly description: string; // what the model sees: when to use it
  readonly input: I; // strict schema: unknown keys rejected
  readonly output: O; // bounded output
  readonly sideEffect: boolean;
  readonly risk: ToolRisk;
  readonly timeoutMs: number;
  readonly execute: (input: z.infer<I>, ctx: ToolContext) => Promise<z.infer<O>>;
};

// Identity helper that preserves the schema generics for each tool.
export const defineTool = <I extends z.ZodType, O extends z.ZodType>(
  tool: ToolDefinition<I, O>,
): ToolDefinition<I, O> => tool;

// --- Example 1: read-only tool (runs immediately, bounded, timed out) -------------------

type SearchPort = {
  search(
    query: string,
    limit: number,
    signal: AbortSignal,
  ): Promise<{ chunkId: string; text: string; citation: string }[]>;
};

export const makeBrainSearchTool = (brain: SearchPort) =>
  defineTool({
    name: 'brain.search',
    description: 'Search the owner’s notes and repos. Use for questions about their own material.',
    input: z.strictObject({
      query: z.string().min(1).max(500),
      limit: z.number().int().min(1).max(10).default(5),
    }),
    output: z
      .array(
        z.strictObject({ chunkId: z.string(), text: z.string().max(4000), citation: z.string() }),
      )
      .max(10),
    sideEffect: false,
    risk: 'low',
    timeoutMs: 5_000,
    execute: (input, ctx) => brain.search(input.query, input.limit, ctx.signal),
  });

// --- Example 2: side-effect tool (never runs without an approved decision) --------------

export const tasksProposeCreateTool = defineTool({
  name: 'tasks.propose_create',
  description: 'Propose a new task for the owner. The owner must approve before it is created.',
  input: z.strictObject({
    title: z.string().min(1).max(200),
    due: z.iso.date().optional(),
  }),
  output: z.strictObject({ taskId: z.string() }),
  sideEffect: true,
  risk: 'medium',
  timeoutMs: 10_000,
  // Dispatched only by the approval executor after an approved, hash-matching decision.
  execute: () => Promise.reject(new Error('template: wire to the tasks adapter')),
});

// --- Executor ---------------------------------------------------------------------------

// Stable hash of tool name + canonicalized (key-sorted) arguments. Approvals bind to it.
export const payloadHash = (toolName: string, args: unknown): string =>
  createHash('sha256')
    .update(JSON.stringify([toolName, canonicalize(args)]))
    .digest('hex');

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => [k, canonicalize(v)]),
    );
  }
  return value;
};

export type ToolCallOutcome =
  | { readonly kind: 'result'; readonly data: unknown }
  | {
      readonly kind: 'approval_required';
      readonly toolName: string;
      readonly args: unknown;
      readonly payloadHash: string;
    };

export type ToolCallError = AppError<'FORBIDDEN' | 'VALIDATION_FAILED' | 'UNAVAILABLE'>;

// Native and repaired tool calls both come through here. The model's request is data:
// it is checked against the agent allowlist and the strict schema before anything runs.
export const executeToolCall = async <I extends z.ZodType, O extends z.ZodType>(
  tool: ToolDefinition<I, O>,
  allowlist: ReadonlySet<string>,
  rawArgs: unknown,
  ctx: ToolContext,
): Promise<Result<ToolCallOutcome, ToolCallError>> => {
  if (!allowlist.has(tool.name)) {
    return err(appError('FORBIDDEN', `Tool ${tool.name} is not allowed for this agent.`));
  }
  const parsed = tool.input.safeParse(rawArgs);
  if (!parsed.success) {
    return err(appError('VALIDATION_FAILED', `Invalid arguments for ${tool.name}.`));
  }
  if (tool.sideEffect) {
    // The graph turns this into interrupt(); nothing executes here.
    return ok({
      kind: 'approval_required',
      toolName: tool.name,
      args: parsed.data,
      payloadHash: payloadHash(tool.name, parsed.data),
    });
  }
  const signal = AbortSignal.any([ctx.signal, AbortSignal.timeout(tool.timeoutMs)]);
  try {
    const data: unknown = await tool.execute(parsed.data, { ...ctx, signal });
    const checked = tool.output.safeParse(data);
    if (!checked.success) {
      return err(appError('UNAVAILABLE', `Tool ${tool.name} returned an invalid result.`));
    }
    return ok({ kind: 'result', data: checked.data });
  } catch {
    return err(appError('UNAVAILABLE', `Tool ${tool.name} failed or timed out.`));
  }
};
