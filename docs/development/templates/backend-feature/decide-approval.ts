// Template: APPLICATION use case. Orchestrates domain rules and ports; no framework,
// no SQL, no HTTP status codes. Dependencies are the first parameter.
// Real home: apps/api/src/features/approvals/application/decide-approval.ts

import { appError, err, ok, type AppError, type Result } from '../result-and-errors.ts';
import { decide, type Approval, type DecideError, type Decision } from './approval.ts';
import type { Clock, DecisionUnitOfWork } from './ports.ts';

export type DecideApprovalDeps = {
  readonly uow: DecisionUnitOfWork;
  readonly clock: Clock;
};

export type DecideApprovalInput = {
  readonly approvalId: string;
  readonly decision: Decision;
  readonly payloadHash: string;
};

export type DecideApprovalError = DecideError | AppError<'NOT_FOUND' | 'CONFLICT'>;

// The decision, its audit entry and its outbox event commit together or not at all.
// An infrastructure failure (for example the outbox insert) throws, rolls back the
// decision, and leaves the approval pending so the owner can retry.
export const decideApproval = (
  deps: DecideApprovalDeps,
  input: DecideApprovalInput,
  signal: AbortSignal,
): Promise<Result<Approval, DecideApprovalError>> =>
  deps.uow.run<Approval, DecideApprovalError>(async (tx) => {
    const current = await tx.store.get(input.approvalId, signal);
    if (current === undefined) {
      return err(appError('NOT_FOUND', 'Approval not found.'));
    }

    const now = deps.clock.now();
    const next = decide(current, input.decision, input.payloadHash, now);
    if (!next.ok) return next;

    const saved = await tx.store.saveDecision(next.value, signal);
    if (!saved.ok) return saved;

    const { id: approvalId, status } = next.value;
    await tx.audit.append({ action: 'approval.decided', approvalId, status, at: now }, signal);
    await tx.outbox.enqueue({ type: 'approval.decided', approvalId, status }, signal);
    return ok(next.value);
  }, signal);
