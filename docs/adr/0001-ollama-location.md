# ADR 0001 — Run Ollama inside WSL

- **Status:** Accepted (Phase 0, 2026-10-12)
- **Context:** §13 allows Ollama either inside WSL (CUDA through the Windows driver) or Windows-native, reached from WSL. §17's default is inside WSL unless a benchmark favours Windows.

## Decision

Run Ollama **inside WSL** as the existing `ollama` systemd service, bound to `127.0.0.1:11434`, configured by `infra/ollama/override.conf`.

## Evidence

- Ollama 0.32.4 is already installed and enabled in WSL. It uses CUDA (`cuda_v13`, compute 8.6) through the Windows 591.86 driver.
- Tuned benchmarks (`docs/HARDWARE.md`) meet or beat the §4 ballpark: 9B at 50 tok/s, 4B at 78 tok/s, 14B Q4 at 33 tok/s. All are 100% on the GPU.
- No Windows-native Ollama is installed. Installing one just to compare is a system-level install, and there's no performance gap to close.

## Consequences

- **Good:** one OS for every service; managed by systemd alongside the Node apps; `localhost` access with no Windows↔WSL networking; settings live in the repo.
- **Bad:** Ollama only runs while the WSL VM is up. That needs the keep-alive setup in §13 (`.wslconfig` `vmIdleTimeout=-1` + a Task Scheduler start task, Phase 8).
- **Revisit if:** a later Ollama or driver update regresses WSL GPU performance, or WSL stability is a problem for an always-on server.
