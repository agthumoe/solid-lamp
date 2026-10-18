# Brain (Phase 2)

Issue: [#84](https://github.com/agthumoe/solid-lamp/issues/84) (plan), epic [#4](https://github.com/agthumoe/solid-lamp/issues/4). Status: **draft for owner review; no implementation yet.** Builds on: [brain schema](brain-schema.md) (#73), [ADR 0002](../adr/0002-embedding-versions.md), [embedding storage](embedding-storage.md), [inference RPC](inference-rpc.md), [security/recovery](security-recovery.md), BUILD_PROMPT §7–8, [domain-agent plan](domain-agent-plan.md) (grounded books, citations).

## Goal

Agents and the owner can ask a question and get an answer grounded in the owner's notes, with citations to note path + heading. If nothing relevant clears a threshold, the brain says it doesn't know. The Obsidian vault stays the source of truth and is never written.

Phase acceptance (BUILD_PROMPT §16): the full vault is ingested; an edit becomes searchable in under 5 s; `brain:query` returns cited results; the eval set reaches recall@5 ≥ 0.8. Security/recovery gate before real-vault ingest: a synthetic backup → isolated restore → verify passes, and source-path boundary tests pass.

## Scope

**In Phase 2**

- Obsidian vault ingestion: full resync and a file watcher; frontmatter, `[[wikilinks]]` (alias, heading and block forms), `#tags`, embeds; renames, deletes and moves.
- Heading-aware chunking (target 500–800 tokens, small overlap, `heading_path`), incremental by content hash.
- Embeddings through the inference gate into a _building_ embedding version, then catch-up, coverage check and atomic promotion (ADR 0002).
- `search_brain`: vector + full-text search merged by reciprocal rank fusion, pinned to one version, filtered by source/tags/path prefix, returning citations.
- Link extraction into `links` (graph view input).
- CLIs: `pnpm run brain:ingest [--source]`, `brain:query "…"`, `brain:stats`.
- `brain` MCP server (read tools only) with access checks.
- Backup and isolated-restore smoke test; retention and recovery runbook.
- Evals: synthetic fixtures in CI; a real-vault eval set run locally.
- The long-chunk embedding context comparison (8K vs 2K) before any `num_ctx` change.

**Not in Phase 2**

- Code-repo ingestion (tree-sitter symbols): proposed as a Phase 2 follow-up after the vault is accepted (decision D3).
- Books (EPUB/PDF) and dated official sources: only the spec and parser fixtures here; ingestion follows once fixtures pass (domain-agent plan).
- Email, finance CSV (Phase 7); agents/supervisor (Phase 3); dashboard (Phase 4); writing to `AI-Inbox/` (needs the Phase 3 approval queue).
- Remote access over Tailscale (Phase 3 auth, Phase 4).

## Topology

Per [ARCHITECTURE §5.3](../ARCHITECTURE.md) and ADR 0005, no new process types:

```text
vault (read-only) ─► worker: watcher + resync ─► events row ─► BullMQ ingest.document
                         │                                    │
                         │                    parse → chunk → upsert docs/chunks/links (Postgres)
                         │                                    │
                         │                    embed.batch ─► inference RPC (background priority) ─► Ollama
                         ▼                                    ▼
                  brain:stats/ingest CLIs        chunk_embeddings_<dim> (building version) → promotion
api:  GET /api/v1/brain/search ─► search_brain(pinned version) ─► chunks + citations
mcp:  brain server (stdio) ─► api brain routes (service key)      CLI brain:query ─► same use case
```

- **`packages/brain`**: pure parsing/chunking/link extraction, ingestion and search use cases with narrow ports (`DocumentStore`, `Embedder`, `SourceReader`, `Clock`). No framework imports in its domain code.
- **`apps/worker`** (new process, health on `127.0.0.1:4400`): the file watcher, BullMQ consumers (`ingest.document`, `ingest.resync`, `embed.batch`, `embedding.promote`) and backups. It reaches the GPU only through the inference RPC, at background priority.
- **`apps/api`**: brain search and stats routes. **`apps/mcp`** (new, stdio first): a brain MCP server calling the api.
- **Redis is disposable.** The `events` table and document hashes in Postgres are the durable record; a lost queue is rebuilt by resync.

## Ingestion rules

1. **Source boundary.** The vault root comes from validated config (`config/sources.yaml`, a private path, no secrets). Every path is resolved with `realpath` and must stay under the root. Symlinks that escape, `..` traversal, device files and paths over a length limit are skipped and counted. `.obsidian/`, `.trash/`, `AI-Inbox/` (until Phase 3) and configured globs are excluded. The reader opens files read-only.
2. **Change detection.** Each file is hashed (SHA-256 of normalized content). An unchanged hash is skipped. A rename is detected as the same hash under a new path within one resync or watcher batch, which moves the document instead of re-embedding it. A delete sets `documents.deleted_at`; search excludes tombstoned documents immediately.
3. **Parsing.** YAML frontmatter is parsed with a strict size limit; invalid frontmatter is recorded, never fatal. Wikilinks keep their target label (`links.to_title` is required, #74) and resolve to a document when one matches, by path, then filename, then alias. Embeds become links of kind `import`.
4. **Chunking.** Split by heading hierarchy, then by paragraph within a section that exceeds the target. Keep `heading_path`, an ordinal and a source line range for citations. Token counts are an estimate calibrated against the embed model's real counts (`prompt_eval_count`); the hard limit stays safely under the embed `num_ctx`, and `truncate: false` turns any overflow into an error, never a silently shortened vector. `chunker_version` changes trigger a rebuild.
5. **Untrusted content.** Note text is data. It is stored and returned with delimiters and never interpreted as instructions by any brain code (AGENTS hard constraint 5).
6. **Jobs.** Payloads carry IDs and hashes only, never note text. Job IDs are deterministic (the `job-id.ts` template). Handlers are idempotent; retries use bounded backoff.

## Embedding lifecycle (ADR 0002)

- First run: create version 1 (`building`) from the embed role snapshot (model, digest from the catalog, dimensions, prefixes, chunker version). Embed all eligible chunks in bounded batches (`embedInBatches`, background priority, so interactive work interleaves). Mark it `ready` after a coverage check, then promote it in one transaction (the deferred `search_config` FK makes a half-promotion impossible).
- Steady state: new and changed chunks are embedded into the active version, and stale vectors (hash mismatch) are excluded from search.
- Model, digest or chunker change: build a new version in the background, catch up on edits made during the build, check coverage and run evals, then promote atomically. Searches already running keep their pinned version. The old version is retained for rollback.
- **Embed residency.** The < 5 s target fails on a cold embed load (about 18 s was measured). The plan measures warm/cold incremental latency and, if needed, keeps the embed model resident through the inference process. The chat/embed pair is the normal residency (LlmGate spec); this is not a host config change.

## Search contract

`search_brain(query_embedding, query_text, filters, k)`, a SQL function in a migration:

- **Vector branch:** cosine similarity over the pinned version's table, only for live documents with a matching `content_hash`.
- **Lexical branch:** `tsv @@ websearch_to_tsquery('english', …)` ranked with `ts_rank_cd`.
- **Merge:** reciprocal rank fusion (k = 60), filters on source, tags (any/all) and path prefix, bounded `k` (default 8, max 50).
- **Output:** chunk ID, document path, title, `heading_path`, line range, snippet, fused score, both branch ranks, and the pinned version.
- **Threshold:** a relevance threshold calibrated on the eval set decides "don't know". If the embed model is unavailable, search fails clearly unless the caller explicitly asks for lexical-only results (degraded, labelled).
- **Citation format:** `vault:<relative path>#<heading path>` plus the line range.

`GET /api/v1/brain/search` and `GET /api/v1/brain/stats` use zod contracts in `@aetherion/shared/contracts`. The query is embedded at interactive priority with the active version's query prefix.

## MCP and access (Phase 2 gate)

- The brain MCP server starts as **stdio only** (trusted local process boundary, per the security spec). Tools: `brain_search`, `brain_get_note` (a bounded excerpt by citation) and `brain_stats`. All are read-only and return data, not instructions.
- It calls the api with a **service key** (`x-aetherion-service-key`, constant-time compare, as for inference). Owner session auth arrives in Phase 3; until then the api stays loopback-only. A streamable-HTTP MCP endpoint is not built in Phase 2.
- Tests: unauthenticated rejection, path traversal and symlink escape in `brain_get_note`, a bounded excerpt size, and injected instructions inside note text returned as data.

## Schema additions (new migrations; #73 is not edited)

- `source_sync_state`: per-source last resync time, counters, and last error code.
- `ingest_events`: type, source, path hash, status, and processed time. This is the durable record behind queue jobs (ARCHITECTURE's `events`, scoped to ingestion for now).
- `chunks`: a `line_start`/`line_end` citation locator.
- `embedding_builds`: version, totals, progress cursor and timestamps, so a rebuild resumes after a restart.
- The `search_brain` function, plus indexes for path-prefix filters.

Every migration follows the existing workflow: replay and parity in CI, local replay on Supabase Postgres, and lock/volume notes.

## Recovery gate (must pass before the real vault)

`pnpm run db:backup` takes a `pg_dump` of the primary database into a git-ignored `backups/` folder with timestamped rotation. Secrets stay out of the dump. `pnpm run db:restore-verify <dump>` restores into a new isolated database (never the primary) and checks:

- counts for documents, chunks, links and embeddings;
- the active version and that `search_config` is consistent;
- that a known synthetic query returns the same cited chunk IDs.

A runbook in `docs/` covers the retention window and recovery steps. Automated scheduling and rotation stay in Phase 8.

## Evaluation

- **CI (synthetic):** an `evals/brain/` fixture vault of about 40 notes, covering headings, aliases, links, embeds, frontmatter edge cases, renames, deletes and adversarial "ignore previous instructions" text. Questions come with expected citations. A fake embedder keeps it deterministic; scoring, citation correctness and abstention are checked.
- **Local (real vault, owner-approved):** 40–60 questions with expected note/heading answers plus 15 unanswerable ones. Metrics: recall@5 (target ≥ 0.8), MRR, citation accuracy, abstention accuracy, and p50/p95 latency. Private questions stay in a git-ignored local file; only aggregate scores are committed.
- The long-chunk comparison (8K vs 2K embed context) runs on the synthetic set plus long real notes before any `num_ctx` change.

## Risks

| Risk                                                                | Mitigation                                                                                    |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Cold embed load breaks the < 5 s target                             | Measure; keep embed resident through the gate; report warm vs cold                            |
| HNSW with a version filter loses recall when several versions exist | Measure; per-version partial index or iterative scan (brain-schema open question)             |
| WSL file watching on `/mnt/c` is slow or unreliable                 | Prefer a vault on the Linux filesystem; otherwise polling mode, with resync as the safety net |
| Token estimate drift causes embed overflow                          | Calibrate against real counts; `truncate: false` fails loudly; regression fixtures            |
| Private note content leaks into logs, CI or issues                  | Payloads carry IDs/hashes; log allowlist; real-vault evals local and git-ignored              |

## Decisions for the owner

| #   | Question                                                                                 | Default if no answer                                                              |
| --- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| D1  | Vault location: WSL path, and is it on the Linux filesystem or `/mnt/c`?                 | Ask before real-vault ingest; build on the synthetic fixture vault meanwhile      |
| D2  | Approval to ingest the real vault once the recovery gate passes                          | Not ingested until you say yes                                                    |
| D3  | Code repos in Phase 2 (after the vault) or later?                                        | Separate Phase 2 follow-up issue, after vault acceptance                          |
| D4  | Real-vault eval questions: you write them, or a local model drafts them for your review? | Local model drafts, you review and approve                                        |
| D5  | Folders to exclude (journals, private, attachments)                                      | `.obsidian/`, `.trash/`, `AI-Inbox/`, and binary attachments indexed by name only |

## Task breakdown (ordered; each becomes an issue after this plan is approved)

1. **Recovery gate:** `db:backup`, `db:restore-verify`, runbook, and a synthetic restore test in CI (pgvector service).
2. **Sources config and path boundary:** `config/sources.yaml`, realpath reader, exclusion globs, traversal/symlink tests.
3. **`packages/brain` parsing:** frontmatter, wikilinks/aliases/headings/blocks, tags, embeds, link resolution; fixture vault.
4. **Chunker:** heading-aware with paragraph fallback, overlap, line ranges, token calibration, `chunker_version`.
5. **Schema migration:** sync state, ingest events, chunk line ranges, embedding builds.
6. **`apps/worker` skeleton:** BullMQ (pins from ADR 0005), health endpoint, safe logs, SIGTERM drain; `ingest.document` and `ingest.resync`.
7. **Watcher:** debounced events, renames/deletes/moves, and the incremental-latency measurement.
8. **Embedding lifecycle:** build, catch-up, coverage, promotion, rollback; residency measurement.
9. **`search_brain` + api routes:** RRF, filters, threshold, citations, lexical-only degraded mode.
10. **CLIs:** `brain:ingest`, `brain:query`, `brain:stats` (Makefile mirror; `pnpm run` names checked against pnpm built-ins).
11. **Brain MCP server (stdio)** with service-key access and security tests.
12. **Evals:** synthetic CI suite; real-vault local run; long-chunk embed comparison.
13. **Real-vault ingest and phase acceptance** (after D1/D2).

Steps 1–5 need no owner input and no real data. Step 13 is the only one that touches the real vault.
