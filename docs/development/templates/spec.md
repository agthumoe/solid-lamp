# Template: feature or agent spec

Copy to `docs/specs/<name>.md` before building. Keep it to what a reviewer needs to accept or reject the implementation. Example: [LlmGate](../../specs/llm-gate.md).

```markdown
# <Feature name>

Issue: #NN. Status: draft | accepted. Related: ADR NNNN, specs …

Goal: one or two sentences: the owner-visible outcome.

Non-goals: what this deliberately doesn't do.

Inputs / outputs: requests, events, data read and written; contracts (zod DTO names, routes, events).

Behaviour: the rules, in order. State machine if there are states. Defaults and limits.

Safety: side effects and their approval path; untrusted content handling; private data in logs; failure modes and what the owner sees.

Acceptance tests: the list of behaviours that must be tested (happy path, each error, replay/concurrency/restart where relevant).

Open questions: with the default chosen until answered.
```
