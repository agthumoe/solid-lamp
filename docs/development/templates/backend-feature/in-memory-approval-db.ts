// Template: test FAKE for the decision unit of work. It honours the same contract as the
// real adapter: transactions are isolated (run one at a time, like SERIALIZABLE), writes
// are staged and only become visible on commit, and an err result or a thrown error
// rolls everything back. Tests can make the outbox fail to prove atomicity.
// Real home: apps/api/test/support/in-memory-approval-db.ts

import { appError, err, ok, type Result } from '../result-and-errors.ts';
import type { Approval } from './approval.ts';
import type { AuditEntry, DecisionTx, DecisionUnitOfWork, OutboxEvent } from './ports.ts';

type Tables = {
  approvals: Map<string, Approval>;
  audit: AuditEntry[];
  outbox: OutboxEvent[];
};

export const createInMemoryApprovalDb = (seed: readonly Approval[] = []) => {
  let committed: Tables = { approvals: new Map(seed.map((a) => [a.id, a])), audit: [], outbox: [] };
  let outboxFails = false;
  let tail: Promise<unknown> = Promise.resolve();

  const bind = (staged: Tables): DecisionTx => ({
    store: {
      get(id, signal) {
        signal.throwIfAborted();
        return Promise.resolve(staged.approvals.get(id));
      },
      saveDecision(next, signal) {
        signal.throwIfAborted();
        if (staged.approvals.get(next.id)?.status !== 'pending') {
          return Promise.resolve(err(appError('CONFLICT', 'Approval is no longer pending.')));
        }
        staged.approvals.set(next.id, next);
        return Promise.resolve(ok(undefined));
      },
    },
    audit: {
      append(entry, signal) {
        signal.throwIfAborted();
        staged.audit.push(entry);
        return Promise.resolve();
      },
    },
    outbox: {
      enqueue(event, signal) {
        signal.throwIfAborted();
        if (outboxFails) return Promise.reject(new Error('outbox insert failed'));
        staged.outbox.push(event);
        return Promise.resolve();
      },
    },
  });

  const uow: DecisionUnitOfWork = {
    run<T, E>(work: (tx: DecisionTx) => Promise<Result<T, E>>, signal: AbortSignal) {
      const result = tail.then(async () => {
        signal.throwIfAborted();
        const staged: Tables = {
          approvals: new Map(committed.approvals),
          audit: [...committed.audit],
          outbox: [...committed.outbox],
        };
        const outcome = await work(bind(staged)); // a throw skips the commit below
        if (outcome.ok) committed = staged;
        return outcome;
      });
      tail = result.catch(() => undefined);
      return result;
    },
  };

  return {
    uow,
    failOutbox: (fails: boolean) => {
      outboxFails = fails;
    },
    snapshot: () => ({
      approvals: [...committed.approvals.values()],
      audit: [...committed.audit],
      outbox: [...committed.outbox],
    }),
  };
};
