// Template: APPLICATION ports. Narrow interfaces named after a capability, declared by the
// use cases that need them (interface segregation, dependency inversion).
// Real home: apps/api/src/features/approvals/application/ports.ts

import type { AppError, Result } from '../result-and-errors.ts';
import type { Approval, ApprovalStatus } from './approval.ts';

export type Clock = { now(): Date };

export type ApprovalStore = {
  get(id: string, signal: AbortSignal): Promise<Approval | undefined>;
  // Conditional single-use write: succeeds only if the stored row is still `pending`.
  // Two concurrent decisions → exactly one succeeds; the other gets CONFLICT.
  saveDecision(next: Approval, signal: AbortSignal): Promise<Result<void, AppError<'CONFLICT'>>>;
};

export type AuditEntry = {
  readonly action: 'approval.decided';
  readonly approvalId: string;
  readonly status: ApprovalStatus;
  readonly at: Date;
};

export type AuditWriter = {
  append(entry: AuditEntry, signal: AbortSignal): Promise<void>;
};

export type OutboxEvent = {
  readonly type: 'approval.decided';
  readonly approvalId: string;
  readonly status: ApprovalStatus;
};

export type OutboxWriter = {
  enqueue(event: OutboxEvent, signal: AbortSignal): Promise<void>;
};

// The writers a decision needs, all bound to ONE transaction.
export type DecisionTx = {
  readonly store: ApprovalStore;
  readonly audit: AuditWriter;
  readonly outbox: OutboxWriter;
};

// Unit of work: `work` runs inside one transaction. It commits only when `work` returns
// ok; an err result or a thrown error rolls back every write (decision, audit, outbox).
// A thrown error is re-thrown to the caller after rollback.
export type DecisionUnitOfWork = {
  run<T, E>(
    work: (tx: DecisionTx) => Promise<Result<T, E>>,
    signal: AbortSignal,
  ): Promise<Result<T, E>>;
};
