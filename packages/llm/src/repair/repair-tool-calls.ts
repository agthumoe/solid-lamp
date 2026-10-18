import { err, ok, type Result } from '@aetherion/shared';

import {
  validateToolCall,
  type ToolAllowlist,
  type ToolCall,
  type ToolCallError,
} from './tool-call.ts';

const MAX_TEXT_CHARS = 32_768;
const MAX_CALLS = 8;
const WRAPPED = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>|```(?:json)?\s*([\s\S]*?)```/g;

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  Object.getPrototypeOf(value) === Object.prototype;

const malformed = (message: string): Result<never, ToolCallError> =>
  err({ code: 'MALFORMED_CALL', message });

// Candidates only when explicit calls occupy the entire response: prose around or between
// them means the model was talking about a call, not making one.
const explicitCandidates = (text: string): string[] | undefined => {
  if (text.startsWith('{')) return [text];
  const candidates: string[] = [];
  let end = 0;
  for (const match of text.matchAll(WRAPPED)) {
    if (text.slice(end, match.index).trim()) return undefined;
    const body = match[1] ?? match[2];
    if (!body) return undefined;
    candidates.push(body);
    end = match.index + match[0].length;
  }
  return candidates.length && !text.slice(end).trim() ? candidates : undefined;
};

const parseCandidate = (
  candidate: string,
): Result<{ name: string; arguments: unknown }, ToolCallError> => {
  let value: unknown;
  try {
    value = JSON.parse(candidate);
  } catch {
    return malformed('tool call is not valid JSON');
  }
  if (!isPlainRecord(value)) return malformed('tool call must be a JSON object');
  const { name } = value;
  if (typeof name !== 'string' || !name.trim()) return malformed('tool call needs a name');
  if (Object.keys(value).some((key) => !['name', 'arguments', 'parameters'].includes(key)))
    return malformed('tool call has unexpected keys');
  if (Object.hasOwn(value, 'arguments') && Object.hasOwn(value, 'parameters'))
    return malformed('tool call has both arguments and parameters');
  let args: unknown = Object.hasOwn(value, 'arguments') ? value.arguments : value.parameters;
  if (typeof args === 'string') {
    try {
      args = JSON.parse(args);
    } catch {
      return malformed('stringified arguments are not valid JSON');
    }
  }
  if (!isPlainRecord(args)) return malformed('tool arguments must be a JSON object');
  return ok({ name, arguments: args });
};

/**
 * Recovers tool calls a model wrote as text. Repaired calls are never executed here: they
 * return to the caller marked `repaired` and enter the same approval path as native calls.
 * Any invalid candidate rejects the whole response (no partial execution).
 */
export const repairToolCalls = (
  text: string,
  allowlist: ToolAllowlist,
): Result<ToolCall[], ToolCallError> => {
  if (text.length > MAX_TEXT_CHARS) return malformed('response too large to repair');
  const candidates = explicitCandidates(text.trim());
  if (!candidates)
    return err({ code: 'NO_EXPLICIT_CALL', message: 'response is not an explicit tool call' });
  if (candidates.length > MAX_CALLS) return malformed(`more than ${MAX_CALLS} tool calls`);
  const calls: ToolCall[] = [];
  for (const candidate of candidates) {
    const parsed = parseCandidate(candidate);
    if (!parsed.ok) return parsed;
    const validated = validateToolCall(parsed.value, allowlist, true);
    if (!validated.ok) return validated;
    calls.push(validated.value);
  }
  return ok(calls);
};
