// Template: safety tests every tool executor needs (allowlist, schema, approval, timeout).

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  executeToolCall,
  makeBrainSearchTool,
  payloadHash,
  tasksProposeCreateTool,
  type ToolContext,
} from './tool-definition.ts';

const ctx: ToolContext = { runId: 'run_1', signal: new AbortController().signal };

const brainSearch = makeBrainSearchTool({
  search: (query) =>
    Promise.resolve([{ chunkId: 'c1', text: `about ${query}`, citation: 'note.md#h1' }]),
});

void describe('executeToolCall', () => {
  void it('refuses a tool that is not on the agent allowlist', async () => {
    const result = await executeToolCall(brainSearch, new Set(), { query: 'x' }, ctx);

    assert.equal(!result.ok && result.error.code, 'FORBIDDEN');
  });

  void it('rejects unknown argument keys', async () => {
    const result = await executeToolCall(
      brainSearch,
      new Set(['brain.search']),
      { query: 'x', tools: ['tasks.propose_create'] },
      ctx,
    );

    assert.equal(!result.ok && result.error.code, 'VALIDATION_FAILED');
  });

  void it('runs a read-only tool and returns validated data', async () => {
    const result = await executeToolCall(
      brainSearch,
      new Set(['brain.search']),
      { query: 'tax' },
      ctx,
    );

    assert.equal(result.ok && result.value.kind, 'result');
  });

  void it('never executes a side-effect tool; it asks for approval with a payload hash', async () => {
    const args = { title: 'Renew passport' };
    const result = await executeToolCall(
      tasksProposeCreateTool,
      new Set(['tasks.propose_create']),
      args,
      ctx,
    );

    assert.ok(result.ok && result.value.kind === 'approval_required');
    assert.equal(result.value.payloadHash, payloadHash('tasks.propose_create', args));
  });

  void it('hashes arguments independently of key order', () => {
    assert.equal(payloadHash('t', { a: 1, b: 2 }), payloadHash('t', { b: 2, a: 1 }));
    assert.notEqual(payloadHash('t', { a: 1 }), payloadHash('t', { a: 2 }));
  });

  void it('maps a timeout to UNAVAILABLE', async () => {
    const slow = makeBrainSearchTool({
      search: (_q, _l, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    });
    const fast = { ...slow, timeoutMs: 10 };

    const result = await executeToolCall(fast, new Set(['brain.search']), { query: 'x' }, ctx);

    assert.equal(!result.ok && result.error.code, 'UNAVAILABLE');
  });
});
