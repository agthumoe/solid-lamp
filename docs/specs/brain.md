# Brain (Phase 2)

Issue: [#84](https://github.com/agthumoe/solid-lamp/issues/84) (plan), epic [#4](https://github.com/agthumoe/solid-lamp/issues/4). Status: **draft for owner review; no implementation yet.** Builds on: [brain schema](brain-schema.md) (#73), [ADR 0002](../adr/0002-embedding-versions.md), [embedding storage](embedding-storage.md), [inference RPC](inference-rpc.md), [security/recovery](security-recovery.md), BUILD_PROMPT §7–8, [domain-agent plan](domain-agent-plan.md) (grounded books, citations).

Review revision: Codex reviewed PR [#85](https://github.com/agthumoe/solid-lamp/pull/85) at `0ed2f69` on 2026-10-18. [Review findings and required tests](../reviews/phase2-plan-pr85.md) explain the changes below. [Proposed ADR 0006](../adr/0006-brain-version-bound-retrieval.md) records the new version contracts for review. These edits are proposals, not owner approval or evidence that a gate has passed.

## Goal

Agents and the owner can ask a question and get an answer grounded in the owner's notes, with citations to note path + heading. If nothing relevant clears a threshold, the brain says it doesn't know. The Obsidian vault stays the source of truth and is never written.

The Phase 2 product is retrieval: bounded cited excerpts or a structured `no_match` result that the CLI displays as "I don't know". Generating a synthesized answer from those excerpts belongs to Phase 3. Empty indexes, unavailable embeddings and incomplete indexing are explicit states, not evidence that the vault has no answer.

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
- **Redis is disposable.** The `ingest_events` table and document hashes in Postgres are the durable record; a lost queue is rebuilt by replaying pending events and resync. A transaction persists each document revision and its required work before queue dispatch. A dispatcher retries pending events on startup and periodically; queue insertion and processing may repeat without duplicate effects. A path hash alone cannot locate work: each event references a durable source-relative path/document record, kept out of logs and queue payloads.

## Ingestion rules

1. **Source boundary.** Tracked `config/sources.yaml` contains source IDs, exclusions and environment-variable references; the owner's absolute vault path lives in git-ignored local configuration. Only the explicitly approved source root may be scanned. Paths are checked by path components, not a string prefix; reject traversal, symlinks in any component, device files and excluded directories before reading. The implementation must prevent path replacement between validation and opening: use a verified root-relative open strategy, or fail closed where the platform cannot guarantee it. A `realpath()` check followed by an unchecked ordinary open is insufficient. Test ancestor/root replacement and symlink swaps, including `/mnt/c`; unsupported containment guarantees block that source. Open only regular files read-only, bound file size/read time, and never follow attachment links. Proposed note-size limit: 2 MiB, with skipped counts and reasons exposed for acceptance review. `.obsidian/`, `.trash/`, `AI-Inbox/` (until Phase 3) and configured globs are excluded.
2. **Change detection.** Keep a hash of exact source bytes plus a separate parsed/chunk identity; newline/frontmatter changes must still refresh line ranges, tags, aliases and links even when embedded text is unchanged. Each source event has a monotonic revision. Read/parse/embed outside transactions; publish only if the expected revision is still current, so a delayed edit job cannot overwrite a later delete or edit. Hash equality alone is not identity: preserve a rename only with unambiguous paired evidence; duplicate-content files stay separate, and ambiguous cases become delete/create with optional vector reuse. A delete sets `documents.deleted_at`; both search branches exclude it immediately. A resync tombstones missing files only after a successful complete scan of the approved root; a partial scan, permission error or offline mount never mass-deletes notes.
3. **Parsing.** YAML frontmatter is parsed with a strict size limit; invalid frontmatter is recorded, never fatal. Wikilinks keep their target label (`links.to_title` is required, #74) and resolve to a document when one matches, by path, then filename, then alias. Embeds become links of kind `import`.
4. **Chunking.** Split by heading hierarchy, then by paragraph within a section that exceeds the target. Keep `heading_path`, an ordinal and a source line range for citations. Token counts are an estimate calibrated against the embed model's real counts (`prompt_eval_count`); the hard limit stays safely under the embed `num_ctx`, and `truncate: false` turns any overflow into an error, never a silently shortened vector. `chunker_version` changes trigger a rebuild.
5. **Untrusted content.** Note text is data. It is stored and returned with delimiters and never interpreted as instructions by any brain code (AGENTS hard constraint 5).
6. **Jobs.** Payloads carry IDs and hashes only, never note text. Job IDs are deterministic (the `job-id.ts` template). Handlers are idempotent; retries use bounded backoff.

Binary attachments are represented only by an in-vault filename/link from an eligible note; Phase 2 does not open their contents, OCR them, or scan outside the approved root. Real-vault acceptance reports eligible, excluded, oversized, failed and indexed file counts separately; "full vault" means all eligible notes, with no unexplained failures.

## Embedding lifecycle (ADR 0002)

- First run: create a version (`building`) from a validated embedding profile (model, verified artifact digest, dimensions, prefixes and `num_ctx`) and chunker identity. Embed all eligible chunks in bounded batches admitted separately to the inference process at background priority. The existing local `embedInBatches` helper is not permission to create another GPU gate in the worker. Mark the version `ready` only after coverage and eval checks, then promote it in one transaction.
- **Version-bound RPC is prerequisite work.** Today's `/v1/embed` accepts only text/kind and snapshots the current embed role; it cannot serve a pinned older profile during a rebuild. Extend the authenticated internal contract to accept an opaque embedding-profile ID resolved from a trusted server-side allowlist. Callers never supply model tags or arbitrary prefixes. The inference process validates profiles against the catalog and installed artifact identity, snapshots the selected profile at enqueue, and returns the profile ID/digest/dimensions/prefix identity actually used. The worker and search use case compare it with their persisted version before storing/querying vectors, including same-dimension profile changes. Retain approved profiles for active/building versions and in-flight readers; an unavailable or changed artifact fails explicitly. Update the inference spec and ADR before implementing the extension.
- **Chunk sets are versioned too.** A new chunker builds separate immutable chunk rows grouped by document revision and chunker identity; it never deletes or rewrites active chunks to make room. Replace the current `(document_id, ordinal)` uniqueness with a chunk-set-aware key in a new migration. Each embedding version selects the matching chunk sets for vector and lexical search. A failed rechunk/rebuild leaves the old sets and citations usable. Current document revision/hash and tombstone checks still exclude genuinely stale/deleted source content.
- Steady state: process each changed document revision once per active/building target. Late results use compare-and-set revision checks; stale vectors never become eligible. Revision metadata, chunk-set selection and link updates publish atomically; partial embedding batches remain explicitly incomplete.
- Model, digest, prefix, `num_ctx` or chunker change: build a new version, reconcile edits/deletes and run coverage/evals. Promotion serializes against ingestion publication or validates a durable ingestion watermark in the same transaction; a deferred FK alone does not prove coverage. Recheck complete coverage at that watermark before switching. In-flight queries retain their pinned profile/chunk-set mapping until completion (bounded reader lease/deadline); cleanup waits for readers and retention. Rollback rechecks current content coverage and eval eligibility instead of selecting an arbitrarily old index.
- **Approval boundary.** Automatic first-index promotion and ingestion require an explicit approved ingestion policy. Later model/index switches use the approval contract in `embedding-storage.md`; until the Phase 3 queue exists, permit only a concrete owner-approved local administrative action, with an audit record. No read route or MCP tool promotes, rolls back or changes a profile.

### Incremental latency contract

The < 5 s target is end-to-end from a completed stable file write to visibility of that revision in hybrid search on the active version. It includes polling/debounce, queue wait, cold load, embedding, database publication and search visibility. Measure with an external write timestamp, not from when the watcher happens to notice the change. Collect p50/p95/max and failure counts for single edits, bursts, `/mnt/c` polling if used, restart/resync, cold embeddings and concurrent interactive generation; record workload, note sizes and hardware state.

Keeping embeddings resident may remove the measured ~18 s cold load, but does not remove waiting behind a non-preemptible chat job. Bound background batch work and measure real chat/embed residency and queue delays through the existing gate; never add a second scheduler or silently preempt chat. An idle/warm-only result does not prove the unconditional target. If the required workload misses 5 s, report Phase 2 latency acceptance as unmet and propose a measured scope/architecture tradeoff for explicit owner approval. Do not silently relax it to a percentile or omit cold/busy samples.

## Search contract

`search_brain(pinned_version_id, query_embedding, query_text, filters, result_limit)`, a parameterized SQL function in a migration. The use case pins the active version before query embedding and retains it through retrieval; SQL never re-reads the current active pointer to choose another version:

- **Vector branch:** cosine similarity over the pinned version's table, only for live documents with a matching `content_hash`.
- **Lexical branch:** `tsv @@ websearch_to_tsquery('english', …)` ranked with `ts_rank_cd`, using the same pinned chunk sets, live-document/revision eligibility and filters as the vector branch.
- **Merge:** reciprocal rank fusion (`rrf_constant = 60`), filters on source, tags (any/all) and a component-aware path prefix, bounded `result_limit` (default 8, max 50). Apply filters before each branch's bounded candidate selection. Deduplicate chunk IDs with deterministic tie-breaking; expose cosine similarity and lexical evidence alongside ranks. Candidate limits and any HNSW iterative scans/partial indexes are measured with selective filters and several versions present.
- **Output:** chunk ID, document path, title, `heading_path`, line range, snippet, fused score, both branch ranks, and the pinned version.
- **Threshold:** rank fusion orders candidates; its rank-only score is not proof of relevance. Use versioned cosine/lexical evidence gates calibrated on a development set, freeze them before held-out evaluation, and test unrelated queries whose nearest vector still ranks first. A legitimate empty result is `no_match`; no active index is `not_indexed`, a partial corpus is labelled incomplete, and embedding failure is an explicit unavailable error unless lexical-only mode was requested (degraded, labelled).
- **Citation format:** display `vault:<relative path>#<heading path>` plus the line range; the structured citation also includes source ID, document ID, revision/content hash, chunk ID and pinned version. Escape path/heading delimiters and distinguish duplicate headings. Resolve excerpts against that identity and report stale citations after edits; never silently return a different revision.

`GET /api/v1/brain/search` and `GET /api/v1/brain/stats` use zod contracts in `@aetherion/shared/contracts`. The query is embedded at interactive priority with the active version's query prefix.

The phase also needs `GET /api/v1/brain/note` for bounded citation-based excerpts; the MCP server has no direct filesystem fallback. Bound query/filter sizes, candidate counts, excerpt bytes, rate/concurrency and overall deadlines. All three routes require the service key before reading or embedding. Raw queries, URLs/query strings, paths, snippets and headers are excluded from logs; responses use `Cache-Control: no-store`. The CLI calls the same protected API contract, so it cannot bypass authorization or relevance gates.

## MCP and access (Phase 2 gate)

- The brain MCP server starts as **stdio only** (trusted local process boundary, per the security spec). Tools: `brain_search`, `brain_get_note` (a bounded excerpt by citation) and `brain_stats`. All are read-only and return data, not instructions.
- It calls the api with a **dedicated service key** (`x-aetherion-service-key`, constant-time compare, separate from the inference secret), supplied from local environment only. Owner session auth arrives in Phase 3; until then the brain routes reject non-loopback binding and remain outside Tailscale serve. A streamable-HTTP MCP endpoint is not built in Phase 2. Reject browser origins in this service-only phase and expose no permissive CORS; authentication precedes all work.
- Tests: absent/invalid key and disallowed origin rejection with zero DB/file/model work; path traversal and symlink escape at ingestion; forged/stale/out-of-scope citations in `brain_get_note`; bounded excerpt size; stdout containing only MCP protocol output; injected instructions inside note text returned as delimited data, never selecting tools. Tool definitions declare `sideEffect: false`, risk, strict arguments and deadlines.

## Schema additions (new migrations; #73 is not edited)

- `source_sync_state`: per-source last resync time, counters, and last error code.
- `ingest_events`: type, source, path hash, status, and processed time. This is the durable record behind queue jobs (ARCHITECTURE's `events`, scoped to ingestion for now).
- `chunks`: a `line_start`/`line_end` citation locator.
- `embedding_builds`: version, totals, progress cursor and timestamps, so a rebuild resumes after a restart.
- Immutable document revisions/chunk sets and per-version document-to-chunk-set selection, with composite keys/FKs enforcing matching source revision and chunker. Preserve the Phase 1 rows through an explicit backfill; test an upgrade fixture as well as empty replay. A document revision includes metadata/citation identity even when vector content is reused.
- Ingestion sequence/watermark, expected document revision and retry/lease state for durable work; index pending events and foreign-key lookup columns. A worker crash after DB commit but before Redis dispatch must be recoverable.
- The `search_brain` function, plus indexes for path-prefix filters.

Every migration follows the existing workflow: replay and parity in CI, local replay on Supabase Postgres, and lock/volume notes.

New tables retain RLS and explicit grants; the retrieval function uses invoker privileges with qualified objects and a fixed safe search path. Revoke unintended public execution. Separate reader, ingestion-writer and maintenance privileges; runtime processes cannot restore/drop databases. Source roots, keys and database credentials do not belong in durable job payloads.

## Recovery gate (must pass before the real vault)

`pnpm run db:backup` takes a database-scoped `pg_dump` into a git-ignored `backups/` folder with timestamped names. No global role/password dump is included; no credentials are stored in application tables. Artifacts are private (owner-only permissions), checksummed, never logged or committed, and subject to a documented manual retention policy. After real ingestion they contain private note text. Encryption is required if a backup ever contains secrets. `pnpm run db:restore-verify <dump>` accepts only a trusted local dump, verifies its manifest/checksum and compatible Postgres/pgvector tooling, and creates a fresh isolated target with its own credentials. Refuse the primary database identity, pre-existing targets and public endpoints before restoring; cleanup can drop only the generated test target. The script checks:

- counts for documents, chunks, links and embeddings;
- the active version and that `search_config` is consistent;
- that a known synthetic query returns the same cited chunk IDs.

A runbook in `docs/` covers the retention window and recovery steps. Automated scheduling and rotation stay in Phase 8.

Build the gate in two passes: task 1 verifies the existing Phase 1 schema, vector/version invariants and deterministic SQL citation fixtures without depending on future `search_brain` code. After tasks 5 and 9, extend it to every new table and an end-to-end hybrid query. The complete gate must pass again on the final Phase 2 schema before any real-vault read. Baseline recovery success alone does not unlock real data.

## Evaluation

- **CI (synthetic):** an `evals/brain/` fixture vault of about 40 notes, covering headings, aliases, links, embeds, frontmatter edge cases, renames, deletes and adversarial "ignore previous instructions" text. Questions come with expected citations. A fake embedder keeps it deterministic; scoring, citation correctness and abstention are checked.
- **Local synthetic, real model:** run the same synthetic corpus through Ollama to measure retrieval quality, cold/warm latency and queue contention; fake embeddings validate mechanics, not semantic quality. Live runs are local, explicitly scheduled and serialized under the GPU coordination rules.
- **Local (real vault, owner-approved, task 13 only):** 40–60 answerable questions with expected note/heading answers plus 15 unanswerable ones. Split calibration and held-out questions before tuning. Recall@5 is measured over the held-out answerable questions: fraction for which the expected note/heading appears among the first five deduplicated results. Also report MRR, citation accuracy, abstention accuracy and latency; record the frozen profile/chunker/threshold identities. Abstaining on an answerable query counts as a miss. Model-drafted questions require owner review. Private questions and raw results stay in a git-ignored local file; only aggregate scores are committed.
- The long-chunk comparison (8K vs 2K embed context) runs on synthetic notes first, and on approved long real notes only in task 13, before any `num_ctx` change. Test a separate version/profile rather than changing the active index's query embedding space in place.

## Risks

| Risk                                                                | Mitigation                                                                                    |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Cold embed load or chat queue wait breaks the < 5 s target          | Measure complete write-to-search latency; residency alone cannot bound non-preemptible chat   |
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
2. **Sources config and path boundary:** `config/sources.yaml` with local root references, verified root-relative reader, exclusion globs, traversal/symlink-swap tests on supported filesystems.
3. **`packages/brain` parsing:** frontmatter, wikilinks/aliases/headings/blocks, tags, embeds, link resolution; fixture vault.
4. **Chunker:** heading-aware with paragraph fallback, overlap, line ranges, token calibration, `chunker_version`.
5. **Schema migration:** sync state, durable ingest events/revisions, immutable chunk sets, version selection, line ranges, embedding builds; upgrade/parity/RLS tests. Adopt ADR 0006 only after review.
6. **`apps/worker` skeleton:** BullMQ (pins from ADR 0005), health endpoint, safe logs, SIGTERM drain; `ingest.document` and `ingest.resync`.
7. **Watcher:** debounced events, renames/deletes/moves, and the incremental-latency measurement.
8. **Version-bound embedding RPC and lifecycle:** trusted profile registry, artifact identity, pinned-profile responses, build/catch-up, transactional watermark/coverage, promotion approval, rollback and reader retention; residency/queue measurement. Update the RPC spec alongside its implementation; retain one gate.
9. **`search_brain` + api routes:** pinned versions/chunk sets, RRF/evidence gates, filters, structured citations, excerpts/stats, lexical-only mode, service-key/origin protections on every brain route; complete the final-schema restore gate.
10. **CLIs:** `brain:ingest`, `brain:query`, `brain:stats` (Makefile mirror; `pnpm run` names checked against pnpm built-ins).
11. **Brain MCP server (stdio)** with service-key access and security tests.
12. **Synthetic evals and safety gate:** CI mechanics, local synthetic real-model retrieval, long-chunk comparison, cold/busy latency, revision/promotion races, Redis-loss/restart and final-schema backup/restore. Prepare a private-eval template without accessing the vault. Publish evidence and remaining misses for review.
13. **Real-vault ingest, local eval and phase acceptance:** only after D1/D2 and the completed task-12 gate; confirm D4/D5, run private evaluation and approved long-note tests, then verify full eligible coverage, latency and held-out recall. No phase close if a required target is unmet without an explicit owner-approved change.

All work remains blocked on plan approval; no implementation issues are opened by this revision. Once approved, steps 1–5 use synthetic data only. Step 13 is the first permitted real-vault read, including question drafting and real-note context experiments; D2 is not implied by approving the plan. Include the known relative template-literal import boundary regression/fix before adding new package imports. The book/official-source follow-up is a separate docs/fixture deliverable under this phase, not covered by the 13 vault tasks.
