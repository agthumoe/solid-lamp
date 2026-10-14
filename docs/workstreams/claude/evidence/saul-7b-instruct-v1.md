# Evidence: `Equall/Saul-7B-Instruct-v1`

Contract candidate ID: `Equall/Saul-7B-Instruct-v1`. Intended agent: `legal-us-tx` (planned role `legal-research`). Retrieved 2026-10-13. Index: [evidence README](README.md).

## Identity and provenance

| Field                    | Value                                                                                                                                                                 | Source                                                                                                                             |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Repository               | `Equall/Saul-7B-Instruct-v1`, public, not gated                                                                                                                       | [HF API](https://huggingface.co/api/models/Equall/Saul-7B-Instruct-v1)                                                             |
| Pinned revision          | `2133ba7923533934e78f73848045299dd74f08d2`, last modified 2024-03-10T12:39:32Z (created 2024-02-07)                                                                   | HF API                                                                                                                             |
| Publisher                | Equall.ai with CentraleSupélec, Sorbonne Université, Instituto Superior Técnico and NOVA School of Law                                                                | [model card @ revision](https://huggingface.co/Equall/Saul-7B-Instruct-v1/blob/2133ba7923533934e78f73848045299dd74f08d2/README.md) |
| Paper                    | "SaulLM-7B: A pioneering Large Language Model for Law", [arXiv:2403.03883](https://arxiv.org/abs/2403.03883) v2, 2024-03-07                                           | arXiv                                                                                                                              |
| Base model               | Continued pretraining of Mistral-7B. The card doesn't name the exact checkpoint; `mistralai/Mistral-7B-v0.1` (revision `27d67f1b…`) declares Apache-2.0               | card, paper, [HF API](https://huggingface.co/api/models/mistralai/Mistral-7B-v0.1)                                                 |
| Architecture             | `MistralForCausalLM`, 32 layers, hidden 4096, 8 KV heads, vocab 32000, `max_position_embeddings` 32768, `sliding_window` 4096; ~7.24 B parameters (safetensors total) | `config.json` @ revision                                                                                                           |
| Training checkpoint name | `_name_or_path: "ift_hermes_legal_1e-5/checkpoint-192"`                                                                                                               | `config.json` @ revision                                                                                                           |
| Files                    | Six safetensors shards, tokenizer, `tokenizer_config.json` with chat template. **No `LICENSE` file**, no GGUF                                                         | HF API `siblings`                                                                                                                  |

## License

- **Status: `verified`** (publisher declaration found twice): card metadata `license: mit`, and the paper states "SaulLM-7B is released under the MIT License" and that the "evaluation code" is MIT too.
- The base model's Apache-2.0 terms allow a derivative to carry different terms, but Apache-2.0 attribution/NOTICE conditions still apply to redistribution. Local private use doesn't redistribute.

**Unresolved restrictions (record, don't assume away):**

1. **No LICENSE file and no copyright line.** MIT requires keeping the copyright notice with copies. Without the notice text, the exact attribution to reproduce is unknown. Request it from Equall if redistribution is ever planned.
2. **Training data terms not audited.** The paper's Table 1 lists FreeLaw (The Pile), EDGAR, MultiLegal Pile (commercial subset), EuroParl, GovInfo, Law Stack Exchange, Open Australian Legal Corpus, EU and UK legislation, CourtListener court-audio transcripts (Whisper), and USPTO. General instruction data comes from SlimOrca, MetaMathQA, UltraChat and Glaive Code Assistant v2. Several of these are LLM-generated or carry their own terms (e.g. Stack Exchange CC BY-SA, model-output terms on GPT-derived sets). Whether any obligation flows to the weights is a legal question this research doesn't answer.
3. **Checkpoint-name discrepancy.** `ift_hermes_legal` suggests Hermes-family instruction data, which the paper's instruction-mix section doesn't list. The actual instruction mix behind this exact revision is unverified.

## Artifact and runtime compatibility (not measured)

- **Chat template rejects `system` messages** and requires strict user/assistant alternation (`raise_exception('Only user and assistant roles are supported!')`). The protocol must put instructions into the first user turn for **both** Saul and the baseline, or comparisons will be confounded. See [protocol §Prompting](../evaluation-protocol.md#prompting).
- Mistral `[INST] … [/INST]` format, BOS `<s>`, EOS `</s>`. `tokenizer_config.json` reports an unbounded `model_max_length`; the effective attention window is 4096 (sliding window). The project's starting evaluation context of 4096 matches the window.
- Ollama/GGUF support is plausible for the Mistral architecture but **unverified**. Only third-party GGUF conversions exist (e.g. `mradermacher/Saul-7B-Instruct-v1-GGUF`, already cited in the canonical research). Their upstream identity, revision, hash and template must be verified, or a local conversion made, in a separately authorized task.
- No tool-calling support is declared. Keep it as a bounded analysis role with no tool selection, as the domain-agent plan already requires.

## Domain scope and known gaps

- **Jurisdiction mix:** US federal sources (EDGAR, GovInfo, CourtListener, USPTO) plus EU, UK and Australian material. It is **not Texas-specific**, and nothing in the evidence shows Texas statutes or Texas case law were deliberately included.
- **Recency:** released March 2024. It can't know law enacted, amended or decided after its corpus (e.g. the 2025 Texas legislative session). Every answer must come from dated, retrieved sources; model memory is not authority.
- **Reported quality:** LegalBench-Instruct and Legal-MMLU results compare against 2023-era 7B models. They don't establish superiority over Qwen3.5-9B or reliability on Texas research tasks. A legal answer from this model isn't legal advice.

## Evaluation references

- Fixtures: [`evals/domain/legal-us-tx`](../../../../evals/domain/README.md). Rubrics: [`LEGAL-*`](../rubrics.md#legal-us-tx). Protocol: [evaluation protocol](../evaluation-protocol.md).
- Adoption still needs: verified local artifact + template, measured GPU/context compatibility, rubric review by a qualified legal reviewer, and demonstrated benefit over the baseline.
