import { existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { validateArgs, type JsonSchema, type PsModel } from './ollama.ts';

export interface ToolCall {
  name: string;
  arguments: Record<string, unknown>;
}
export interface ExpectedCall {
  name: string;
  args: Record<string, unknown>;
}

export function scoreCalls(
  calls: ToolCall[],
  expected: ExpectedCall | null,
  schemas: Map<string, JsonSchema>,
): string {
  if (expected === null) return calls.length ? 'called a tool when none was needed' : '';
  if (calls.length !== 1) return `expected 1 call, got ${calls.length}`;
  const call = calls[0];
  if (!call) return 'expected one call';
  const schema = schemas.get(call.name);
  if (!schema) return 'schema: unknown tool';
  const errors = validateArgs(schema, call.arguments);
  if (errors.length) return `schema: ${errors.join(', ')}`;
  if (call.name !== expected.name) return `wrong tool (expected ${expected.name})`;
  const bad = Object.entries(expected.args).filter(([key, value]) => {
    const actual = call.arguments[key];
    // Fixture strings represent semantic substrings; schema validation enforces their types first.
    if (typeof value === 'string') {
      return !(typeof actual === 'string'
        ? actual.toLowerCase().includes(value.toLowerCase())
        : Array.isArray(actual) &&
          actual.some(
            (item) => typeof item === 'string' && item.toLowerCase().includes(value.toLowerCase()),
          ));
    }
    return actual !== value;
  });
  return bad.length ? `args: ${bad.map(([key]) => key).join(', ')}` : '';
}

export function residencyCheck(requested: { model: string; num_ctx: number }[], loaded: PsModel[]) {
  const find = (name: string) =>
    loaded.find((model) => model.name === name || model.name === `${name}:latest`);
  const missing = requested.filter((model) => !find(model.model)).map((model) => model.model);
  const wrongCtx = requested
    .filter((model) => find(model.model) && find(model.model)?.context_length !== model.num_ctx)
    .map((model) => model.model);
  const partialGpu = loaded
    .filter(
      (model) =>
        !Number.isFinite(model.size) ||
        model.size <= 0 ||
        !Number.isFinite(model.size_vram) ||
        model.size_vram < model.size,
    )
    .map((model) => model.name);
  return {
    missing,
    wrongCtx,
    partialGpu,
    pass:
      requested.length > 0 &&
      loaded.length > 0 &&
      !missing.length &&
      !wrongCtx.length &&
      !partialGpu.length,
  };
}

export function claimArtifact(file: string, initial: unknown) {
  mkdirSync(dirname(file), { recursive: true });
  // Exclusive creation prevents concurrent runs with the same label from clobbering evidence.
  writeFileSync(file, JSON.stringify(initial, null, 2), { flag: 'wx' });
}

export function saveArtifact(file: string, value: unknown) {
  if (!existsSync(file)) throw new Error('artifact must be claimed before saving');
  const temporary = `${file}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(value, null, 2));
  renameSync(temporary, file);
}
