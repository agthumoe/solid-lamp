import { err, type Result } from '@aetherion/shared';

import { inferenceError, type InferenceError } from '../errors.ts';

export type Priority = 'interactive' | 'background';

export type GateRunOptions = {
  readonly priority: Priority;
  readonly signal: AbortSignal;
  readonly deadline: Date; // absolute; covers queue wait + execution
  readonly label?: string; // role or job kind, for metrics only
};

// The job receives a signal that fires on caller cancellation or deadline expiry.
export type GateJob<T> = (signal: AbortSignal) => Promise<Result<T, InferenceError>>;

export type GateLimits = {
  readonly maxInteractive: number;
  readonly maxBackground: number;
  // After this many interactive completions in a row, one waiting background job runs.
  readonly backgroundEvery: number;
};

export type GateMetrics = {
  readonly active: string | null;
  readonly queued: { readonly interactive: number; readonly background: number };
  readonly oldestQueuedMs: number;
  readonly completed: number;
  readonly rejected: number;
};

type Termination = 'CANCELLED' | 'DEADLINE_EXPIRED';

type Entry = {
  readonly job: GateJob<unknown>;
  readonly options: GateRunOptions;
  readonly enqueuedAt: number;
  readonly controller: AbortController;
  readonly resolve: (result: Result<unknown, InferenceError>) => void;
  readonly reject: (reason: unknown) => void;
  state: 'queued' | 'active' | 'settled';
  terminated?: Termination;
  cleanup: () => void;
};

// setTimeout fires immediately above 2^31-1 ms; such deadlines are programmer errors.
const MAX_DEADLINE_MS = 2_147_483_647;

const DEFAULT_LIMITS: GateLimits = { maxInteractive: 32, maxBackground: 128, backgroundEvery: 8 };

const terminationError = (reason: Termination): InferenceError =>
  inferenceError(
    reason,
    reason === 'CANCELLED' ? 'request was cancelled' : 'request deadline expired',
  );

/**
 * Serializes local GPU inference: one active job, bounded priority queues, FIFO within a
 * priority, and a background starvation bound. Running jobs are never preempted; their
 * slot is released only after the job settles (teardown complete).
 */
export class LlmGate {
  readonly #limits: GateLimits;
  readonly #now: () => number;
  readonly #queues: Record<Priority, Entry[]> = { interactive: [], background: [] };
  #active: Entry | undefined;
  #interactiveStreak = 0;
  #completed = 0;
  #rejected = 0;

  constructor(limits: Partial<GateLimits> = {}, now: () => number = Date.now) {
    this.#limits = { ...DEFAULT_LIMITS, ...limits };
    this.#now = now;
  }

  run<T>(job: GateJob<T>, options: GateRunOptions): Promise<Result<T, InferenceError>> {
    if (options.signal.aborted) return Promise.resolve(err(terminationError('CANCELLED')));
    const remaining = options.deadline.getTime() - this.#now();
    if (!Number.isFinite(remaining) || remaining > MAX_DEADLINE_MS)
      throw new RangeError('deadline must be a valid date within 24 days');
    if (remaining <= 0) return Promise.resolve(err(terminationError('DEADLINE_EXPIRED')));
    const queue = this.#queues[options.priority];
    const limit =
      options.priority === 'interactive' ? this.#limits.maxInteractive : this.#limits.maxBackground;
    if (queue.length >= limit) {
      this.#rejected++;
      return Promise.resolve(
        err(inferenceError('QUEUE_FULL', `${options.priority} queue is full (${limit})`)),
      );
    }

    return new Promise<Result<T, InferenceError>>((resolve, reject) => {
      const entry: Entry = {
        job,
        options,
        enqueuedAt: this.#now(),
        controller: new AbortController(),
        resolve: resolve as (result: Result<unknown, InferenceError>) => void,
        reject,
        state: 'queued',
        cleanup: () => undefined,
      };
      const onAbort = () => this.#terminate(entry, 'CANCELLED');
      const timer = setTimeout(() => this.#terminate(entry, 'DEADLINE_EXPIRED'), remaining);
      options.signal.addEventListener('abort', onAbort, { once: true });
      entry.cleanup = () => {
        clearTimeout(timer);
        options.signal.removeEventListener('abort', onAbort);
      };
      queue.push(entry);
      this.#dispatch();
    });
  }

  metrics(): GateMetrics {
    const queued = [...this.#queues.interactive, ...this.#queues.background];
    const oldest = Math.min(...queued.map((entry) => entry.enqueuedAt));
    return {
      active: this.#active ? (this.#active.options.label ?? this.#active.options.priority) : null,
      queued: {
        interactive: this.#queues.interactive.length,
        background: this.#queues.background.length,
      },
      oldestQueuedMs: queued.length ? this.#now() - oldest : 0,
      completed: this.#completed,
      rejected: this.#rejected,
    };
  }

  #terminate(entry: Entry, reason: Termination): void {
    if (entry.state === 'queued') {
      // Queued work that is cancelled or expired never reaches the executor.
      const queue = this.#queues[entry.options.priority];
      queue.splice(queue.indexOf(entry), 1);
      this.#settle(entry, err(terminationError(reason)));
    } else if (entry.state === 'active' && !entry.terminated) {
      entry.terminated = reason;
      entry.controller.abort(reason);
    }
  }

  #next(): Entry | undefined {
    const { interactive, background } = this.#queues;
    const owed = this.#interactiveStreak >= this.#limits.backgroundEvery;
    if (background.length && (owed || !interactive.length)) return background.shift();
    return interactive.shift();
  }

  #dispatch(): void {
    if (this.#active) return;
    const entry = this.#next();
    if (!entry) return;
    if (entry.options.priority === 'background') this.#interactiveStreak = 0;
    entry.state = 'active';
    this.#active = entry;
    // Starts synchronously (the job sees later aborts); a synchronous throw becomes a rejection.
    const outcome = (async () => await entry.job(entry.controller.signal))();
    void outcome.then(
      (result) => this.#finish(entry, () => this.#settle(entry, result)),
      (error: unknown) => this.#finish(entry, () => this.#fail(entry, error)),
    );
  }

  #finish(entry: Entry, deliver: () => void): void {
    this.#active = undefined;
    this.#completed++;
    if (entry.options.priority === 'interactive') this.#interactiveStreak++;
    deliver();
    this.#dispatch();
  }

  #settle(entry: Entry, result: Result<unknown, InferenceError>): void {
    if (entry.state === 'settled') return;
    entry.state = 'settled';
    entry.cleanup();
    // Output produced after cancellation/expiry is discarded.
    entry.resolve(entry.terminated ? err(terminationError(entry.terminated)) : result);
  }

  #fail(entry: Entry, error: unknown): void {
    if (entry.state === 'settled') return;
    entry.state = 'settled';
    entry.cleanup();
    // A thrown job is a programmer bug: the slot is released, the error propagates.
    entry.reject(error);
  }
}
