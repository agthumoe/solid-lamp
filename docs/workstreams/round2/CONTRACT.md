# Round 2 boundary v1

Frozen by [#33](https://github.com/agthumoe/solid-lamp/issues/33). Both task branches read this file; shared changes require coordinated integration. No production runtime interface is implemented by this contract.

## Inputs and independent outputs

Codex reads the merged `evals/domain/manifest.json` and the six schema-v2 fixture files without editing them. Each file's agent_policy is trusted reviewed fixture policy, distinct from synthetic source text. Optional claims aren't required, and source text/formula strings are data; never eval them. Validate structural/accounting invariants and sanitized failure paths. Substantive legal/accounting correctness and model answers remain separately reviewed/evaluated. Write schema/CLI/tests under scripts/domain-evals, owned spec under docs/specs/domain-fixture-integrity.md, and scripts/command mirrors only in the root files. No schema is imposed on Claude's artifact dossier.

Claude reads existing evidence and primary metadata; it produces reviewed readiness records under its own directories. Each candidate record identifies publisher ID, retrieval time/source URL/revision, evidence category/status, artifact kind/revision/hash or explicit unresolved null, template identity, intended role/profile, remaining blockers and future test requirements. Status words mean readiness evidence, not an enabled runtime binding. A hash must identify a retrieved metadata declaration or a locally verified artifact; distinguish those origins. No model artifact is downloaded in this round.

Both use existing candidate IDs Equall/Saul-7B-Instruct-v1, SUFE-AIFLM-Lab/Fin-R1, AudCor/cpa-qwen3-8b-v0 and Qwen/Qwen3.5-9B. Existing 10 installed models and disabled deep proposal remain retained; existing active role/vector configuration is unchanged.

## Dependency and success semantics

#30 and #34 do not import each other's unmerged outputs. Either can finish first. #34 readiness work can complete with Fin-R1 unresolved and other evidence pending; that is not #31/live adoption completion. #30 fixture integrity can pass while professional review/model performance remains unproven. Actual #31 execution depends on the accepted fixture/tooling version, per-candidate license/provenance, a reviewed acquisition/evaluation scope and exclusive GPU coordination. Neither task closes #15 or the Phase 0 owner gate.

Errors/logs expose stable identifiers/paths/reasons only, never private input/source snippets, credentials or raw model content. Public artifacts in this round contain only synthetic data or public metadata. Root dependencies, model config, canonical instructions and source fixtures remain read-only outside the specific root-script/spec exceptions in #30.
