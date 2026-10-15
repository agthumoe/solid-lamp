// Template: APPLICATION use case. Orchestrates domain rules and ports; no framework,
// no SQL, no HTTP status codes. Dependencies are the first parameter.
// Real home: apps/api/src/features/approvals/application/decide-approval.ts

import { appError, err, ok, type AppError, type Result } from '../result-and-errors.ts';
import { decide, type Approval, type DecideError, type Decision } from './approval.ts';
import type { ApprovalStore, Clock, OutboxWriter } from './ports.ts';

export type DecideApprovalDeps = {
  readonly store: ApprovalStore;
  readonly outbox: OutboxWriter;
  readonly clock: Clock;
};

export type DecideApprovalInput = {
  readonly approvalId: string;
  readonly decision: Decision;
  readonly payloadHash: string;
};

export type DecideApprovalError = DecideError | AppError<'NOT_FOUND' | 'CONFLICT'>;

export const decideApproval = async (
  deps: DecideApprovalDeps,
  input: DecideApprovalInput,
  signal: AbortSignal,
): Promise<Result<Approval, DecideApprovalError>> => {
  const current = await deps.store.get(input.approvalId, signal);
  if (current === undefined) {
    return err(appError('NOT_FOUND', 'Approval not found.'));
  }

  const next = decide(current, input.decision, input.payloadHash, deps.clock.now());
  if (!next.ok) return next;

  const saved = await deps.store.saveDecision(next.value, signal);
  if (!saved.ok) return saved;

  await deps.outbox.enqueue({
    type: 'approval.decided',
    approvalId: next.value.id,
    status: next.value.status,
  });
  return ok(next.value);
};
