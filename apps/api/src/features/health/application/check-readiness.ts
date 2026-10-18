export type DependencyStatus = 'ok' | 'unavailable' | 'not_configured';

export type Readiness = {
  readonly status: 'ready' | 'not_ready';
  readonly checks: {
    readonly database: DependencyStatus;
    readonly inference: DependencyStatus;
    readonly ollama: DependencyStatus;
  };
};

// Narrow ports: each probe answers one question and never throws.
export type ReadinessPorts = {
  readonly database: (signal: AbortSignal) => Promise<DependencyStatus>;
  // Ollama is reached only through the inference process, so one probe reports both.
  readonly inference: (signal: AbortSignal) => Promise<{
    readonly inference: DependencyStatus;
    readonly ollama: DependencyStatus;
  }>;
};

export const PROBE_TIMEOUT_MS = 2_000;

/**
 * Readiness: every dependency must be `ok`. Probes run in parallel under one short timeout,
 * so a hung dependency makes the check fail fast rather than hang the endpoint.
 */
export const checkReadiness = async (
  ports: ReadinessPorts,
  signal: AbortSignal,
  timeoutMs = PROBE_TIMEOUT_MS,
): Promise<Readiness> => {
  // A ref'd timer (unlike AbortSignal.timeout) keeps a CLI caller alive until the cut-off.
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), timeoutMs);
  const bounded = AbortSignal.any([signal, timeout.signal]);
  const [database, upstream] = await Promise.all([
    ports.database(bounded),
    ports.inference(bounded),
  ]).finally(() => clearTimeout(timer));
  const checks = { database, inference: upstream.inference, ollama: upstream.ollama };
  const ready = Object.values(checks).every((status) => status === 'ok');
  return { status: ready ? 'ready' : 'not_ready', checks };
};
