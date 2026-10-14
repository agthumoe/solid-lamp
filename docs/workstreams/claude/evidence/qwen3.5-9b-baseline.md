# Baseline: Qwen3.5-9B (`qwen3.5:9b`)

Comparison baseline for every specialist ([contract v1](../../CONTRACT.md)). Retrieved 2026-10-13. Index: [evidence README](README.md).

| Field             | Value                                                                                                             | Source                                                                  |
| ----------------- | ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Upstream          | `Qwen/Qwen3.5-9B`, revision `c202236235762e1c871ad0ccb60c8ee5ba337b9a`, last modified 2026-03-02                  | [HF API](https://huggingface.co/api/models/Qwen/Qwen3.5-9B)             |
| License           | **`verified`**: Apache-2.0 in metadata, with a `LICENSE` file in the repository                                   | HF API `cardData.license_link`                                          |
| Local artifact    | Ollama tag `qwen3.5:9b` (Q4_K_M per BUILD_PROMPT §4; confirm at run time), installed and benchmarked in Phase 0   | [HARDWARE.md](../../../HARDWARE.md)                                     |
| Measured behavior | ~49–51 tok/s decode, 100% GPU at 16K context, 18/18 native schema-valid tool calls on the Phase 0 synthetic suite | [HARDWARE.md](../../../HARDWARE.md); Phase 0 artifacts in `docs/bench/` |

The local Ollama digest was not re-read in this task (no Ollama calls). The evaluation run must record it from `ollama show` / `/api/tags` at run time. The upstream revision above identifies the source weights, not the local quantized build.

## Why it's the baseline

It's the current chat/knowledge model, so a specialist only earns a preferred binding if it **beats this model on the same synthetic sources, prompts and settings** (domain-agent plan, adoption gates). If Qwen performs as well or better, the specialist stays retained but isn't preferred.

## Known limits relevant to domain evaluation

- General model, no domain-specific training claims. The Phase 0 brain fixture was too easy to rank models (every model scored 10/10), so it says nothing about domain quality.
- Thinking mode is off in the current role config and must stay identical across the baseline runs being compared ([protocol](../evaluation-protocol.md)).
- Shared-model roles reload when `num_ctx` differs (measured ~3.8 s). Use the same context profile for every baseline run.
