# Evidence: `AudCor/cpa-qwen3-8b-v0`

Contract candidate ID: `AudCor/cpa-qwen3-8b-v0`. Intended agent: `accountant` (planned role `accounting`). Retrieved 2026-10-13. Index: [evidence README](README.md).

## Identity and provenance

| Field           | Value                                                                                                                                                                                                     | Source                                                                                                                                                                |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Repository      | `AudCor/cpa-qwen3-8b-v0`, public, not gated                                                                                                                                                               | [HF API](https://huggingface.co/api/models/AudCor/cpa-qwen3-8b-v0)                                                                                                    |
| Pinned revision | `a00310433dc2b9d21093bcca7f0c6a746b62fbb9`, last modified 2026-01-18T03:24:13Z (created 2026-01-18T02:35:18Z)                                                                                             | HF API                                                                                                                                                                |
| Publisher       | AudCor (Hugging Face organization). The card describes it as building AI tools for CPA firms; no paper, technical report or code repository                                                               | [card @ revision](https://huggingface.co/AudCor/cpa-qwen3-8b-v0/blob/a00310433dc2b9d21093bcca7f0c6a746b62fbb9/README.md)                                              |
| Declared base   | `unsloth/Qwen3-8B-unsloth-bnb-4bit` (revision `62efd7f9…`, Apache-2.0, no LICENSE file), itself a 4-bit bitsandbytes quantization of `Qwen/Qwen3-8B` (revision `b968826d…`, Apache-2.0 with LICENSE file) | card metadata; HF API for [base](https://huggingface.co/api/models/unsloth/Qwen3-8B-unsloth-bnb-4bit) and [Qwen3-8B](https://huggingface.co/api/models/Qwen/Qwen3-8B) |
| Declared data   | `Josephgflowers/Finance-Instruct-500k` (dataset metadata Apache-2.0; current revision `583a98fb…`, last modified **2026-02-24**, after the model was created)                                             | card metadata; [dataset API](https://huggingface.co/api/datasets/Josephgflowers/Finance-Instruct-500k)                                                                |
| Architecture    | `Qwen3ForCausalLM`, bf16 safetensors, ~8.19 B parameters                                                                                                                                                  | `config.json` @ revision                                                                                                                                              |
| Files           | Four safetensors shards, tokenizer, `chat_template.jinja`. **No `LICENSE` file**, no GGUF                                                                                                                 | HF API `siblings`                                                                                                                                                     |

## License

- **Status: `verified`** (publisher declaration in card metadata only): `license: apache-2.0`. The chain to Qwen3-8B is Apache-2.0 at every declared hop.
- That's a single declaration, with no LICENSE file or NOTICE text.

**Unresolved restrictions:**

1. **No LICENSE/NOTICE file.** Apache-2.0 redistribution needs the license text and any NOTICE. Local private use doesn't redistribute.
2. **Training dataset is an aggregate.** Finance-Instruct-500k is a compiled instruction set. Its Apache-2.0 tag was not traced back to each upstream component in this task.
3. **Unknown dataset revision.** The dataset was modified after the model was created, so the revision actually used for training is unknown.

## Artifact and runtime compatibility (not measured)

- Fine-tuned from a **4-bit bitsandbytes base** but published as bf16 weights. The card doesn't say how the adapters were merged or dequantized. Quantization error from the 4-bit base may already be baked into the weights, and a further Q4 GGUF quantizes twice. Compare quality at Q4_K_M and a higher-precision quantization before drawing conclusions.
- Ships a Qwen3-style `chat_template.jinja` with tool and `<tool_call>` formatting. Whether it keeps Qwen3's thinking-mode switch, and how Ollama handles it, is **unverified**. Score only the final answer.
- The card's usage example uses a CPA system prompt. Run the protocol both with the project's neutral system prompt and with the card's prompt, and report both.
- Ollama supports Qwen3. Conversion and template behaviour for this repo are unverified. Third-party GGUF: `mradermacher/cpa-qwen3-8b-v0-GGUF` (cited in canonical research), unverified.

## Domain scope and known gaps

- **No evaluation results are published.** The card's "CPA Exam Insights" section describes CPA exam scoring (pass mark 75, multistage testlets) and cites a third-party blog. It doesn't report any score for this model. Its claims of "exam-grade reasoning" and "strict adherence to GAAP, IFRS, and tax codes" are **unsupported** by published evidence.
- The training data is general finance instruction data, not a curated accounting/auditing corpus. Accounting competence must be shown on this project's fixtures.
- The card mentions tax planning. Under the domain-agent plan, **tax is out of scope** for `accountant`; the fixtures test that the model declines or defers tax determinations.
- Card disclaimer: "Not Financial Advice… not a licensed CPA". Its citation block says year 2025, while the repo was created in 2026, a minor inconsistency.
- "v0" naming, a single commit-day history and no release notes all suggest an experimental release. This matches the canonical research classification: "experimental comparison only".

## Evaluation references

- Fixtures: [`evals/domain/accountant`](../../../../evals/domain/README.md). Rubrics: [`ACC-*`](../rubrics.md#accountant). Protocol: [evaluation protocol](../evaluation-protocol.md).
- Arithmetic, debit/credit balance and reconciliation results are computed deterministically. The model is scored only on classification, explanation and abstention.
