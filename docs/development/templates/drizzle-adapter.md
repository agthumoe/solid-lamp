# Template: Drizzle adapter (infrastructure layer)

Real home: `apps/api/src/features/<feature>/infrastructure/drizzle-<capability>.ts`. Implements a port declared by the application layer ([ports](backend-feature/ports.ts)). Not compiled until Phase 1 installs Drizzle. Schema rules: [database](../database.md).

```ts
import { and, eq } from 'drizzle-orm';

import { approvals, type Db } from '@aetherion/db';
import { appError, err, ok } from '@aetherion/shared';
import type { Approval } from '../domain/approval.ts';
import type { ApprovalStore } from '../application/ports.ts';

// The client (or the current transaction) is injected; no global connection import.
export const createDrizzleApprovalStore = (db: Db): ApprovalStore => ({
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

Transactions: the use case receives a `UnitOfWork` port (`run(fn)`) when several writes must commit together (decision + audit + outbox). The adapter implements it with `db.transaction(async (tx) => fn(createAdapters(tx)))`.

Checklist: port implemented exactly (same errors as the fake); conditional writes for state transitions; select only needed columns for lists; integration test against the real local DB in `test/integration/`.
