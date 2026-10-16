# Template: Drizzle adapter (infrastructure layer)

Real home: `apps/api/src/features/<feature>/infrastructure/drizzle-<capability>.ts`. Implements a port declared by the application layer ([ports](backend-feature/ports.ts)). Not compiled until Phase 1 installs Drizzle. Schema rules: [database](../database.md).

```ts
import { and, eq } from 'drizzle-orm';

import { approvals, type Db, type DbTx } from '@aetherion/db';
import { appError, err, ok } from '@aetherion/shared';
import type { Approval } from '../domain/approval.ts';
import type { ApprovalStore } from '../application/ports.ts';

// The client (or the current transaction) is injected; no global connection import.
export const createDrizzleApprovalStore = (db: Db | DbTx): ApprovalStore => ({
  async get(id, signal) {
    signal.throwIfAborted();
    const [row] = await db.select().from(approvals).where(eq(approvals.id, id)).limit(1);
    return row === undefined ? undefined : toDomain(row);
  },

  async saveDecision(next, signal) {
    signal.throwIfAborted();
    // Conditional single-use transition: only a still-pending row is updated.
    const updated = await db
      .update(approvals)
      .set({ status: next.status, decidedAt: next.decidedAt })
      .where(and(eq(approvals.id, next.id), eq(approvals.status, 'pending')))
      .returning({ id: approvals.id });
    return updated.length === 1
      ? ok(undefined)
      : err(appError('CONFLICT', 'Approval is no longer pending.'));
  },
});

// Row → domain mapping lives in the adapter, so the domain never sees column names.
const toDomain = (row: typeof approvals.$inferSelect): Approval => ({
  id: row.id,
  runId: row.runId,
  toolName: row.toolName,
  payloadHash: row.payloadHash,
  status: row.status,
  expiresAt: row.expiresAt,
  ...(row.decidedAt === null ? {} : { decidedAt: row.decidedAt }),
});
```

## Unit of work: decision + audit + outbox in one transaction

The use case never sees a transaction object; it receives a `DecisionUnitOfWork` ([ports](backend-feature/ports.ts)). The adapter binds every writer to the same Drizzle `tx` and rolls back on an `err` result or a throw.

```ts
import type { Result } from '@aetherion/shared';
import type { DecisionTx, DecisionUnitOfWork } from '../application/ports.ts';

const ROLLBACK = Symbol('rollback'); // thrown only to make Drizzle roll back an err result

export const createDrizzleDecisionUnitOfWork = (db: Db): DecisionUnitOfWork => ({
  async run<T, E>(work: (tx: DecisionTx) => Promise<Result<T, E>>, signal: AbortSignal) {
    signal.throwIfAborted();
    let outcome: Result<T, E> | undefined;
    try {
      await db.transaction(async (tx) => {
        outcome = await work({
          store: createDrizzleApprovalStore(tx),
          audit: createDrizzleAuditWriter(tx),
          outbox: createDrizzleOutboxWriter(tx),
        });
        if (!outcome.ok) throw ROLLBACK;
      });
    } catch (error) {
      if (error !== ROLLBACK) throw error; // infrastructure failure: rolled back, re-thrown
    }
    if (outcome === undefined) throw new Error('unit of work finished without an outcome');
    return outcome;
  },
});
```

The integration test mirrors the fake's test: make the outbox insert fail (for example a constraint violation) and assert the approval row is still `pending` with no audit row.

Checklist: port implemented exactly (same errors as the fake); conditional writes for state transitions; select only needed columns for lists; integration test against the real local DB in `test/integration/`.
