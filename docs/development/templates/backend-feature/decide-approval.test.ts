// Template: unit tests for a use case. Uses node:test so it runs in `pnpm test` today;
// application code uses Vitest with the same describe/it/assert shape.
// Real home: apps/api/src/features/approvals/application/decide-approval.test.ts

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { Approval } from './approval.ts';
import { decideApproval, type DecideApprovalInput } from './decide-approval.ts';
import { createInMemoryApprovalDb } from './in-memory-approval-db.ts';

const NOW = new Date('2026-10-15T12:00:00Z');

// Builder: sensible defaults, override only what the test is about.
const makeApproval = (overrides: Partial<Approval> = {}): Approval => ({
  id: 'apr_1',
  runId: 'run_1',
  toolName: 'tasks.propose_create',
  payloadHash: 'hash_a',
  status: 'pending',
  expiresAt: new Date('2026-10-15T13:00:00Z'),
  ...overrides,
});

const makeDeps = (seed: Approval[]) => {
  const db = createInMemoryApprovalDb(seed);
  return { deps: { uow: db.uow, clock: { now: () => NOW } }, db };
};

const approve: DecideApprovalInput = {
  approvalId: 'apr_1',
  decision: 'approve',
  payloadHash: 'hash_a',
};

const signal = new AbortController().signal;

void describe('decideApproval', () => {
  void it('commits the decision, one audit entry and one outbox event together', async () => {
    const { deps, db } = makeDeps([makeApproval()]);

    const result = await decideApproval(deps, approve, signal);

    assert.equal(result.ok && result.value.status, 'approved');
    const state = db.snapshot();
    assert.equal(state.approvals[0]?.status, 'approved');
    assert.equal(state.audit.length, 1);
    assert.deepEqual(state.outbox, [
      { type: 'approval.decided', approvalId: 'apr_1', status: 'approved' },
    ]);
  });

  void it('rolls the decision back when the outbox write fails, so a retry succeeds', async () => {
    const { deps, db } = makeDeps([makeApproval()]);
    db.failOutbox(true);

    await assert.rejects(decideApproval(deps, approve, signal), /outbox insert failed/);

    const afterFailure = db.snapshot();
    assert.equal(afterFailure.approvals[0]?.status, 'pending');
    assert.deepEqual(afterFailure.audit, []);
    assert.deepEqual(afterFailure.outbox, []);

    db.failOutbox(false);
    const retry = await decideApproval(deps, approve, signal);

    assert.equal(retry.ok, true);
    assert.equal(db.snapshot().outbox.length, 1);
  });

  void it('rejects a second decision (replay) without writing audit or outbox again', async () => {
    const { deps, db } = makeDeps([makeApproval()]);
    await decideApproval(deps, approve, signal);

    const replay = await decideApproval(deps, approve, signal);

    assert.equal(!replay.ok && replay.error.code, 'APPROVAL_ALREADY_DECIDED');
    assert.equal(db.snapshot().audit.length, 1);
    assert.equal(db.snapshot().outbox.length, 1);
  });

  void it('rejects a decision after the approval expired and writes nothing', async () => {
    const { deps, db } = makeDeps([makeApproval({ expiresAt: NOW })]);

    const result = await decideApproval(deps, approve, signal);

    assert.equal(!result.ok && result.error.code, 'APPROVAL_EXPIRED');
    assert.deepEqual(db.snapshot().outbox, []);
    assert.equal(db.snapshot().approvals[0]?.status, 'pending');
  });

  void it('rejects a decision whose payload hash differs from the proposal', async () => {
    const { deps } = makeDeps([makeApproval()]);

    const result = await decideApproval(deps, { ...approve, payloadHash: 'hash_tampered' }, signal);

    assert.equal(!result.ok && result.error.code, 'PAYLOAD_MISMATCH');
  });

  void it('lets exactly one of two concurrent decisions win', async () => {
    const { deps, db } = makeDeps([makeApproval()]);

    const results = await Promise.all([
      decideApproval(deps, approve, signal),
      decideApproval(deps, { ...approve, decision: 'reject' }, signal),
    ]);

    assert.equal(results.filter((r) => r.ok).length, 1);
    assert.notEqual(db.snapshot().approvals[0]?.status, 'pending');
    assert.equal(db.snapshot().outbox.length, 1);
  });

  void it('returns NOT_FOUND for an unknown approval', async () => {
    const { deps } = makeDeps([]);

    const result = await decideApproval(deps, { ...approve, approvalId: 'missing' }, signal);

    assert.equal(!result.ok && result.error.code, 'NOT_FOUND');
  });
});
