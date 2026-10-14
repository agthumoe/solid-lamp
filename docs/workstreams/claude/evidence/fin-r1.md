# Evidence: `SUFE-AIFLM-Lab/Fin-R1`

Contract candidate ID: `SUFE-AIFLM-Lab/Fin-R1`. Intended agent: `finance` (planned role `financial-analysis`). Retrieved 2026-10-13. Index: [evidence README](README.md).

## Identity and provenance

| Field           | Value                                                                                                                                                                               | Source                                                                                                                             |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Repository      | `SUFE-AIFLM-Lab/Fin-R1`, public, not gated                                                                                                                                          | [HF API](https://huggingface.co/api/models/SUFE-AIFLM-Lab/Fin-R1)                                                                  |
| Pinned revision | `026768c4a015b591b54b240743edeac1de0970fa`, last modified 2025-03-21T02:01:04Z (created 2025-03-17)                                                                                 | HF API                                                                                                                             |
| Code repository | [github.com/SUFE-AIFLM-Lab/Fin-R1](https://github.com/SUFE-AIFLM-Lab/Fin-R1), latest commit `06ead1e61ff77cad71dc409198b1a2575d748ecd` (2025-03-27)                                 | GitHub API                                                                                                                         |
| Publisher       | SUFE-AIFLM-Lab (School of Statistics and Data Science, Shanghai University of Finance and Economics) and FinStep.AI                                                                 | [English card @ revision](https://huggingface.co/SUFE-AIFLM-Lab/Fin-R1/blob/026768c4a015b591b54b240743edeac1de0970fa/README_en.md) |
| Paper           | "Fin-R1: A Large Language Model for Financial Reasoning through Reinforcement Learning", [arXiv:2503.16252](https://arxiv.org/abs/2503.16252), first 2025-03-20, updated 2026-03-19 | arXiv                                                                                                                              |
| Base model      | `Qwen/Qwen2.5-7B-Instruct` (revision `a09a3545…`, Apache-2.0 with LICENSE file)                                                                                                     | card, [HF API](https://huggingface.co/api/models/Qwen/Qwen2.5-7B-Instruct)                                                         |
| Architecture    | `Qwen2ForCausalLM`, 28 layers, hidden 3584, 4 KV heads, vocab 152064, `max_position_embeddings` 32768; ~7.62 B parameters                                                           | `config.json` @ revision                                                                                                           |
| Training path   | `_name_or_path` points to a private `X-R1-7B-fin-v1/checkpoint-50` directory                                                                                                        | `config.json` @ revision                                                                                                           |
| Files           | Four safetensors shards, tokenizer, `Technical_report.pdf`, images. **No `LICENSE` file**, no GGUF                                                                                  | HF API `siblings`                                                                                                                  |

## License

- **Status: `unresolved`.** Adoption is blocked.
- Hugging Face card metadata has **no `license` field**, and the model repo has no LICENSE file.
- The GitHub repo reports `license: null`, and `GET /repos/SUFE-AIFLM-Lab/Fin-R1/license` returned **404**. Its root contains only `Images`, `README.md`, `README_en.md`, `README_ja.md` and `Technical_report.pdf`.
- The only signal is a README **badge** reading "license Apache_2.0" that links to the generic apache.org page, in both the English and Chinese READMEs. A badge isn't a license grant with a defined licensor and scope, and it doesn't say whether it covers the weights, the code, the Fin-R1-Data dataset, or all three.
- Third-party GGUF repos that label it Apache-2.0 can't establish upstream permission.

**What would resolve it:** a LICENSE file or `license` metadata from the publisher on Hugging Face or GitHub, or a written statement from the publisher (via the contact listed on the model card) naming the license for the weights. Record the new revision and re-verify. Contacting the publisher is an external action; it needs the owner's go-ahead and isn't done in this task.

**Further unresolved restrictions, even if a license appears:**

1. **Distillation and judge chain.** Fin-R1-Data (~60k CoT samples) was distilled with DeepSeek-R1 (MIT, revision `56d4cbbb…`). Answers and reasoning were scored with `Qwen/Qwen2.5-72B-Instruct`, which is under the separate **Qwen license** (`license: other`, `license_name: qwen`) rather than Apache-2.0. The RL reward also used **Qwen2.5-Max**, a proprietary API model whose service terms weren't reviewed. Whether those terms constrain models trained with their outputs is unaudited.
2. **Source datasets.** FinCorpus, Ant_Finance, FinPEE, FinCUGE, FinanceIQ, Finance-Instruct-500K, FinQA, TFNS, ConvFinQA and FinanceQT. Their individual licenses weren't verified in this task.

## Artifact and runtime compatibility (not measured)

- Standard Qwen2.5 ChatML template (`<|im_start|>`, EOS `<|im_end|>`), including Qwen tool-call formatting. Its default system prompt identifies the model as "Qwen, created by Alibaba Cloud", which is inherited and harmless but shows the template wasn't customized.
- R1-style models emit long reasoning before the answer. Evaluation must budget output tokens and score only the final answer, while logging reasoning length. See [protocol §Output handling](../evaluation-protocol.md#output-handling).
- Ollama supports the Qwen2 architecture; Fin-R1 conversion and template behaviour are **unverified**. Third-party GGUF: `Mungert/Fin-R1-GGUF` (cited in canonical research), unverified.

## Domain scope and known gaps

- **Reported results** (publisher, own harness): FinQA 76.0, ConvFinQA 85.0, Ant_Finance 81.0, TFNS 71.0, Finance-Instruct-500k 62.9, average 75.2, versus Qwen-2.5-7B-Instruct average 65.6. These are publisher numbers on public benchmarks, not reproduced here, and they don't compare against Qwen3.5-9B.
- **Data emphasis:** Chinese and English, with banking, securities and trust scenarios and much Chinese-market content (e.g. Ant_Finance, FinCUGE). US GAAP/SEC-filing coverage is a subset, not a focus.
- **Not established:** reliability for investment decisions, current market data (it has none at inference), tax, or US securities-law compliance. Prices, quotes and filing dates must come from dated source adapters, and arithmetic from deterministic decimal code.

## Evaluation references

- Fixtures: [`evals/domain/finance`](../../../../evals/domain/README.md). Rubrics: [`FIN-*`](../rubrics.md#finance). Protocol: [evaluation protocol](../evaluation-protocol.md).
- **Do not run a local evaluation until the license is resolved**, unless the owner explicitly accepts running an unlicensed artifact for private evaluation only. That's an owner decision, recorded in #15.
