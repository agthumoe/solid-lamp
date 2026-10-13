# Hardware audit and model benchmarks

Host: **AETHERION** · audited 2026-10-12 (Phase 0).

## Host audit

| Item               | Found                                                                                                                                                         | Notes / action                                                                                                                    |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Windows            | 10.0.26300.9457                                                                                                                                               | —                                                                                                                                 |
| WSL                | 2.7.8.0, kernel 6.18.33.1-microsoft-standard-WSL2                                                                                                             | WSLg 1.0.73.2                                                                                                                     |
| Distro             | Pengwin 13 (Debian trixie)                                                                                                                                    | —                                                                                                                                 |
| systemd            | Enabled (`/etc/wsl.conf` `[boot] systemd=true`), state `running`                                                                                              | Node apps can run as systemd units (§13 preferred option)                                                                         |
| CPU                | i7-12700K, 20 threads visible                                                                                                                                 | —                                                                                                                                 |
| Host RAM           | **31.8 GB** (confirmed via `Win32_ComputerSystem`)                                                                                                            | —                                                                                                                                 |
| RAM visible to WSL | 15 GiB, swap 4 GiB. **No `.wslconfig` exists**                                                                                                                | Proposal: `infra/windows/wslconfig.proposed` (24 GB, 8 GB swap, no idle timeout). **Not applied.**                                |
| Disk               | `/` 1007 GB, 901 GB free; `C:` 954 GB, 648 GB free                                                                                                            | —                                                                                                                                 |
| GPU                | RTX 3060 12 GB, Windows driver 591.86, CUDA 13.1, `nvidia-smi` 590.57 in WSL                                                                                  | ~1.6 GB of VRAM already used by the Windows desktop → **~10.4 GB usable**                                                         |
| Node / pnpm        | Node **v24.17.0** (via nvm), pnpm 11.17.0, corepack 0.35.0                                                                                                    | Canonical requirements and package engine now use Node 24 (see PLAN decisions log)                                                |
| Docker             | Docker Desktop installed (WSL integration; CLI `/usr/bin/docker`), **daemon not running** (socket returns EOF); no Docker Engine service in WSL               | Start Docker Desktop before Phase 1 (Supabase CLI + Redis)                                                                        |
| Supabase CLI       | Not installed                                                                                                                                                 | Phase 1                                                                                                                           |
| Tailscale          | Not found in WSL or `C:\Program Files\Tailscale`                                                                                                              | Ask owner where it runs (Phase 4)                                                                                                 |
| Ollama             | 0.32.4 in WSL, systemd service `ollama` (enabled, user `ollama`), bound to `127.0.0.1:11434`, uses CUDA (compute 8.6, `cuda_v13`), reports 11.0 GiB available | No Windows-native Ollama installed. Default server config: flash attention **off**, KV cache f16, keep-alive 5m, default ctx 4096 |

### Models present

| Model                                             | Size               | Purpose                            |
| ------------------------------------------------- | ------------------ | ---------------------------------- |
| `qwen3.5:9b`                                      | —                  | `chat` (pulled in Phase 0)         |
| `qwen3.5:4b`                                      | —                  | `router` (pulled in Phase 0)       |
| `qwen3-embedding:0.6b`                            | —                  | `embed` (pulled in Phase 0)        |
| `qwen2.5-coder:14b`                               | 9.0 GB             | `coder` (pre-existing)             |
| `qwen3:8b`, `gemma4:12b`                          | —                  | chat fallbacks (pulled in Phase 0) |
| `nomic-embed-text`                                | 274 MB             | embed fallback (pre-existing)      |
| `deepseek-r1:14b`, `deepseek-r1:7b`, `qwen2.5:7b` | 9.0 / 4.7 / 4.7 GB | Pre-existing, unused by Aetherion  |

## Ollama settings

Target settings live in `infra/ollama/override.conf` (systemd drop-in). Status: **installed 2026-10-12** at `/etc/systemd/system/ollama.service.d/override.conf`; verified via the `server config` line in `journalctl -u ollama`.

## Benchmarks

Harness: `pnpm bench:models` (`scripts/bench/models.ts`). Raw results: `docs/bench/results-*.json`.

### Baseline — Ollama default settings (flash attention off, f16 KV)

Run 2026-10-12, `--label baseline-defaults`, role models only. Idle VRAM used by Windows: 1589 MiB.

| Role   | Model             | ctx | Decode tok/s | TTFT (warm) | Prefill tok/s | TTFT @ ~7K prompt   | `/api/ps` size → VRAM | GPU       | Tool calls (20)                                   | Brain Q (10)     |
| ------ | ----------------- | --- | ------------ | ----------- | ------------- | ------------------- | --------------------- | --------- | ------------------------------------------------- | ---------------- |
| chat   | qwen3.5:9b        | 16K | **50.8**     | 337 ms      | 1695          | 4.5 s               | 5.69 → 5.69 GB        | 100%      | 18 native successes + 2 abstentions (old scoring) | 10/10, all cited |
| router | qwen3.5:4b        | 4K  | **77.5**     | 339 ms      | 2464          | 1.0 s (1.9K prompt) | 2.92 → 2.92 GB        | 100%      | 18 native successes + 2 abstentions (old scoring) | 10/10, all cited |
| coder  | qwen2.5-coder:14b | 16K | **15.0** ⚠   | 293 ms      | 729           | 9.7 s               | 11.56 → 9.77 GB       | **84%** ⚠ | 0 structured, 17 recovered from text, 3 wrong     | 10/10, all cited |

| Embed model          | Dims | Recall@1 / @3 (10 notes) | VRAM @ ctx       |
| -------------------- | ---- | ------------------------ | ---------------- |
| qwen3-embedding:0.6b | 1024 | 1.0 / 1.0                | 2.66 GB @ 8K ctx |

**Co-residency** (`/api/ps`):

| Loaded together                 | Total VRAM | All 100% GPU                                 | `nvidia-smi` used |
| ------------------------------- | ---------- | -------------------------------------------- | ----------------- |
| chat 16K + embed 8K             | 8.35 GB    | ✅                                           | 11066 / 12288 MiB |
| chat 16K + embed 8K + router 4K | 11.27 GB   | ✅ (very tight)                              | 11992 / 12288 MiB |
| coder 16K + embed 8K            | —          | ❌ coder was evicted; it can't share the GPU | —                 |

**Baseline findings**

1. **Coder at 16K context doesn't fit.** It runs 84% on the GPU at 15 tok/s, below the expected 20–24. It also can't share the GPU with the embed model.
2. **The coder model doesn't make proper tool calls.** `qwen2.5-coder:14b` never returned a structured tool call; 17 of 20 only worked after recovering them from its text output. It also called tools when none were needed, including generating an unprompted WhatsApp tool call (the harness executed no tools). That makes it a poor fit for an agent role.
3. **Embed uses 2.66 GB at 8K context.** Chunks are ≤ 800 tokens, so 2K context should be enough and should free memory. Throughput looked low (4 docs/s); to recheck with the tuned settings.
4. **The brain-question set is too easy.** Every model scored 10/10, so it can't rank them. A real eval over the vault comes in Phase 2.

### Tuned — `infra/ollama/override.conf` applied

Run 2026-10-12 23:26–23:37, `--label tuned` → `docs/bench/results-tuned.json`. Settings: flash attention on, KV q8_0, max loaded 2, parallel 1, keep-alive 30m. Idle VRAM used by Windows: 1040 MiB (it varies from 0.8 to 1.6 GB).
Scoring is **harness v2 (strict tools)**: exactly one call, arguments valid against the tool's JSON schema, abstentions counted separately. RAG scoring in this run is the older lenient version; harness v3 (Codex) tightens it (exact `[path]` citation, exact "I don't know.") and the text-call parser. The first tuned run, with loose scoring, is kept as `results-tuned-v1-loose-scoring.json`; its speed numbers agree within ~5%.

18 of the 20 tool cases expect one call; 2 expect no call.

| Role / candidate | Model             | ctx | Decode tok/s | TTFT (warm) | Prefill tok/s | TTFT @ ~7K prompt   | VRAM                           | GPU         | Native calls (18) | Recovered from text | Abstained (2) | Wrong | Tool median latency | Brain Q       |
| ---------------- | ----------------- | --- | ------------ | ----------- | ------------- | ------------------- | ------------------------------ | ----------- | ----------------- | ------------------- | ------------- | ----- | ------------------- | ------------- |
| chat             | qwen3.5:9b        | 16K | **48.5**     | 323 ms      | 1601          | 4.7 s               | 5.46 GB                        | 100%        | **18**            | 0                   | 2/2           | 0     | 1.7 s               | 9/9 + 1/1 IDK |
| chat + thinking  | qwen3.5:9b        | 16K | —            | —           | —             | —                   | (same)                         | 100%        | **18**            | 0                   | 2/2           | 0     | 3.4 s               | 9/9 + 1/1     |
| router           | qwen3.5:4b        | 4K  | **74.7**     | 309 ms      | 2369          | 1.0 s (1.9K prompt) | 2.86 GB                        | 100%        | **18**            | 0                   | 2/2           | 0     | 1.0 s               | 9/9 + 1/1     |
| coder            | qwen2.5-coder:14b | 16K | **32.5**     | 208 ms      | 923           | 8.2 s               | 9.68 GB                        | **100%** ✅ | **0** ⚠           | 17                  | **0/2** ⚠     | 3     | 1.3 s               | 9/9 + 1/1     |
| chat fallback    | qwen3:8b          | 16K | **54.6**     | 172 ms      | 1774          | 4.0 s               | 5.95 GB                        | 100%        | **18**            | 0                   | 2/2           | 0     | 0.7 s               | 9/9 + 1/1     |
| chat fallback    | gemma4:12b        | 16K | **47.7**     | 426 ms      | 1099          | 6.9 s               | **8.6 GB** (nvidia-smi delta)¹ | 100%        | **18**            | 0                   | 2/2           | 0     | 1.4 s               | 9/9 + 1/1     |

Coder failures: `finance_query` without the required `month` (schema), `brain_search` for "17 × 23" (no tool needed), and an **unprompted `notify_me` tool call** (no message was sent) for "Say good morning in Japanese".

¹ `/api/ps` reports only 0.97 GB for `gemma4:12b`, but `nvidia-smi` shows an 8856 MiB increase when it loads. **`/api/ps` under-reports this model**, so the §4 rule "trust only `/api/ps`" doesn't hold for gemma4. The health dashboard should cross-check with `nvidia-smi`.

| Embed model               | Dims | Recall@1 / @3 (10 notes) | Warm throughput (40-doc batch) | VRAM    |
| ------------------------- | ---- | ------------------------ | ------------------------------ | ------- |
| qwen3-embedding:0.6b @ 8K | 1024 | 1.0 / 1.0                | 52 docs/s                      | 2.25 GB |
| qwen3-embedding:0.6b @ 2K | 1024 | —                        | ~50 docs/s (manual probe)      | 1.88 GB |
| nomic-embed-text @ 2K     | 768  | 1.0 / 1.0                | 169 docs/s                     | 0.30 GB |

**Co-residency** (strict check: present + requested ctx + 100% GPU):

| Kind      | Loaded together                 | Result                                             | Total VRAM (`/api/ps`) | `nvidia-smi` used |
| --------- | ------------------------------- | -------------------------------------------------- | ---------------------- | ----------------- |
| residency | chat 16K + embed 8K             | ✅ pass                                            | 7.71 GB                | 10096 / 12288 MiB |
| residency | coder 16K + embed 8K            | ✅ pass, ~330 MiB headroom                         | 11.93 GB               | 11959 / 12288 MiB |
| eviction  | chat 16K + embed 8K + router 4K | chat evicted (expected with `MAX_LOADED_MODELS=2`) | 5.11 GB                | 7219 MiB          |

### Baseline → tuned

|                        | Baseline                      | Tuned                                  | Change                    |
| ---------------------- | ----------------------------- | -------------------------------------- | ------------------------- |
| chat decode            | 50.8 tok/s, 5.69 GB           | 48.5–49.9 tok/s, 5.46 GB               | Same speed, −0.23 GB      |
| router decode          | 77.5 tok/s, 2.92 GB           | 74.7–78.2 tok/s, 2.86 GB               | Same                      |
| coder decode           | 15.0 tok/s, 84% GPU, 11.56 GB | **32.5–33.1 tok/s, 100% GPU, 9.68 GB** | **2.2× faster, now fits** |
| coder TTFT @ 7K prompt | 9.7 s                         | 7.5 s                                  | −23%                      |
| embed VRAM @ 8K        | 2.66 GB                       | 2.25 GB                                | −0.41 GB                  |
| chat + embed           | 8.35 GB                       | 7.71 GB                                | −0.64 GB                  |

The q8_0 KV cache plus flash attention are what make the 14B coder fit. **Keep the override.**

All results are close to or above the §4 ballpark (7–9B: 30–50 tok/s; 14B Q4: 20–24 tok/s). The 14B is faster than expected once it's fully on the GPU.

## Recommended model roles (pending owner confirmation)

| Role      | Recommendation                                                                                                                                                   | Why (numbers above)                                                                                                                                                                                                                                                                                                                                                                                           |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `chat`    | **qwen3.5:9b**, thinking off by default                                                                                                                          | ~49 tok/s, 100% GPU, 18/18 native schema-valid tool calls + 2/2 correct abstentions (strict scoring), ~325 ms TTFT. Thinking doubles tool latency (1.7 → 3.4 s) with no accuracy gain on this set; enable it per request.                                                                                                                                                                                     |
| `router`  | **qwen3.5:9b, thinking off** (same model as chat) instead of `qwen3.5:4b`                                                                                        | With `MAX_LOADED_MODELS=2`, loading the 4B evicts chat or embed (shown above). Sharing the chat model can avoid swaps when the roles use compatible resident contexts; different num_ctx settings require switching measurements. The 4B's extra speed (75 vs 49 tok/s; both 18/18 native calls) matters little for routing outputs of ~20 tokens. Keep `qwen3.5:4b` as an option for bulk background triage. |
| `coder`   | **qwen3.5:9b** for the Coder _agent_ (tool loop); keep `qwen2.5-coder:14b` as an optional `coder_gen` role for long code-generation and diff tasks with no tools | Under strict scoring qwen2.5-coder made **0/18** native tool calls (17 only recoverable from text), abstained 0/2, and generated an unprompted `notify_me` call (no message was sent). That's unsafe as an agent driver. Decide finally in Phase 7 with a code-specific eval.                                                                                                                                 |
| `embed`   | **qwen3-embedding:0.6b, `num_ctx` 2048**                                                                                                                         | 1024 dims as specified, perfect recall on the fixture, ~50 docs/s, 1.88 GB at 2K. Codex's REVIEW asks for a long-chunk test at 2K before this is final. Chunks are ≤ 800 tokens, so 2K context is enough.                                                                                                                                                                                                     |
| `vision`  | qwen3.5:9b (shared)                                                                                                                                              | No extra VRAM.                                                                                                                                                                                                                                                                                                                                                                                                |
| `deep`    | Keep disabled                                                                                                                                                    | WSL has 15 GiB; only revisit after the `.wslconfig` raise.                                                                                                                                                                                                                                                                                                                                                    |
| Fallbacks | `qwen3:8b` (best fallback: 55–57 tok/s, fastest TTFT, 18/18 native calls), `gemma4:12b` (works, but uses 8.6 GB and `/api/ps` misreports it), `nomic-embed-text` | —                                                                                                                                                                                                                                                                                                                                                                                                             |

With these choices, the steady state is **chat + embed ≈ 7.3 GB on the GPU at all times, with compatible shared-role contexts** for interactive use; verify reload behavior before claiming zero swaps. That leaves ~3 GB headroom.

## Plan changes suggested by the measurements

1. **Router and coder share the chat model** (see above). With compatible resident contexts, this can remove model swaps from the hot path, and `LlmGate`'s swap serialization becomes a rare path (only `coder_gen`).
2. **Embed `num_ctx` 2048**, not 8K.
3. **Don't rely solely on `/api/ps` for VRAM.** Health checks should also read `nvidia-smi` (gemma4 under-reports by ~7.6 GB).
4. **Windows desktop VRAM varies (0.8–1.6 GB).** Budget against `nvidia-smi` free memory, not a fixed 10.5 GB.
5. **The Phase 0 brain fixture is too easy** (every model scored 10/10). Model choice for RAG quality needs the Phase 2 vault eval.
6. **Node 24 LTS** instead of 22 (already installed; native TS stripping runs the scripts).

Benchmark integrity note (2026-10-12): historical tables use older scoring. Harness v3 requires schema-valid calls, explicit whole-response text repair, exact bracketed paths, and exact refusal text. Re-run under a fresh label when the existing v2 run finishes; do not relabel old metrics as v3 evidence.
