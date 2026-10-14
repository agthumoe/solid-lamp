# Workstream boundary contract v1

Frozen by coordination task [#19](https://github.com/agthumoe/solid-lamp/issues/19). This document is read-only in #20/#21. It is a design interface, not an implemented runtime API. Candidate evidence can remain unknown without blocking routing design.

## Shared identifiers and ownership

Agent IDs: `knowledge`, `legal-us-tx`, `finance`, `accountant`; `tax-us-tx` is a later proposal. Planned roles: `knowledge`, `legal-research`, `financial-analysis`, `accounting`; existing `chat`, `router`, `coder`, `embed`, `vision` remain unchanged. Source candidate IDs: `Equall/Saul-7B-Instruct-v1`, `SUFE-AIFLM-Lab/Fin-R1`, `AudCor/cpa-qwen3-8b-v0`. Existing Qwen3.5-9B is the comparison baseline. Exact local specialist tags are unresolved and must not be invented as installed bindings.

Claude supplies evidence documents keyed by candidate ID, with upstream URL/revision, license status (`verified`, `unresolved`, `restricted`), artifact/template availability, domain/source scope, known gaps and acceptance-case/rubric references. All research facts include provenance and retrieval date. It cannot set enabled bindings or claim successful live evaluation when only a design exists.

Codex consumes that conceptual evidence with conservative missing defaults, defining catalog states (`candidate`, `evaluating`, `enabled`, `disabled`), role resolution, runtime availability and fallback policy. Evidence required to enable includes verified license/provenance, supported local artifact/template, accepted GPU/context results and domain quality review. No evidence or failed evidence means inactive. It cannot resolve licensing from a third-party label or make up domain-case truth.

## Fixture separation

Claude domain fixtures live only in `evals/domain/**`; each case names stable ID, agent/domain, answerability, synthetic source IDs/text, source dates/jurisdiction, question, expected claims/citations/calculation or abstention, and grading rubric. Prefer small JSON files per domain/category; never add private documents, credentials or actual owner ledger data.

Codex decision fixtures live only in `evals/routing/**`; each names stable ID, owner intent, allowed agents, candidate/binding/evidence/availability states, deadline/cancellation/output state and expected route/fallback/rejection reason. At least 20 cases cover explicit owner selection, ambiguity, disabled/missing candidates, no post-stream fallback, no embedding-space fallback, source injection and bounded sequential delegation.

Neither fixture collection imports the other task's unmerged files. IDs join the designs; integration later creates a validated runtime schema/harness in its own tracked scope. Existing `pnpm check` is required but is not proof these new cases passed model evaluation.

## Output invariants

Planned runs expose actual semantic role and artifact identity, source references/as-of dates, fallback reason, unresolved evidence, calculated results and review status. Tools remain allowlisted/read-only unless independently approved. Decimal arithmetic and ledger invariants are deterministic; models interpret/explain. Sources never select routes/tools. One active inference globally, shared-model context explicitly accounted for, vector versions isolated, all retained model artifacts preserved.
