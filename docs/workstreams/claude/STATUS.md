# claude workbench status

Status: **deliverables complete; PR open for review** on [#20](https://github.com/agthumoe/solid-lamp/issues/20). Read [coordination rules](../README.md) and [contract](../CONTRACT.md).

## Now

- Branch `docs/20-claude-domain-evaluation` in `/tmp/aetherion-workbenches/claude` (base `c3133a4`). #20 is `status:in-progress`.
- Delivered (design only; no model was downloaded or run):
  - [Candidate evidence](evidence/README.md), keyed by contract candidate ID, at pinned revisions, retrieved 2026-10-13: Saul `verified` (MIT), Fin-R1 **`unresolved`** (README badge only), CPA-Qwen `verified` (Apache-2.0 metadata only), Qwen3.5-9B baseline `verified`.
  - [Domain source requirements](domain-sources.md), [rubrics](rubrics.md), [baseline comparison protocol](evaluation-protocol.md).
  - [`evals/domain`](../../../evals/domain/README.md): 180 synthetic cases, 40 answerable + 20 adversarial/unanswerable per domain, with expected claims and citations, exact calculations (81 cases), balanced journal entries (32 cases) and required abstentions (28 cases).

## Next

1. Owner/integrator review of the PR. The integration owner applies any shared-file changes under a separate integration issue.
2. Separately tracked follow-ups (not this task): resolve Fin-R1 licensing; authorize artifact download/conversion and a live run under the protocol with the exclusive GPU lease; a committed fixture schema validator; a qualified-reviewer pass on expected answers.

## Blocked

| Blocker                                                                                         | Owner / route                                  |
| ----------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| Fin-R1 has no license grant (badge only; no LICENSE file or metadata on Hugging Face or GitHub) | Owner decides whether to contact the publisher |
| No pinned local artifact/template for any candidate; downloads need a tracked, authorized task  | #15 follow-up task + GPU lease                 |
| Training-data and model-output terms not audited for any candidate                              | Owner acceptance (counsel if wanted)           |
| Expected answers not yet reviewed by qualified domain professionals                             | Before any adoption decision                   |
| Personal vs business accounting scope (canonical Blocked #6); fixtures use a fictional business | Owner                                          |

## Session log

- 2026-10-13: Coordination bootstrap; ready for the assigned agent, not started.
- 2026-10-13: Claude started #20; branch/worktree verified, issue marked in progress.
- 2026-10-14: Evidence, source requirements, rubrics, protocol and 180 synthetic fixtures delivered inside owned paths; formatted; `pnpm check` and fixture validation run (results in PR and #20).
