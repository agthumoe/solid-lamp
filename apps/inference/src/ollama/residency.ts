import { inferenceError, type InferenceError } from '@aetherion/llm';
import { err, ok, type Result } from '@aetherion/shared';
import { z } from 'zod';

import type { OllamaHttp } from './ollama-http.ts';

// What Ollama says is loaded. `/api/ps` VRAM figures are known to be wrong for some models
// (docs/HARDWARE.md), so they are reported, never used to claim GPU residency on their own.
export type LoadedModel = {
  readonly model: string;
  readonly contextLength: number | undefined;
  readonly sizeBytes: number;
  readonly vramBytes: number;
};

export type LoadKind = 'warm' | 'cold' | 'context_reload';

export type ResidencyChange = {
  readonly model: string;
  // Predicted from the state observed before dispatch.
  readonly expected: LoadKind;
  // Models that were loaded before the request and are gone after it.
  readonly evicted: readonly string[];
  // False when the target is not loaded afterwards, or loaded with another context.
  readonly residentAfter: boolean;
};

const psSchema = z.object({
  models: z.array(
    z.object({
      model: z.string().min(1),
      size: z.int().nonnegative().default(0),
      size_vram: z.int().nonnegative().default(0),
      context_length: z.int().positive().optional(),
    }),
  ),
});

// Ollama reports `name:latest` for an untagged model reference.
export const canonicalModel = (model: string): string =>
  model.includes(':') ? model : `${model}:latest`;

export const listLoaded = async (
  http: OllamaHttp,
  signal: AbortSignal,
): Promise<Result<readonly LoadedModel[], InferenceError>> => {
  const response = await http.getJson('/api/ps', signal);
  if (!response.ok) return response;
  const parsed = psSchema.safeParse(response.value);
  if (!parsed.success) return err(inferenceError('INVALID_RESPONSE', 'unexpected /api/ps body'));
  return ok(
    parsed.data.models.map((entry) => ({
      model: canonicalModel(entry.model),
      contextLength: entry.context_length,
      sizeBytes: entry.size,
      vramBytes: entry.size_vram,
    })),
  );
};

type Target = { readonly model: string; readonly numCtx: number };

const find = (loaded: readonly LoadedModel[], model: string) =>
  loaded.find((entry) => entry.model === canonicalModel(model));

// A shared-model role with a different num_ctx forces Ollama to reload the same weights.
// An unknown loaded context is treated as a reload: residency is observed, never assumed.
export const classifyLoad = (loaded: readonly LoadedModel[], target: Target): LoadKind => {
  const current = find(loaded, target.model);
  if (!current) return 'cold';
  return current.contextLength === target.numCtx ? 'warm' : 'context_reload';
};

export const compareResidency = (
  before: readonly LoadedModel[],
  after: readonly LoadedModel[],
  target: Target,
): ResidencyChange => {
  const remaining = new Set(after.map((entry) => entry.model));
  return {
    model: canonicalModel(target.model),
    expected: classifyLoad(before, target),
    evicted: before.map((entry) => entry.model).filter((model) => !remaining.has(model)),
    residentAfter: classifyLoad(after, target) === 'warm',
  };
};

export type ResidencyMetrics = {
  readonly coldLoads: number;
  readonly contextReloads: number;
  readonly evictions: number;
  readonly notResidentAfter: number;
};

// Counts observed transitions for `/readyz` and logs; labels stay bounded (no prompt data).
export const createResidencyMetrics = () => {
  let metrics: ResidencyMetrics = {
    coldLoads: 0,
    contextReloads: 0,
    evictions: 0,
    notResidentAfter: 0,
  };
  return {
    record: (change: ResidencyChange): void => {
      metrics = {
        coldLoads: metrics.coldLoads + (change.expected === 'cold' ? 1 : 0),
        contextReloads: metrics.contextReloads + (change.expected === 'context_reload' ? 1 : 0),
        evictions: metrics.evictions + change.evicted.length,
        notResidentAfter: metrics.notResidentAfter + (change.residentAfter ? 0 : 1),
      };
    },
    snapshot: (): ResidencyMetrics => metrics,
  };
};
