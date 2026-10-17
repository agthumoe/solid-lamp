# Runtime config loader

Issue: [#56](https://github.com/agthumoe/solid-lamp/issues/56). Status: implemented. Parent: #3. Builds on the [shared foundation](shared-foundation.md).

## Goal

Validate `config/models.yaml` and `AETHERION_*` environment variables once, at process start, into typed values that `packages/llm` and the apps consume. Invalid config is a `Result` error, never a partially applied state.

## Contracts

- `parseModelsConfig(text)` / `loadModelsConfig(path)` return `Result<ModelsConfig, AppError>` (`VALIDATION_FAILED` or `NOT_FOUND`). Error messages list at most five issue paths and never include file contents.
- Strict schema: unknown keys fail. `chat`, `router`, `coder` and `embed` are required; `vision` and `deep` are optional (deep stays disabled until owner gates pass). `embed` requires `dimensions`; prefixes default to empty.
- `fallbacks` may only name bound roles. Every embedding fallback must have an explicit `fallback_embedding_options` entry because it changes dimensions (ADR 0002: rebuild/promotion only, never query-time failover).
- Ollama URLs must be loopback (`localhost`, `127.0.0.0/8`, `::1`) or Tailscale (`100.64.0.0/10`, `*.ts.net`) over http(s) — AGENTS hard constraint 3.
- `loadEnvConfig(env)` reads only `AETHERION_CONFIG_DIR` (default `config`), `AETHERION_LOG_LEVEL` (default `info`) and optional `AETHERION_OLLAMA_URL` (same private-URL rule). Empty strings mean unset. Errors name keys, never values. `.env.example` mirrors the keys.

## Non-goals

Hot reload, agent YAML, schedules and app-specific config extensions (each app's `config.ts` extends this later).

## Acceptance

Committed `config/models.yaml` parses; negative tests cover unknown keys, missing embed dimensions, public/wildcard URLs, unbound fallback roles, embedding fallbacks without options, invalid YAML and missing files. `pnpm check` passes.
