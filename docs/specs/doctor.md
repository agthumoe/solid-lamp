# `pnpm run doctor`

Issue: [#62](https://github.com/agthumoe/solid-lamp/issues/62). Status: implemented. Parent: #3. Contracts: [security/recovery](security-recovery.md) (doctor verifies the bind policy), [operations](../development/operations.md) (admin processes, debugging runbook step 2).

Run it as `pnpm run doctor` (or `make doctor`). pnpm 11 has a built-in `doctor` command that checks the pnpm installation and takes priority over the script ([#81](https://github.com/agthumoe/solid-lamp/issues/81)).

## Goal

One read-only command answers "is this machine ready to run Aetherion?". Each problem comes with a concrete fix hint. The exit code is 1 when any check fails.

## Non-goals

Fixing anything: no installs, host config edits, `supabase start`, model pulls, or loading models onto the GPU. GPU VRAM/`nvidia-smi` cross-checks and backup checks come later. Owner-only host actions stay manual (AGENTS: don't install system packages or edit host config without asking).

## Checks (in order)

| Check                   | ok                                                                                                     | Problem                                             |
| ----------------------- | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------- |
| node                    | major 24                                                                                               | fail: other major                                   |
| pnpm                    | matches `packageManager`                                                                               | warn: version drift; fail: not found                |
| env                     | shared `AETHERION_*` values valid                                                                      | fail (key names only)                               |
| inference secret        | 32+ characters                                                                                         | warn: unset or short (needed by api and inference)  |
| models.yaml             | parses with the runtime schema                                                                         | fail: missing or invalid                            |
| ollama                  | `/api/tags` answers                                                                                    | fail (hint: `systemctl status ollama`)              |
| role `<name>`           | bound model installed                                                                                  | fail (hint: `ollama pull <model>`)                  |
| embed dimensions        | `/api/show` `*.embedding_length` equals config                                                         | fail (a change needs a versioned rebuild, ADR 0002) |
| docker                  | engine answers                                                                                         | fail (hint: start Docker Desktop)                   |
| postgres / redis        | `127.0.0.1:54322` / `6379` accept TCP                                                                  | fail with start hint                                |
| inference / api process | `/livez` / `/api/v1/health` live                                                                       | warn: dev processes are optional                    |
| bindings                | no known port (ARCHITECTURE §2 + backing) on a wildcard, LAN or other non-private address (`ss -ltnH`) | fail; warn if `ss` is unavailable                   |
| .env tracked            | `.env` not in git                                                                                      | fail (hint: untrack and rotate)                     |

Checks are pure functions over injected probes (`readText`, `getJson`, `postJson`, `command`, `tcp`), each bounded by a 3 s timeout. `doctor.ts` supplies the real ones. The report prints values such as versions and model tags, never secrets or URLs with credentials. The embed dimension check reads model metadata only.

## Acceptance

Unit tests cover:

- A healthy host.
- Node and pnpm drift.
- Invalid env, invalid or missing `models.yaml`, and an unset secret (warning).
- Ollama down, a missing role model with its pull hint, and an embed dimension mismatch.
- Docker, Postgres and Redis down, with hints.
- App processes reported as warnings.
- Listener parsing (IPv4, IPv6, wildcard, scoped).
- Wildcard/LAN binds failing while unrelated ports are ignored, and `ss` unavailable.
- A tracked `.env`.
- Report formatting.

A local run on 2026-10-18 (Docker stopped) reported 13 ok, 3 warnings (secret, inference, api) and 3 failures (docker, postgres, redis), with exit code 1. `pnpm check` passes.
