import {
  collectStream,
  inferenceError,
  scheduleGeneration,
  snapshotFromProfile,
  type CallOptions,
  type EmbeddingProfile,
  type GenerationRole,
  type GenerationSnapshot,
  type InferenceError,
  type LlmGate,
  type StreamDone,
  type StreamEvent,
  type StreamOutcome,
} from '@aetherion/llm';
import { err, ok, type Logger, type ModelsConfig, type Result } from '@aetherion/shared';

import type { AdapterStreamEvent, ChatRequest } from '../ollama/chat.ts';
import type { EmbedKind, EmbedResult } from '../ollama/embed.ts';
import type { OllamaAdapter } from '../ollama/ollama-adapter.ts';
import { compareResidency, type ResidencyChange } from '../ollama/residency.ts';
import { createEventChannel } from './event-channel.ts';
import type { ProfileRegistry } from './profile-registry.ts';

// The narrow slice of the Ollama adapter this service needs (fakes implement only this).
export type InferenceAdapter = {
  readonly stream: (
    snapshot: GenerationSnapshot,
    request: ChatRequest,
    signal: AbortSignal,
  ) => AsyncIterable<AdapterStreamEvent>;
  readonly embed: OllamaAdapter['embed'];
  readonly loaded: OllamaAdapter['loaded'];
};

export type InferenceServiceDeps = {
  readonly gate: LlmGate;
  readonly adapter: InferenceAdapter;
  // Current validated config; a reload swaps what this returns (snapshots stay frozen).
  readonly config: () => ModelsConfig;
  readonly recordResidency: (change: ResidencyChange) => void;
  readonly profiles: ProfileRegistry;
  readonly logger: Logger;
  readonly now?: () => number;
};

export type GenerateCall = ChatRequest & { readonly role: GenerationRole };

export type EmbedCall = {
  readonly texts: readonly string[];
  readonly kind: EmbedKind;
  // ADR 0006: an approved profile ID; omitted means the embed role's current profile.
  readonly profileId?: string | undefined;
};

export type EmbedOutcome = EmbedResult & {
  readonly model: { readonly model: string; readonly numCtx: number; readonly dimensions: number };
  readonly profile: EmbeddingProfile;
};

/**
 * Runs pre-gate work (profile resolution reads Ollama's model list) under the call's own
 * deadline and cancellation, so a stalled request can never outlive the deadline the gate
 * would otherwise enforce. An already-expired deadline fails without starting the work.
 */
const withinDeadline = async <T>(
  work: (signal: AbortSignal) => Promise<Result<T, InferenceError>>,
  options: CallOptions,
  now: () => number,
): Promise<Result<T, InferenceError>> => {
  const expired = () =>
    options.signal.aborted
      ? err(inferenceError('CANCELLED', 'request was cancelled'))
      : err(inferenceError('DEADLINE_EXPIRED', 'request deadline expired'));
  const remaining = options.deadline.getTime() - now();
  if (remaining <= 0 || options.signal.aborted) return expired();
  const controller = new AbortController();
  const stop = () => controller.abort();
  const timer = setTimeout(stop, remaining);
  options.signal.addEventListener('abort', stop, { once: true });
  try {
    return await Promise.race([
      work(controller.signal),
      new Promise<Result<T, InferenceError>>((resolve) =>
        controller.signal.addEventListener('abort', () => resolve(expired()), { once: true }),
      ),
    ]);
  } finally {
    clearTimeout(timer);
    options.signal.removeEventListener('abort', stop);
  }
};

/**
 * The one place gate jobs meet Ollama. Each job observes `/api/ps` before and after it runs
 * so residency is measured per job, never assumed (see the adapter spec).
 */
export const createInferenceService = (deps: InferenceServiceDeps) => {
  const now = deps.now ?? Date.now;

  const observed = async <T>(
    target: { readonly model: string; readonly numCtx: number },
    signal: AbortSignal,
    run: () => Promise<T>,
  ): Promise<T> => {
    const before = await deps.adapter.loaded(signal);
    const value = await run();
    if (before.ok && !signal.aborted) {
      const after = await deps.adapter.loaded(signal);
      if (after.ok) deps.recordResidency(compareResidency(before.value, after.value, target));
    }
    return value;
  };

  const logOutcome = (
    role: string,
    startedAt: number,
    queueWaitMs: number | undefined,
    error?: InferenceError,
  ) => {
    const event = {
      event: 'inference.job',
      outcome: error ? ('failed' as const) : ('complete' as const),
      role,
      durationMs: now() - startedAt,
      ...(queueWaitMs === undefined ? {} : { queueWaitMs }),
      ...(error ? { errorCode: error.code } : {}),
    };
    if (error) deps.logger.warn(event);
    else deps.logger.info(event);
  };

  // Tokens flow out as they arrive; the terminal event is emitted only after the gate settles,
  // so it always agrees with the gate (a late deadline turns `done` into an error).
  async function* stream(call: GenerateCall, options: CallOptions): AsyncGenerator<StreamEvent> {
    const enqueuedAt = now();
    const channel = createEventChannel<StreamEvent>();
    let tokens = 0;
    let queueWaitMs: number | undefined;
    const settled = scheduleGeneration(
      deps,
      call.role,
      options,
      async (snapshot, signal): Promise<Result<StreamDone, InferenceError>> => {
        queueWaitMs = now() - enqueuedAt;
        channel.push({
          type: 'started',
          model: { role: snapshot.role, model: snapshot.model, numCtx: snapshot.numCtx },
          queuedMs: queueWaitMs,
        });
        return observed(snapshot, signal, async () => {
          for await (const event of deps.adapter.stream(snapshot, call, signal)) {
            if (event.type === 'token') {
              tokens++;
              channel.push(event);
            } else if (event.type === 'done') return ok(event);
            else return err(event.error);
          }
          return err(inferenceError('INVALID_RESPONSE', 'adapter stream ended without done'));
        });
      },
    ).then(
      (result) => {
        logOutcome(call.role, enqueuedAt, queueWaitMs, result.ok ? undefined : result.error);
        channel.push(
          result.ok
            ? result.value.value
            : { type: 'error', error: result.error, partial: tokens > 0 },
        );
        channel.close();
      },
      (error: unknown) => {
        channel.close();
        throw error;
      },
    );
    try {
      yield* channel.drain();
    } finally {
      await settled;
    }
  }

  const generate = async (
    call: GenerateCall,
    options: CallOptions,
  ): Promise<Result<StreamOutcome, InferenceError>> => {
    const collected = await collectStream(stream(call, options));
    return collected.ok ? ok(collected.value) : err(collected.error.error);
  };

  const embed = async (
    call: EmbedCall,
    options: CallOptions,
  ): Promise<Result<EmbedOutcome, InferenceError>> => {
    const enqueuedAt = now();
    let queueWaitMs: number | undefined;
    // Snapshot the profile at enqueue: a config reload or re-pull while queued must not change
    // the vector space. Resolution only reads Ollama's model list, never the GPU.
    const resolved = await withinDeadline(
      (signal) => deps.profiles.resolve(call.profileId, signal),
      options,
      now,
    );
    if (!resolved.ok) {
      logOutcome('embed', enqueuedAt, undefined, resolved.error);
      return resolved;
    }
    const profile = resolved.value;
    const snapshot = snapshotFromProfile(profile);
    const result = await deps.gate.run(
      async (signal) => {
        queueWaitMs = now() - enqueuedAt;
        // The artifact may have been replaced while queued: fail explicitly instead of embedding
        // with a different model under the old identity.
        const current = await deps.profiles.verify(profile, signal);
        if (!current.ok) return current;
        return observed(snapshot, signal, () =>
          deps.adapter.embed(snapshot, call.texts, call.kind, signal),
        );
      },
      { ...options, label: 'embed' },
    );
    logOutcome('embed', enqueuedAt, queueWaitMs, result.ok ? undefined : result.error);
    if (!result.ok) return result;
    const model = {
      model: snapshot.model,
      numCtx: snapshot.numCtx,
      dimensions: snapshot.dimensions,
    };
    return ok({ ...result.value, model, profile });
  };

  const embedProfiles = (signal: AbortSignal) => deps.profiles.list(signal);

  return { stream, generate, embed, embedProfiles };
};

export type InferenceService = ReturnType<typeof createInferenceService>;
