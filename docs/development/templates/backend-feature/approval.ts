// Template: DOMAIN layer. Pure types, invariants and state transitions.
// Real home: apps/api/src/features/approvals/domain/approval.ts
// Imports allowed: same-feature domain files and shared pure types. No I/O, no framework,
// no logger, no clock (time is passed in).

import { appError, err, ok, type AppError, type Result } from '../result-and-errors.ts';

export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'expired';

export type Approval = {
  readonly id: string;
  readonly runId: string;
  readonly toolName: string;
  readonly payloadHash: string;
  readonly status: ApprovalStatus;
  readonly expiresAt: Date;
  readonly decidedAt?: Date;
};

export type Decision = 'approve' | 'reject';

export type DecideError = AppError<
  'APPROVAL_EXPIRED' | 'APPROVAL_ALREADY_DECIDED' | 'PAYLOAD_MISMATCH'
>;

// Pure transition: given the current approval, a decision and the time, return the next
// state or why the decision is not allowed. All rules live here, so they are unit-tested
// without a database.
export const decide = (
  approval: Approval,
  decision: Decision,
  expectedPayloadHash: string,
  now: Date,
): Result<Approval, DecideError> => {
  if (approval.status !== 'pending') {
    return err(appError('APPROVAL_ALREADY_DECIDED', 'This approval was already decided.'));
  }
  if (now.getTime() >= approval.expiresAt.getTime()) {
    return err(appError('APPROVAL_EXPIRED', 'This approval has expired.'));
  }
  // The owner approves the exact action they saw; any change needs a new approval.
  if (approval.payloadHash !== expectedPayloadHash) {
    return err(appError('PAYLOAD_MISMATCH', 'The proposed action changed; review it again.'));
  }
  return ok({
    ...approval,
    status: decision === 'approve' ? 'approved' : 'rejected',
    decidedAt: now,
  });
};
