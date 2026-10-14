# Routing fixture integrity diagnostic

Task: [#24](https://github.com/agthumoe/solid-lamp/issues/24). Phase 0 follow-up to [#21](https://github.com/agthumoe/solid-lamp/issues/21). This diagnostic validates design data, not production routing or domain competence. It is stacked on PR #23 while Claude's #20 work remains independent.

## Behavior

`pnpm evals:check` parses `evals/routing/cases.json` through strict Zod schemas, requires version/boundary 1 and at least 20 uniquely identified cases, expands each recursive object patch from an independent defaults clone (arrays/null replace), then validates full expanded inputs and expected-result invariants. Unexpected fields, malformed types/states, duplicate IDs, unknown references and inconsistent no-dispatch/fallback/write results fail with nonzero exit. External invalid agent/role strings deliberately remain representable as adversarial inputs; trusted allowed-agent/model references must resolve. JSON object parsing/merge cannot introduce prototype keys.

A failure reports only case IDs, field paths and predefined reasons, not raw fixture/source content. No network, model, GPU or write API is called. Integrate the diagnostic and negative tests into existing `pnpm check` and command mirrors without changing dependencies or task-owned fixtures/docs.

## Boundaries and validation

Successful fixture states are hypothetical, not adoption approval. Validation never implements a decision oracle or claims expected answers were produced by a router. No domain-case schema is imposed on Claude; domain validation is a later integration task once its format is reviewed. Adoption/licensing rules remain in the workstream contract.

Negative tests mutate synthetic fixture structure and independent invariants: unknown keys/types, unsupported versions, duplicate IDs, invalid model references, too few cases, undeclared patch references, streamed or expired fallback, unauthorized writes, no-dispatch identities and patch independence. Future policy tests must compare actual results with these independently authored expected decisions; this integrity tool is not a substitute.

Recovery: revert the diagnostic/script integration; active config and model inventory are unaffected. Canonical STATUS/PLAN updates describe this stacked task; leave both workstream-owned handoffs unchanged. PR remains unmerged until coordinated integration.

Claude review follow-up: reason codes are a closed enum with kind compatibility; plan results must exactly preserve requested steps plus knowledge synthesis; partial output identifies its active attempt (primary at attempt 1, fallback at attempt 2); successful fallback requires an accepted distinct target; optional degraded retrieval cannot bypass required evidence. These are fixture invariants, not availability decision execution. The suite now contains 51 cases and 13 diagnostic regression groups.
