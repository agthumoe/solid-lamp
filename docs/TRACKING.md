# GitHub plan and progress

Repository: https://github.com/agthumoe/solid-lamp. Task tracking uses issues/phase milestones; STATUS and PLAN summarize facts and handoffs. See [delivery standards](development/delivery.md).

| Phase / work                                     | GitHub task                                             | Status / dependency                                                              |
| ------------------------------------------------ | ------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Handbook, project skills and initial publication | [#1](https://github.com/agthumoe/solid-lamp/issues/1)   | Delivered; pushed baseline and green CI, final evidence in the issue             |
| 0 — Models and acceptance                        | [#2](https://github.com/agthumoe/solid-lamp/issues/2)   | Owner model decision and benchmark follow-up                                     |
| 1 — Scaffold/foundations                         | [#3](https://github.com/agthumoe/solid-lamp/issues/3)   | Blocked by Phase 0/go-ahead                                                      |
| 2 — Brain/recovery                               | [#4](https://github.com/agthumoe/solid-lamp/issues/4)   | Phase 1                                                                          |
| 3 — Agents/API/approvals                         | [#5](https://github.com/agthumoe/solid-lamp/issues/5)   | Phase 2                                                                          |
| 4 — Dashboard/frontend                           | [#6](https://github.com/agthumoe/solid-lamp/issues/6)   | Phase 3                                                                          |
| 5 — Graph/workflows                              | [#7](https://github.com/agthumoe/solid-lamp/issues/7)   | Phase 4                                                                          |
| 6 — Background/WhatsApp                          | [#8](https://github.com/agthumoe/solid-lamp/issues/8)   | Phase 5                                                                          |
| 7 — Domain agents                                | [#9](https://github.com/agthumoe/solid-lamp/issues/9)   | Phase 6; one agent spec/task at a time                                           |
| 8 — Operational hardening                        | [#10](https://github.com/agthumoe/solid-lamp/issues/10) | Phase 7                                                                          |
| Handbook compliance enforcement                  | [#13](https://github.com/agthumoe/solid-lamp/issues/13) | Implemented current-code gates; PR/CI evidence and future applicability in issue |
| CI bootstrap refresh                             | [#12](https://github.com/agthumoe/solid-lamp/issues/12) | Official Node 24 action revisions and Ubuntu 24.04 pinned; CI evidence in issue  |
| Remaining benchmark acceptance/CLI findings      | [#11](https://github.com/agthumoe/solid-lamp/issues/11) | Fixed by #13; regression tests and required CI verify acceptance                 |

Each phase has its own GitHub milestone. Split an epic into bounded implementation tasks before starting its phase; each child needs acceptance and tests. These tasks are plans, not claims that the application features are implemented. Changing task status or resolving owner decisions must also update the local handoff.
