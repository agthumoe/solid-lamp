# Artifact readiness records

Task [#34](https://github.com/agthumoe/solid-lamp/issues/34). Human-readable dossier and recommendations: [readiness dossier](../../docs/workstreams/round2/claude/readiness-dossier.md). Boundary: [round-2 contract](../../docs/workstreams/round2/CONTRACT.md).

[`candidates.json`](candidates.json) holds one readiness record per contract candidate ID: `Equall/Saul-7B-Instruct-v1`, `AudCor/cpa-qwen3-8b-v0`, `SUFE-AIFLM-Lab/Fin-R1` and the `Qwen/Qwen3.5-9B` baseline. Retrieved 2026-10-14T06:13:52Z from public metadata. **No weights were downloaded, converted, installed or run**, and nothing here enables a model or changes active config.

## Record fields

| Field              | Content                                                                                                                                                     |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `candidate_id`     | Contract candidate ID                                                                                                                                       |
| `role`             | Intended agent, planned role and evaluation profile                                                                                                         |
| `upstream`         | Repository URL, pinned `revision`, `last_modified`, API sources, link to the round-1 evidence pin, declared parameter count and per-shard weight hashes     |
| `license`          | `status` (`verified` \| `unresolved` \| `restricted`), the declaration and its sources, `accepted_chain`, unresolved restrictions                           |
| `architecture`     | Layers, KV heads, head dimension, attention type, maximum positions (from the pinned `config.json`)                                                         |
| `template`         | Template source and sha256 (computed here over the retrieved text), system-role support, default system prompt, thinking behaviour, prompt-v2 compatibility |
| `artifact_options` | GGUF conversions or the Ollama registry artifact: revision, license label, declared base model, header metadata, quant-file hashes, identity evidence       |
| `local_artifact`   | What exists locally; hashes stay `null` until verified on the host                                                                                          |
| `token_budget`     | Prompt-v2 size statistics from the merged fixtures, estimated tokens, output cap, recommended `num_ctx`                                                     |
| `gpu_estimate`     | Weight size and KV-cache estimate, with measured references; estimates only                                                                                 |
| `readiness`        | `status`, `blockers`, and `future_tests` (quality and production-profile)                                                                                   |

## Rules

- Every hash has a `hash_origin` from the legend in the file. Hub and registry declarations are never marked `locally_verified`. No `local_artifact_verified` hash exists yet.
- `converted_upstream_revision` stays `null`, because no converter recorded it; identity is argued in `identity_evidence` from commit dates, unchanged weight hashes, parameter counts and embedded-template hashes.
- Readiness statuses (`ready_for_acquisition_review`, `blocked_license`, `installed_baseline_pending_local_verification`) describe evidence for #31 planning. They are not enabled bindings, download approvals or adoption.

## Re-verification

Revisions move. Before any acquisition, re-run the same read-only requests and compare:

```bash
curl -s https://huggingface.co/api/models/<repo-id>                               # sha, lastModified, cardData.license, gguf header
curl -s "https://huggingface.co/api/models/<repo-id>/tree/<sha>?recursive=true"    # lfs.oid (sha256) and lfs.size per file
curl -s -H 'Accept: application/vnd.docker.distribution.manifest.v2+json' \
  https://registry.ollama.ai/v2/library/qwen3.5/manifests/9b | sha256sum         # baseline manifest digest
```

At this revision, all 34 recorded file hashes were cross-checked against the retrieved hub metadata, and the four template hashes were recomputed from the retrieved template text.
