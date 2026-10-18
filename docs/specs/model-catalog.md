# Retained model catalog and binding validation

Issue: [#69](https://github.com/agthumoe/solid-lamp/issues/69). Status: implemented (Phase 1 slice). Parent: #3. Decisions: [ADR 0004](../adr/0004-domain-model-routing.md), owner decisions [#47](https://github.com/agthumoe/solid-lamp/issues/47). Design: [catalog contract](../workstreams/codex/catalog-contract.md).

## Goal

Retention is separate from selection. `config/catalog.yaml` lists every model the owner keeps: the 10 installed models, the planned deep model and the three declined specialist candidates. A role in `models.yaml` may use a model only when the catalog says it is enabled, accepted for that role and backed by passed evidence. A contradiction stops startup instead of being routed around.

## Non-goals

Changing active bindings or routing, enabling a candidate, domain roles and their agent scopes (Phase 7), an evidence registry with reviewers and expiry, and per-profile records. This slice validates the bindings that exist today.

## Record (`parseCatalog`, strict zod)

`id` (stable, unique), `tag` (unique, or null while unresolved), `digest` (64-hex Ollama digest or null), `upstream`, `state` (`candidate | evaluating | enabled | disabled`), `retained: true`, `capabilities` (`text | vision | tools | thinking | embedding`), `dimensions` (embedding records only), `roles` (roles the record is accepted for), `disabled_reason` (required when disabled), and `evidence[]`.

Each evidence entry has a `kind` (`gpu_context | tool_calling | task_quality | license | provenance | owner_acceptance`), a `status` (`pending | passed | failed | revoked`), a `scope` (runtime or planned domain roles) and a `ref`, which is a repo path under `docs/`, `config/` or `evals/`, or an https link. Unknown keys fail. Enabled records need a tag and digest.

## Binding rules (`validateBindings(models, catalog)`)

For every bound role and every configured fallback:

1. The tag resolves to a catalog record (untagged references normalise to `:latest`).
2. The record is `enabled` and lists the role in `roles`.
3. It has the needed capability (`embed` → embedding, `vision` → vision, otherwise text).
4. It has no failed or revoked evidence scoped to the role, and at least one passed `gpu_context` evidence entry for it.
5. Embed dimensions match the catalog, for the primary and for each embedding fallback's options.
6. A fallback differs from the role's primary.

All problems are reported together as `binding invalid: …` (up to five listed). `apps/inference` exits at startup on any failure. `pnpm run doctor` reports `catalog.yaml`, `bindings` and `artifacts`:

- **Fail:** a changed digest on an enabled record.
- **Warn:** a changed digest on any other record, or an installed model missing from the catalog.

## Current catalog (2026-10-18)

- **Enabled:** `qwen3.5:9b` (chat/router/coder/vision; vision task quality pending), `qwen3-embedding:0.6b` (embed, 1024), `qwen3:8b` and `gemma4:12b` (chat fallbacks only) and `nomic-embed-text` (768; versioned rebuild only, per ADR 0002).
- **Disabled but retained:** `qwen3.5:4b` (unbound alternate), `qwen2.5-coder:14b` (0/18 native tool calls), the three pre-existing DeepSeek/Qwen 2.5 models and `qwen3.6:35b-a3b` (deep, RAM gate).
- **Candidates without a tag:** Saul, Fin-R1 and CPA-Qwen (acquisition declined in #47).

Digests were read from the local `ollama list`.

## Acceptance

Tests cover:

- The schema rejects duplicate IDs and tags, unknown keys, enabled records without a digest, disabled records without a reason, embedding records without dimensions, non-retained records, free-text refs and invalid YAML.
- Bindings reject an uncatalogued model, a role not accepted, a non-enabled state, a missing capability, failed scoped evidence, missing `gpu_context` evidence, an embed dimension mismatch, a self-fallback, a fallback not accepted for the role and an uncatalogued fallback.
- The committed catalog retains the full portfolio, every evidence path exists, and it validates the committed `models.yaml`.
- Doctor reports a missing catalog, a contradictory binding, changed digests and uncatalogued models.

A manual run of inference with a contradictory catalog exited with the binding error. `pnpm check` passes.
