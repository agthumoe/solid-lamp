# Decision fixtures and review evidence

Task [#21](https://github.com/agthumoe/solid-lamp/issues/21). Contracts: [catalog](catalog-contract.md), [routing](routing-contract.md), [scheduling](scheduling-contract.md). Dataset: [42 routing cases](../../../evals/routing/cases.json). Status: design and fixture validation only; no production policy, scheduler, LLM or GPU evaluation has run.

## Fixture format and interpretation

`schemaVersion` and `boundaryVersion` are 1. `defaults` is a complete synthetic accepted environment; `cases` contains stable ID, description, `inputPatch`, expected decision and coverage tags. Expand each case from a fresh deep copy. Recursively replace object fields, replacing arrays/null/scalars outright. A null binding means absent, not a candidate primary. The synthetic enabled specialists and placeholder profile are deliberate assumptions used to exercise future decision paths, not assertions about installed models or accepted evidence. R41 represents absent active finance binding/candidate evidence; the active repo config is unchanged.

`request` includes ownerAgent, enum proposal array, authenticated flag, roleOverride, writeRequested, outputStarted, cancelled, remainingMs, attempts and optional explicit plan. Request shape here also contains trusted execution state; future transport must keep authentication/run state server-owned rather than allowing clients to set it. Remaining time is a synthetic monotonic-budget value; zero is expired. `models` and `bindings` are reviewed-state summaries, not authoritative caller inputs or full production records. `domainAccepted` means acceptance for this request's agent scope, not blanket competence in all domains.

Expected `kind`, `reason`, selected agent/model (null for rejection/clarification), `attemptLimit` and `writeAllowed` define the oracle. Successful fallback must additionally record the primary and actual fallback artifact in the future runtime run envelope. `steps` describes sequential agent analysis then synthesis, not parallel GPU calls. Bindings resolve semantic roles/profiles; no client tag selects an artifact. Contradictory enabled/missing-evidence cases exercise defensive validation after loader/state changes; the production loader must already reject those configs.

## Coverage reviewed

| Cases   | Intent / invariant                                                                                                          |
| ------- | --------------------------------------------------------------------------------------------------------------------------- |
| R01–R05 | Explicit owner precedence, four intended domains, allowed single classifier proposal                                        |
| R06–R10 | Ambiguity, empty intent, disallowed tax, disabled agent, missing binding                                                    |
| R11–R19 | Candidate/evaluating/disabled state, license/revocation, artifact/profile/scope/capability gates                            |
| R20–R24 | Disclosed pre-output fallback, cold-load availability, disabled/unaccepted fallback, partial streamed failure               |
| R25–R30 | Cancel/deadline/attempt budget, source injection, external override and unauthorized write                                  |
| R31–R33 | Dimension/space/version mismatch and active embedding unavailability                                                        |
| R34–R36 | Three sequential domain analyses plus synthesis, loop prevention, delegation limit                                          |
| R37–R42 | Unknown agent, authentication, disabled binding, inactive fallback, actual candidate condition, unknown classifier proposal |

Manual review checks decision precedence, null identities on no-dispatch paths, candidate evidence isolation and absence of write authority. All success cases assume accepted scope; no test treats a model-card license badge as a runtime permission grant. Unavailable retained alternatives are not silently substituted. Deleting a model is never an allowed expected result.

## Validation now and later

Now: parse JSON; check 42 unique IDs, required input/expected fields and enum values, expected identities matching retained catalog, no write permission, no fallback after output starts, one coverage tag minimum, fresh-patch semantics, and minimum 20-case requirement. Inspect the described oracle against the contract. Run repository `pnpm check` separately. Those steps validate fixture integrity and current repo quality, not implementation behavior.

Phase 1 implementation: define strict Zod schema for runtime request/decision and evidence/config records; adapt this dataset to a parameterized policy-port test. Independently test properties rather than deriving expected values from the implementation. Record each observed decision alongside expected output; assert no unauthorized gate/tool dispatch. Fake-clock scheduler tests separately cover ordering/capacity/starvation, cancellation/teardown, observed loaded-profile transitions, restart and one global authority. No Ollama or cloud calls in public CI.

Later local acceptance: separately tracked, serialized idle-host evaluation for model/template/context compatibility, latency, VRAM and residency. Claude's domain cases score citation correctness, substantive reasoning, abstention and arithmetic independently. Passing routing cases does not imply domain quality, legal/accounting competence or investment returns.

## Integration requests

No shared file changes are requested by this design. Before implementation, integration must track: catalog/schema migration retaining all mappings, trusted evidence registry, single gateway transport/auth and recovery behavior, policy-port fixture harness, fake-clock scheduler tests and future run-view provenance. Model/role enablement waits for scoped evidence and owner phase acceptance. Do not copy synthetic fixture states into active config.
