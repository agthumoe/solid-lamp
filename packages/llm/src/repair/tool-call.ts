import { err, ok, type Result } from '@aetherion/shared';
import type { z } from 'zod';

export type ToolAllowlist = ReadonlyMap<string, z.ZodType>;

export type ToolCall = {
  readonly name: string;
  readonly arguments: unknown;
  readonly repaired: boolean;
};

export type ToolCallErrorCode =
  'NO_EXPLICIT_CALL' | 'MALFORMED_CALL' | 'TOOL_NOT_ALLOWED' | 'INVALID_ARGUMENTS';

export type ToolCallError = {
  readonly code: ToolCallErrorCode;
  readonly message: string;
  readonly tool?: string;
};

const toolError = (code: ToolCallErrorCode, message: string, tool?: string): ToolCallError =>
  tool === undefined ? { code, message } : { code, message, tool };

/**
 * One validation path for native and repaired calls: the tool must be on the agent's
 * allowlist and its arguments must pass that tool's strict schema. The validated
 * arguments (with schema defaults) replace the model's raw arguments.
 */
export const validateToolCall = (
  call: { readonly name: string; readonly arguments: unknown },
  allowlist: ToolAllowlist,
  repaired: boolean,
): Result<ToolCall, ToolCallError> => {
  const schema = allowlist.get(call.name);
  if (!schema)
    return err(toolError('TOOL_NOT_ALLOWED', 'tool is not on the agent allowlist', call.name));
  const parsed = schema.safeParse(call.arguments);
  if (!parsed.success) {
    const paths = parsed.error.issues.map((issue) => issue.path.join('.') || '<root>');
    return err(
      toolError('INVALID_ARGUMENTS', `invalid arguments at ${paths.join(', ')}`, call.name),
    );
  }
  return ok({ name: call.name, arguments: parsed.data, repaired });
};
