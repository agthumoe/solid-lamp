# Specialist candidate evidence (#20)

Task: [#20](https://github.com/agthumoe/solid-lamp/issues/20), under [#15](https://github.com/agthumoe/solid-lamp/issues/15) and [#19](https://github.com/agthumoe/solid-lamp/issues/19). Interface: [contract v1](../../CONTRACT.md). Retrieved: **2026-10-13**, read-only Hugging Face API, model-card, GitHub API and arXiv requests. No weights, GGUF files or datasets were downloaded, and no model was run.

This is evidence for a later adoption decision, not the decision itself. A `verified` license status means the publisher's own license declaration was found at a pinned revision. It does **not** mean the training-data chain has been audited, that the owner's use is cleared, or that the model is competent. Those items are listed per candidate as unresolved restrictions.

## Status summary (keyed by contract candidate ID)

| Candidate ID                                                                    | Pinned revision                            | License status | Declared license                                                    | Artifact / template                                                                                               | Domain fit                                                                    | Detail                                           |
| ------------------------------------------------------------------------------- | ------------------------------------------ | -------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------ |
| [Equall/Saul-7B-Instruct-v1](https://huggingface.co/Equall/Saul-7B-Instruct-v1) | `2133ba7923533934e78f73848045299dd74f08d2` | `verified`     | MIT (card metadata + paper)                                         | Safetensors (Mistral arch). Template **rejects system messages**. No first-party GGUF.                            | Multi-jurisdiction English legal text; not Texas-specific; pre-2024 knowledge | [saul-7b-instruct-v1.md](saul-7b-instruct-v1.md) |
| [SUFE-AIFLM-Lab/Fin-R1](https://huggingface.co/SUFE-AIFLM-Lab/Fin-R1)           | `026768c4a015b591b54b240743edeac1de0970fa` | `unresolved`   | None in metadata or LICENSE file; README badge only says Apache-2.0 | Safetensors (Qwen2 arch). Default Qwen2.5 template. No first-party GGUF.                                          | Financial-statement QA and numerical reasoning; Chinese and English data      | [fin-r1.md](fin-r1.md)                           |
| [AudCor/cpa-qwen3-8b-v0](https://huggingface.co/AudCor/cpa-qwen3-8b-v0)         | `a00310433dc2b9d21093bcca7f0c6a746b62fbb9` | `verified`     | Apache-2.0 (card metadata only)                                     | Safetensors (Qwen3 arch), fine-tuned from a 4-bit Unsloth base. Ships `chat_template.jinja`. No first-party GGUF. | General finance instruction data; accounting competence unproven              | [cpa-qwen3-8b-v0.md](cpa-qwen3-8b-v0.md)         |
| Baseline [Qwen/Qwen3.5-9B](https://huggingface.co/Qwen/Qwen3.5-9B)              | `c202236235762e1c871ad0ccb60c8ee5ba337b9a` | `verified`     | Apache-2.0 (metadata + LICENSE file)                                | Already installed locally as `qwen3.5:9b`                                                                         | General; existing chat/vision role                                            | [qwen3.5-9b-baseline.md](qwen3.5-9b-baseline.md) |

`restricted` is not assigned to any candidate: no candidate publishes terms that forbid the owner's intended private, local use. Restrictions that _might_ flow from training data or third-party model outputs are unresolved, not established, and are listed per candidate.

## Cross-cutting adoption blockers

1. **Fin-R1 license is unresolved.** Only a README badge. Adoption stays blocked until the publisher adds a LICENSE/metadata declaration or answers in writing. A third-party GGUF's license label cannot substitute.
2. **No candidate has an immutable local artifact.** Ollama tags, GGUF conversions, quantization, digests and template conversions do not exist yet. They need a separately tracked, authorized download/conversion task with an exclusive GPU lease (workstreams rule 7).
3. **No candidate has local quality evidence.** Publisher scores are on public benchmarks, not owner-relevant US/Texas cases. Run the fixtures in [`evals/domain`](../../../../evals/domain/README.md) under the [protocol](../evaluation-protocol.md) first.
4. **Training-data terms are not audited for any candidate.** Each chain includes third-party data or model outputs whose terms were not reviewed. That needs owner (and, if wanted, counsel) acceptance; this document doesn't give a legal opinion.
5. **Qualified review.** Consequential legal/accounting conclusions need a qualified human reviewer under the [rubrics](../rubrics.md). Automated scoring can't establish correctness.

## Artifact readiness (round 2)

Per-artifact pins, GGUF options with hub-declared hashes and derivation status, template compatibility, token budgets and production-profile test requirements now live in [`evals/artifact-readiness`](../../../../evals/artifact-readiness/README.md), with the [readiness dossier](../../round2/claude/readiness-dossier.md) (#34, retrieved 2026-10-14). That record supersedes this index for artifact identity; the license and provenance findings here still apply.

## Re-verification

Revisions and metadata change. Before any adoption step, re-run the same read-only requests and compare `sha`/`lastModified`:

```bash
curl -s https://huggingface.co/api/models/<candidate-id>   # sha, lastModified, cardData.license, siblings
curl -s https://api.github.com/repos/SUFE-AIFLM-Lab/Fin-R1/license   # Fin-R1 only; 404 on 2026-10-13
```

These records pin immutable revisions. A newer repository HEAD doesn't invalidate them; re-fetch at the pinned revision and verify hashes before use, and treat a newer revision as a separate candidate needing its own review.
