// Template: test FAKE implementing a port. It honours the same contract as the real
// adapter (single-use conditional write, abort), so tests against it stay meaningful.
// Real home: apps/api/test/support/in-memory-approval-store.ts

import { appError, err, ok } from '../result-and-errors.ts';
import type { Approval } from './approval.ts';
import type { ApprovalStore } from './ports.ts';

export const createInMemoryApprovalStore = (
  seed: readonly Approval[] = [],
): ApprovalStore & { snapshot(): readonly Approval[] } => {
  const rows = new Map(seed.map((a) => [a.id, a]));

  return {
    get(id, signal) {
      signal.throwIfAborted();
      return Promise.resolve(rows.get(id));
    },
    saveDecision(next, signal) {
      signal.throwIfAborted();
      const stored = rows.get(next.id);
      if (stored?.status !== 'pending') {
        return Promise.resolve(err(appError('CONFLICT', 'Approval is no longer pending.')));
      }
      rows.set(next.id, next);
      return Promise.resolve(ok(undefined));
    },
    snapshot: () => [...rows.values()],
  };
};
