// Template: unit tests for a use case. Uses node:test so it runs in `pnpm test` today;
// application code uses Vitest with the same describe/it/assert shape.
// Real home: apps/api/src/features/approvals/application/decide-approval.test.ts

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { Approval } from './approval.ts';
import { decideApproval, type DecideApprovalDeps } from './decide-approval.ts';
import { createInMemoryApprovalStore } from './in-memory-approval-store.ts';

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
  const store = createInMemoryApprovalStore(seed);
  const events: string[] = [];
  const deps: DecideApprovalDeps = {
    store,
    clock: { now: () => NOW },
    outbox: {
      enqueue: (event) => {
        events.push(`${event.type}:${event.status}`);
        return Promise.resolve();
      },
    },
  };
  return { deps, store, events };
};

const signal = new AbortController().signal;

void describe('decideApproval', () => {
  void it('approves a pending approval and enqueues one outbox event', async () => {
    const { deps, events } = makeDeps([makeApproval()]);

    const result = await decideApproval(
      deps,
      { approvalId: 'apr_1', decision: 'approve', payloadHash: 'hash_a' },
      signal,
    );

    assert.equal(result.ok && result.value.status, 'approved');
    assert.deepEqual(events, ['approval.decided:approved']);
  });

  void it('rejects a second decision (replay)', async () => {
    const { deps } = makeDeps([makeApproval()]);
    const input = { approvalId: 'apr_1', decision: 'approve', payloadHash: 'hash_a' } as const;
    await decideApproval(deps, input, signal);

    const replay = await decideApproval(deps, input, signal);

    assert.equal(!replay.ok && replay.error.code, 'APPROVAL_ALREADY_DECIDED');
  });

  void it('rejects a decision after the approval expired', async () => {
    const { deps, events } = makeDeps([makeApproval({ expiresAt: NOW })]);

    const result = await decideApproval(
      deps,
      { approvalId: 'apr_1', decision: 'approve', payloadHash: 'hash_a' },
      signal,
    );

    assert.equal(!result.ok && result.error.code, 'APPROVAL_EXPIRED');
    assert.deepEqual(events, []);
  });

  void it('rejects a decision whose payload hash differs from the proposal', async () => {
    const { deps } = makeDeps([makeApproval()]);

    const result = await decideApproval(
      deps,
      { approvalId: 'apr_1', decision: 'approve', payloadHash: 'hash_tampered' },
      signal,
    );

    assert.equal(!result.ok && result.error.code, 'PAYLOAD_MISMATCH');
  });

  void it('lets exactly one of two concurrent decisions win', async () => {
    const { deps, store } = makeDeps([makeApproval()]);

    const results = await Promise.all([
      decideApproval(
        deps,
        { approvalId: 'apr_1', decision: 'approve', payloadHash: 'hash_a' },
        signal,
      ),
      decideApproval(
        deps,
        { approvalId: 'apr_1', decision: 'reject', payloadHash: 'hash_a' },
        signal,
      ),
    ]);

    assert.equal(results.filter((r) => r.ok).length, 1);
    assert.notEqual(store.snapshot()[0]?.status, 'pending');
  });

  void it('returns NOT_FOUND for an unknown approval', async () => {
    const { deps } = makeDeps([]);

    const result = await decideApproval(
      deps,
      { approvalId: 'missing', decision: 'reject', payloadHash: 'hash_a' },
      signal,
    );

    assert.equal(!result.ok && result.error.code, 'NOT_FOUND');
  });
});
