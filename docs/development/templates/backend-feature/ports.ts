// Template: APPLICATION ports. Narrow interfaces named after a capability, declared by the
// use cases that need them (interface segregation, dependency inversion).
// Real home: apps/api/src/features/approvals/application/ports.ts

import type { AppError, Result } from '../result-and-errors.ts';
import type { Approval } from './approval.ts';

export type Clock = { now(): Date };

export type ApprovalStore = {
  get(id: string, signal: AbortSignal): Promise<Approval | undefined>;
  // Conditional single-use write: succeeds only if the stored row is still `pending`.
  // Two concurrent decisions → exactly one succeeds; the other gets CONFLICT.
  saveDecision(next: Approval, signal: AbortSignal): Promise<Result<void, AppError<'CONFLICT'>>>;
};

export type OutboxWriter = {
  // Written in the same transaction as the decision in the real adapter.
  enqueue(event: { type: 'approval.decided'; approvalId: string; status: string }): Promise<void>;
};
