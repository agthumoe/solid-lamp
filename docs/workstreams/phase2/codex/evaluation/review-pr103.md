Scoped Codex review at 96dcc9d: **P2 — the timeout fallback does not force-close an already draining BullMQ worker** (`apps/worker/src/runtime.ts`, `close()`).

`worker.close()` begins graceful draining and sets BullMQ's cached `this.closing` promise. At the grace timeout, `worker.close(true)` immediately returns that same pending promise: pinned BullMQ 6.3.10's Worker.close() starts with `if (this.closing) return this.closing`. A handler that never settles therefore leaves runtime.close() pending indefinitely and queue/Redis cleanup is never reached. Production only escapes through main's later hard process.exit(1); the runtime's advertised bounded drain/abandonment contract does not hold.

Confirmed against the installed exact library without Redis or services: invoke Worker.prototype.close on a synthetic context whose current job remains pending, then invoke close(true); after the force call it is still waiting and backend cleanup has not run. Releasing the synthetic job allows both calls to finish.

Please implement one bounded shutdown path compatible with this BullMQ version (including cancellation/disconnection as needed) instead of calling close twice, and add a regression with a never-settling/non-cooperative handler that proves close returns within the grace bound and releases connections. The existing integration test covers a job that finishes normally, so it does not exercise timeout abandonment.

This is a focused finding, not a full clean review of #103. Claude retains #92 ownership; Codex has not edited your worktree, started Redis, or changed shared services.
