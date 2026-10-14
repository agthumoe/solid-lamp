# Specialist artifact and evaluation readiness dossier (#34)

Task [#34](https://github.com/agthumoe/solid-lamp/issues/34), a readiness child of [#31](https://github.com/agthumoe/solid-lamp/issues/31) and [#15](https://github.com/agthumoe/solid-lamp/issues/15); coordination [#33](https://github.com/agthumoe/solid-lamp/issues/33); [round-2 boundary](../CONTRACT.md). Machine-readable records: [`evals/artifact-readiness/candidates.json`](../../../../evals/artifact-readiness/candidates.json). Builds on the merged [candidate evidence](../../claude/evidence/README.md), [prompt-v2 protocol](../../claude/evaluation-protocol.md) and [domain-agent plan](../../../specs/domain-agent-plan.md).

**Retrieved 2026-10-14T06:13:52Z.** Public metadata only: Hugging Face model/tree APIs, raw config/template files, GitHub and arXiv APIs, and the public Ollama registry manifest. No weights were downloaded, converted or installed, and no local Ollama or GPU call was made. "Ready" in this document means ready for an acquisition **review**. It is not an enabled binding, an approval to download, or adoption. All ten installed models and the disabled deep proposal are retained; nothing here changes active config.

## How to read the hashes

Every hash carries an origin; unknown values stay `null`.

| Origin                           | Meaning                                                                                          | Counts as local verification? |
| -------------------------------- | ------------------------------------------------------------------------------------------------ | ----------------------------- |
| `hub_lfs_declaration`            | SHA-256 the Hugging Face hub reports for an LFS file at a pinned revision                        | No                            |
| `hub_parsed_gguf_header`         | Architecture, parameter count and embedded chat template the hub parsed from a GGUF header       | No                            |
| `registry_manifest_declaration`  | Digest in the public Ollama registry manifest                                                    | No                            |
| `locally_computed_metadata_file` | SHA-256 computed here over a retrieved small metadata file (chat template text, registry layers) | Yes, for that file only       |
| `local_artifact_verified`        | SHA-256 computed locally over a downloaded model artifact                                        | Yes; **none exist yet**       |

## Readiness and blocker matrix

| Candidate                    | Upstream revision (unchanged since 2026-10-13) | License status                                       | Recommended artifact (Q4_K_M)                                                                                              | Prompt-v2 template                                                               | Est. budget (input + output)                    | Readiness                                 |
| ---------------------------- | ---------------------------------------------- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------- | ----------------------------------------- |
| `Equall/Saul-7B-Instruct-v1` | `2133ba79…`                                    | `verified` (MIT declaration); chain pending          | `mradermacher/Saul-7B-Instruct-v1-GGUF` @ `d2920136…`, 4.37 GB, hub sha256 `7034821b…`                                     | Compatible; rejects any system message                                           | ≈1,519 + 1,024 = 2,543 ≤ 4,096 window           | **Ready for acquisition review**          |
| `AudCor/cpa-qwen3-8b-v0`     | `a0031043…`                                    | `verified` (Apache-2.0 metadata only); chain pending | `mradermacher/cpa-qwen3-8b-v0-GGUF` @ `fd4ca189…`, 5.03 GB, hub sha256 `c18b06d8…`                                         | Compatible only with thinking **disabled** (defaults on)                         | ≈2,025 + 1,024 = 3,049 ≤ 4,096                  | **Ready for acquisition review**          |
| `SUFE-AIFLM-Lab/Fin-R1`      | `026768c4…`                                    | **`unresolved`** (badge only)                        | `bartowski/SUFE-AIFLM-Lab_Fin-R1-GGUF` @ `61b41286…`, 4.68 GB, hub sha256 `d50f16c5…` (identified, **not** to be acquired) | Compatible; auto-inserts the default "You are Qwen…" system prompt               | ≈1,331 + 4,096 = 5,427 **> 4,096**; needs 8,192 | **Blocked: license**                      |
| `Qwen/Qwen3.5-9B` (baseline) | `c2022362…`                                    | `verified` (Apache-2.0 + LICENSE)                    | Installed `qwen3.5:9b`; registry manifest sha256 `56671c2a…` (prefix equals the 2026-10-12 local ID)                       | Ollama applies a built-in renderer (template layer `{{ .Prompt }}`); verify live | ≤ 3,049 in every domain, thinking off           | **Installed; local verification pending** |

Blockers per candidate (full lists are in `candidates.json` → `readiness.blockers`):

- **Saul:**
  - owner acceptance of the unaudited training-data terms and the missing LICENSE text;
  - local artifact verification;
  - production-profile GPU evidence;
  - local quality results and qualified legal review.
- **CPA-Qwen:**
  - owner acceptance of a metadata-only license with an untraced aggregate training set;
  - thinking-off behaviour in Ollama unverified;
  - local artifact verification and GPU evidence;
  - quality results, qualified accounting review, and the personal vs business scope decision.
- **Fin-R1:**
  - no license grant: acquisition stays blocked unless the publisher adds a license, or the owner records an explicit private-evaluation-only acceptance in #15;
  - the protocol context budget must change before any run.
- **Qwen baseline:**
  - full local digest check at run time;
  - live prompt-v2 rendering check;
  - explicit sampling parameters, to neutralize the registry defaults.

## Evidence by candidate

### Saul-7B-Instruct-v1

- **Upstream:** last commit 2024-03-10, which is the pinned revision. Six float32 safetensors shards totalling 28.97 GB; the hub declares sha256 and size for each.
- **License:** MIT, declared in the card metadata and the paper. No LICENSE file. Restrictions are carried forward from the [round-1 evidence](../../claude/evidence/saul-7b-instruct-v1.md).
- **Artifact:** the mradermacher conversion is dated 2024-12, after the final upstream commit, so it can only derive from the pinned weights. Its header parameter count (7,241,732,096) equals upstream's, and its embedded template's sha256 equals the upstream template's (`26a59556…`). The i1 (imatrix) and tensorblock repositories are alternatives and aren't pinned here. A local conversion from the fp32 source is the fallback if the third-party verification fails.
- **Template:** Mistral `[INST]` format; any system message raises an exception. Prompt v2's single user turn is compatible, but an Ollama Modelfile must not inject a system prompt.
- **Context:** its 4,096-token sliding window means prompt plus output must stay within 4,096. The estimate (2,543) fits.

### CPA-Qwen3-8B-v0

- **Upstream:** last commit 2026-01-18 (the pinned revision); bf16 weights, 16.39 GB.
- **License:** Apache-2.0 in card metadata only. The fine-tuning base is a 4-bit bitsandbytes quantization, so Q4_K_M re-quantizes already-quantized weights. Compare Q4_K_M with Q8_0 before drawing conclusions.
- **Artifact:** the only GGUF found (mradermacher, 2026-01-19, after the final upstream commit). Parameter count (8,190,735,360) and template sha256 (`96fd16d3…`) match upstream.
- **Template:** Qwen3 ChatML. **Thinking defaults on** unless `enable_thinking=false`, which renders an empty `<think></think>` block. With thinking on, reasoning would consume the 1,024-token output cap. The run must set thinking off and confirm the Ollama import honours it.

### Fin-R1

- **Upstream:** the weights, config and tokenizer config are byte-identical across every revision since 2025-03-17. Later commits changed only README, images and the technical report.
- **License:** still **unresolved**:
  - no `license` field and no LICENSE file on Hugging Face;
  - GitHub license `null`, `/license` returns 404, last commit 2025-03-27;
  - only the README "Apache 2.0" badge;
  - the paper is at arXiv v5 (2026-03-19), which isn't a license grant for the weights.

  The distillation/judging chain and the source datasets remain unaudited.

- **Artifacts:** identified so they can be pinned **if** licensing resolves; none should be acquired now.
  - bartowski (preferred): no license label, consistent with upstream.
  - mradermacher: dated before the final upstream commit, but the weights didn't change, so it is the same model.
  - Mungert: labelled apache-2.0 with no upstream grant, and declares no base model.

  All three embed the upstream template (`cd8e9439…`) and report the upstream parameter count.

- **Template:** Qwen2.5 ChatML with no `<think>` handling; R1-style reasoning appears as plain text. A single user turn auto-inserts the default Qwen system prompt. The publisher's generation config recommends sampling (temperature 0.7, top-p 0.8, repetition penalty 1.05). The protocol's deterministic decoding is a deliberate deviation to record.

### Qwen3.5-9B baseline

- **Upstream:** a hybrid model. 8 of its 32 layers are full attention (4 KV heads, head_dim 256); the other 24 use linear attention with a fixed-size state, so its KV cache grows slowly with context. It is multimodal: the Ollama artifact carries a 0.92 GB vision projector layer.
- **Installed artifact:** the public registry manifest for `qwen3.5:9b` has sha256 `56671c2a…`, whose first 12 characters equal the ID `ollama list` showed on 2026-10-12. That's a prefix match to an earlier observation; a full local digest check belongs to #31. The model layer is `sha256:02d45dc1…` (5.63 GB).
- **Template:** Ollama doesn't embed the upstream Jinja template (`{{ .Prompt }}` layer) and applies a built-in Qwen3.5 renderer, so prompt-v2 rendering must be checked live.
- **Default parameters:** the registry ships `temperature` 1, `top_p` 0.95, `top_k` 20 and **`presence_penalty` 1.5**. Unless every request sets these explicitly, the baseline runs with a penalty the specialist imports don't have.
- **Reference GGUFs:** bartowski and LM Studio embed the upstream template; unsloth's is modified.

## Token-budget requirements

Prompt sizes are measured by rendering every merged prompt-v2 case (policy, documents and question). Token counts are **estimates** at a conservative 3 characters per token; #31 must recount with each model's tokenizer.

| Domain fixtures | Median / p95 / max prompt chars   | Est. max input tokens | Output cap                         | Est. max total | Requirement                                                                                                       |
| --------------- | --------------------------------- | --------------------- | ---------------------------------- | -------------- | ----------------------------------------------------------------------------------------------------------------- |
| `legal-us-tx`   | 2,764 / 4,106 / 4,557 (LEG-X-004) | 1,519                 | 1,024                              | 2,543          | `num_ctx` 4096 suffices; also inside Saul's 4,096 window                                                          |
| `accountant`    | 5,337 / 5,925 / 6,075 (ACC-A-022) | 2,025                 | 1,024 (thinking off)               | 3,049          | `num_ctx` 4096 suffices only with thinking disabled                                                               |
| `finance`       | 2,711 / 3,971 / 3,993 (FIN-X-020) | 1,331                 | 4,096 for Fin-R1; 1,024 for others | 5,427 (Fin-R1) | **Fin-R1 needs `num_ctx` 8192.** The merged protocol's `num_ctx` 4096 plus a 4,096-token reasoning cap cannot fit |

As long as nothing is truncated, `num_ctx` changes memory allocation, not output. So a per-arm context size is fair, provided it is recorded and truncation is checked for every case (`prompt_eval_count`, `done_reason`).

## Production-profile GPU requirements

Estimates (no measurement):

| Candidate           | Q4_K_M weights                          | KV cache, q8_0 (attention layers only) |
| ------------------- | --------------------------------------- | -------------------------------------- |
| Saul                | 4,368 MB                                | ≈285 MB at 4K / 570 MB at 8K           |
| CPA-Qwen            | 5,028 MB                                | ≈321 MB at 4K / 642 MB at 8K           |
| Fin-R1              | 4,683 MB                                | ≈125 MB at 4K / 250 MB at 8K           |
| Qwen3.5-9B baseline | 5,629 MB model layer + 922 MB projector | ≈71 MB at 4K / 285 MB at 16K           |

Measured references:

- the baseline reports 5.46 GB at 16K;
- the baseline plus the embedding model use 7.71 GB, with `nvidia-smi` showing 10,096 of 12,288 MiB;
- the embedding model alone is 2.25 GB at 8K;
- the Windows desktop holds 0.8–1.6 GB.

Weights, KV, embedding and desktop add up to roughly 8.5–9.2 GB per candidate **before** compute buffers. That's plausible on the 12 GB card, but unproven. Required tests (in `candidates.json` → `readiness.future_tests.production_profile`):

1. **Exclusive host lease** and idle checks, with start and finish posted in #15.
2. **Co-residency:** the candidate at its evaluated quantization and context, loaded together with `qwen3-embedding:0.6b` at its active profile. Both must show 100% GPU, cross-checked with `nvidia-smi` including desktop VRAM, with headroom recorded and the strict residency check applied.
3. **Swap:** from resident chat + embed → candidate → one case → restore chat. Record cold load, swap time, time to first token, decode speed and any eviction of the embedding model.
4. **Failure handling:** a failure keeps the candidate inactive. Quality runs with the generator alone remain diagnostic only.

## Recommendations for #31

1. **Scope acquisition to Saul and CPA-Qwen first**, each after owner acceptance of its license-chain residuals. Keep Fin-R1 blocked. Don't let Fin-R1's status imply anything about the others.
2. **Pin before downloading:** use the exact repository revision and quant file above. Verify the downloaded file's sha256 against the hub-declared value before import; that becomes the first `local_artifact_verified` hash. Record the Ollama model digest after import.
3. **Import templates faithfully:**
   - Saul: no system prompt.
   - CPA-Qwen: thinking-off path.
   - Fin-R1 (if ever unblocked): the default Qwen system turn.

   Render three prompt-v2 cases through the imported template and diff them against the upstream Jinja rendering.

4. **Set every sampling parameter explicitly per request** (temperature 0, seed, top_p, top_k, repeat and presence penalty) for all arms, so registry or publisher defaults can't differ across arms.
5. **Fix the protocol's context budget for reasoning models** (shared-change request below): a per-arm `num_ctx` sized to input + output, with truncation counted as failure.
6. **Recount tokens** with each model's tokenizer before the run, replacing the 3-characters-per-token estimates.
7. **Run quality and production-profile measurements as separate recorded steps**, with the GPU lease. Eligibility comes only from the production profile.
8. **Re-check upstream revisions on the day of acquisition;** a changed `sha` invalidates these records.

## Shared-change requests (posted on #34; not made here)

1. `docs/workstreams/claude/evaluation-protocol.md` run settings: replace the uniform `num_ctx` 4096 with a per-arm `num_ctx` ≥ input + output cap (Fin-R1: 8192), with truncation recorded as failure. Also require explicit per-request sampling parameters for all arms, and thinking explicitly off for CPA-Qwen.
2. `docs/workstreams/claude/evidence/*`: link these readiness records, or note in the evidence index that per-artifact pins now live in `evals/artifact-readiness/`.
