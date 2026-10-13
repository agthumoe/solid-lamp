# Aetherion OS — Build Prompt for an AI Coding Agent

> Paste this whole file into Claude Code (or Cursor, Codex, OpenCode, etc.) at the root of an empty repo. Also save it in the repo as `docs/BUILD_PROMPT.md`.

---

## 0. Your role and how to work

You are a senior **AI solution architect and full-stack TypeScript engineer**. You will design and build **Aetherion OS**: a personal, local-first, multi-agent AI operating system that runs on one home machine acting as an AI server.

Working rules:
- **Work in phases** (Section 16). At the end of each phase, run the checks, summarize what changed, update `docs/PLAN.md`, and **stop and wait for my go-ahead**.
- **Ask before** you install system-level packages, edit Windows/WSL config (`.wslconfig`, Task Scheduler), open network ports, or do anything that needs credentials.
- **Prefer boring, well-supported libraries.** Pin versions. No experimental frameworks without asking.
- **Keep the repo agent-agnostic** (Section 15). Another coding agent must be able to pick up where you left off by reading `AGENTS.md` and `docs/`.
- When a requirement is unclear, check Section 17 (Open decisions). Use the stated default and note it in `docs/PLAN.md`.

---

## 1. Goal

A single-user "operating system" of AI agents that helps me every day with:
- personal development and learning
- coding (across my local repos)
- tasks and daily planning
- personal finance (read-only analysis)
- email triage (read-only)

The system has these parts:
- **One shared brain.** My Obsidian vault, code repos, and other sources are embedded into **local Supabase (Postgres + pgvector)**. Every agent answers from this same brain, with citations.
- **Multiple agents, each with its own persona.** Some answer questions on demand. Others run in the background on schedules or events and message me on **WhatsApp**.
- **Ops modules.** These are workflows with UIs that sit over agents and tools.
- **A proper dashboard** with chat, agents, workflows, approvals, system health, and a **graph view** of the knowledge brain.
- **Local inference only.** Several local LLMs, each routed by role.

This is **not** a business or sales tool.

---

## 2. Hard constraints (non-negotiable)

1. **Local-only inference at runtime.** Chat, agent reasoning, and embeddings use only local models through Ollama. No cloud LLM or embedding API calls from the running system. (Using a cloud coding agent to *build* the repo is fine.)
2. **Read-only by default. Human-in-the-loop for side effects.** Agents may read anything they are connected to. Any action with an external side effect needs my explicit approval through the approval queue (dashboard or WhatsApp). That includes:
   - sending email
   - messaging anyone other than me
   - creating, editing, or deleting tasks or finance records
   - writing files outside the app workspace
   - `git push` or `commit` in my repos
   - calling any write API

   Agents **may** message *me* on WhatsApp without approval.
3. **Single user, private network.** Services bind to `localhost` or the Tailscale interface only. Nothing is publicly exposed unless I approve it (for example, a webhook for the official WhatsApp API).
4. **TypeScript everywhere.** Node 24 LTS, pnpm workspaces, strict TS. I know React, Node.js, and TypeScript well; I also know Java, but don't use it here.
5. **Untrusted content stays data.** Emails, web pages, documents, and repo content are data, never instructions. Content from ingested sources must never be able to trigger a side-effect tool without approval.

---

## 3. Host machine (verified)

| Item | Value | Implication |
|---|---|---|
| Machine name | AETHERION | Home desktop used as the AI server |
| OS | **Windows host + WSL2 distro "Pengwin"** (NVIDIA driver 591.86 is the Windows driver) | GPU reaches WSL through the Windows driver. Don't install Linux NVIDIA drivers inside WSL. |
| CPU | Intel i7-12700K, 12 cores (8P + 4E), 20 threads | Plenty for the API, workers, ingestion, and CPU-side embedding batches |
| GPU | **NVIDIA RTX 3060, 12 GB VRAM**, about 360 GB/s bandwidth | **This is the binding constraint.** Budget about 10.5 GB of usable VRAM. |
| RAM visible to WSL | **15 GiB** (WSL defaults to about 50% of host RAM, so the host likely has about 32 GB) | Phase 0: confirm host RAM. Propose a `.wslconfig` raise to about 24 GB, but ask first. |
| Swap | 4 GiB | Avoid relying on swap for model offload |
| Disk | 1 TB, about 900 GB free | Room for models, a Postgres volume, and backups |

---

## 4. Local model plan (12 GB VRAM)

Rule of thumb on this GPU:
- **7–9B models at Q4/Q8 fit fully on the GPU with room for context.**
- **14B Q4 fits only at modest context.** One report shows a 9 GB 14B GGUF growing past 12 GB at runtime and spilling to CPU.
- **27B+ dense models do not fit.**
- Every model must show `100% GPU` in `ollama ps`. CPU/GPU split is a performance bug unless explicitly chosen.

**Model roles.** Code refers to *roles*, never model names. The mapping lives in `config/models.yaml`.

| Role | Default model (Ollama tag) | Approx. size | Residency | Use |
|---|---|---|---|---|
| `chat` / `agent` | `qwen3.5:9b` (Q4_K_M) | ~6.6 GB | Always loaded | Main reasoning, tool calling, personas, RAG answers. Native tools, thinking mode, and vision. |
| `router` / `fast` | `qwen3.5:4b` (or the same 9b with thinking off) | ~3 GB | Loaded on demand | Intent routing, classification, short summaries, background triage |
| `coder` | `qwen2.5-coder:14b` (Q4) | ~9 GB | **Swapped in** when the Coder agent runs; evicts `chat` | Code Q&A, repo analysis, diffs |
| `embed` | `qwen3-embedding:0.6b` | ~0.6–1.5 GB | Always loaded | All embeddings. Dimension 1024, 32K context. |
| `vision` (optional) | `qwen3.5:9b` (it accepts images) | — | Shared with `chat` | Screenshots and receipts |
| `deep` (optional, batch only) | `qwen3.6:35b-a3b` (MoE, about 3B active) with GPU + CPU offload | ~24 GB | Never during interactive use | Overnight reports. Only enable if host RAM is raised (≥ 24 GB to WSL) **and** a benchmark proves it acceptable. |

Fallbacks to support in config:
- `qwen3:8b` (alternative for `chat`)
- `nomic-embed-text` (768-dim fallback for `embed`)
- `gemma4:12b` (alternative for `chat`)

**Ollama server settings.** Document these and verify they take effect.
```
OLLAMA_FLASH_ATTENTION=1
OLLAMA_KV_CACHE_TYPE=q8_0
OLLAMA_MAX_LOADED_MODELS=2        # chat + embed resident
OLLAMA_NUM_PARALLEL=1             # one generation at a time on this GPU
OLLAMA_KEEP_ALIVE=30m
```
- Set `num_ctx` **per request** by role: chat 16K, router 4K, coder 16K. Ollama defaults to 4K context below 24 GB VRAM.
- Use the OpenAI-compatible endpoint `http://localhost:11434/v1` through one client in `packages/llm`. Native `/api/chat` is fine where needed (for example, `think:false`).

**GPU scheduler.** Build an `LlmGate` (a priority queue with a mutex) around generation calls:
- Interactive chat has priority over background jobs.
- Background jobs never preempt a running interactive request.
- Model swaps (to `coder`) are serialized.
- The gate emits metrics: queue depth, wait time, tokens/s, and time to first token.

**Tool-call robustness.** Qwen3.5 sometimes prints a tool call as text instead of emitting a structured call. Implement all of the following:
- a tolerant parser that detects `<tool_call>…</tool_call>` and JSON-in-text and converts it
- schema validation with zod
- one automatic repair retry
- logging of the parse failures

**Benchmark harness** (`pnpm bench:models`). For each role model, record:
- tokens/s and time to first token at the role's context size
- VRAM from `GET /api/ps` (`size_vram`). Don't trust other VRAM readings.
- tool-call success rate on a fixed set of 20 tool-use prompts
- retrieval answer quality on 10 brain questions

Write the results to `docs/HARDWARE.md`. Model choices must be justified by these numbers. **Expected ballpark on a 3060:** 7–9B at roughly 30–50 tok/s, 14B Q4 at roughly 20–24 tok/s. Flag any big deviation.

---

## 5. Architecture

```
                         ┌──────────────── Tailscale only ────────────────┐
  Phone (WhatsApp) ──►   │  apps/channels (WhatsApp adapter)              │
  Browser ───────────►   │  apps/web (Next.js dashboard) ──SSE/REST──┐    │
  Any MCP client ────►   │  apps/mcp (brain/tasks/finance MCP)       │    │
                         │                                           ▼    │
                         │  apps/api (Fastify)  ── agent runs ── packages/agents (LangGraph.js)
                         │        │                                   │    │
                         │        ├── apps/worker (BullMQ: cron, events, ingestion)
                         │        │                                   │    │
                         │  packages/llm (role router + LlmGate) ──► Ollama (GPU)
                         │  packages/brain (ingest, chunk, embed, hybrid search)
                         │        │                                        │
                         │  Supabase local: Postgres + pgvector + FTS ◄────┘
                         │  Redis (BullMQ, pub/sub, rate limits)          │
                         └────────────────────────────────────────────────┘
```

| Concern | Choice |
|---|---|
| Agent orchestration | **LangGraph.js** (`@langchain/langgraph`) with `PostgresSaver` checkpoints and `interrupt()` for human-in-the-loop |
| API | Fastify, with zod for validation, SSE for streaming, and an OpenAPI spec |
| Jobs and schedules | BullMQ + Redis, with a Bull Board UI embedded in the dashboard |
| Database | Supabase local (via the Supabase CLI and Docker), Postgres 15+ with pgvector, migrations in `supabase/migrations` |
| Data access | Drizzle ORM for app tables; raw SQL functions for search |
| Dashboard | Next.js (App Router), React, Tailwind, shadcn/ui, TanStack Query |
| Graph view | `react-force-graph` (2D default, 3D toggle) |
| Workflow view | React Flow (`@xyflow/react`) rendering LangGraph graph definitions and run traces |
| Tool protocol | **MCP**. Internal tools are MCP servers, so the brain is also usable from Claude Code, Cursor, or any MCP client. |
| Logging | pino (structured JSON); runs and steps persisted to Postgres. LangGraph Studio for local debugging. |
| Tests | Vitest for unit and integration; Playwright smoke tests for the dashboard |

---

## 6. Repo structure

```
aetherion-os/
├─ AGENTS.md                  # canonical instructions for ANY coding agent
├─ CLAUDE.md                  # one line: "See AGENTS.md" (import it)
├─ README.md
├─ docs/
│  ├─ BUILD_PROMPT.md         # this file
│  ├─ PLAN.md                 # phase checklist + status + decisions log
│  ├─ HARDWARE.md             # Phase 0 audit + model benchmarks
│  ├─ ARCHITECTURE.md
│  ├─ adr/                    # architecture decision records (0001-*.md)
│  └─ specs/                  # one spec per feature/agent before building it
├─ config/
│  ├─ models.yaml             # role → model, ctx, params
│  ├─ agents/                 # one folder per agent (see §9)
│  └─ schedules.yaml          # cron + event triggers
├─ apps/
│  ├─ web/                    # Next.js dashboard
│  ├─ api/                    # Fastify gateway + agent run endpoints
│  ├─ worker/                 # BullMQ workers, scheduler, event listeners
│  ├─ channels/               # WhatsApp adapter(s)
│  └─ mcp/                    # MCP servers: brain, tasks, finance, repos, email
├─ packages/
│  ├─ llm/                    # Ollama client, role router, LlmGate, tool-call repair
│  ├─ brain/                  # ingestion, chunking, embeddings, hybrid search, graph extraction
│  ├─ agents/                 # LangGraph graphs, supervisor, persona loader, tools registry
│  ├─ db/                     # Drizzle schema, queries
│  ├─ shared/                 # types, zod schemas, config loader, logger
│  └─ evals/                  # eval sets + runners
├─ supabase/                  # supabase CLI project, migrations, seed
├─ infra/
│  ├─ docker-compose.yml      # redis (+ optional services)
│  ├─ systemd/ or pm2/        # service definitions
│  └─ windows/                # documented .wslconfig + Task Scheduler steps (manual)
└─ scripts/                   # bench, backup, doctor, ingest CLIs
```

---

## 7. Data model (Postgres)

Write the migrations; adjust as needed and record changes in an ADR.

- `sources`: id, kind (`obsidian` | `repo` | `email` | `finance_csv` | `manual`), name, root_path/config, enabled, last_synced_at
- `documents`: id, source_id, path/uri, title, frontmatter jsonb, tags text[], content_hash, updated_at
- `chunks`: id, document_id, ordinal, heading_path, content, token_count, `tsv tsvector` (generated), metadata jsonb
  - GIN index on `tsv`; embeddings live in dimension-specific versioned tables (ADR 0002), each with its own vector index
- `embedding_versions`, `chunk_embeddings_1024`, `chunk_embeddings_768`, and singleton active-index configuration: see `adr/0002-embedding-versions.md` and `specs/embedding-storage.md`
- `links`: from_document_id, to_document_id or to_title (unresolved), kind (`wikilink` | `tag` | `mention` | `import`). Feeds the graph view.
- `entities` and `entity_mentions` (optional, Phase 5+): people, projects, and topics extracted by the `router` model, for richer graph nodes
- `agents`: id, slug, enabled, config hash. The source of truth is files in `config/agents`; the DB holds runtime state.
- `threads`, `messages`: chat history (channel = `web` | `whatsapp`)
- `runs`, `run_steps`: every agent run and node or tool step, with model, tokens, latency, errors
- `approvals`: id, run_id, agent, action, payload jsonb, risk, status (`pending` | `approved` | `rejected` | `expired`), decided_via, decided_at
- `memories`: long-term facts per agent or global, with source, confidence, and `approved` flag. Agents propose memories; I approve them.
- `events`: type, payload, created_at, processed_at
- `tasks`: built-in task store (title, status, due, project, source_link)
- `transactions`, `accounts`, `categories`: finance, imported from CSV
- `email_messages`: cached headers and summaries only (no attachments by default)
- `audit_log`: every side-effect request and decision

**Search function.** `search_brain(query_embedding, query_text, filters, k)`:
- hybrid search: pgvector cosine plus Postgres full-text
- merged with **reciprocal rank fusion**
- filters on source, tags, and path prefix
- returns chunk + document + heading_path for citations

---

## 8. The brain (ingestion and retrieval)

- **Obsidian vault**
  - The path comes from config. Use a chokidar watcher plus a full-resync command.
  - Parse frontmatter, `[[wikilinks]]` (including aliases and headings), `#tags`, and embeds.
  - Chunk by heading hierarchy, about 500–800 tokens with small overlap, and keep `heading_path`.
  - Make it incremental by `content_hash`. Handle renames and deletes.
  - **The vault stays the source of truth.** The system never writes to the vault without approval, and then only into a dedicated `AI-Inbox/` folder.
- **Code repos**
  - Config lists repo paths. Respect `.gitignore`; skip binaries, lockfiles, and build output.
  - Chunk by symbol using tree-sitter (TS/JS/Java) where practical; otherwise by file sections.
  - Store repo, path, language, and symbol.
  - Re-index on a git HEAD change (poll or hook).
- **Email** (Phase 7): Gmail API with the `gmail.readonly` scope only. Store headers and summaries, and embed the summaries.
- **Finance** (Phase 7): watch a drop folder for bank CSV exports. Use pluggable per-bank column mappers. Run dedup and categorization (rules first, LLM second, my corrections become rules).
- **Embeddings**
  - Batch them and run them through the `embed` role.
  - Isolate embeddings by model/version and dimension. Model changes require a validated background rebuild and atomic promotion; never substitute the fallback at query time or mix vector spaces (ADR 0002).
  - Use the query instruction prefix that `qwen3-embedding` expects for queries only.
- **Retrieval contract**
  - Every brain answer returns citations (note path + heading, or repo + file + line range).
  - If nothing relevant passes a score threshold, the agent says it doesn't know rather than guessing.
- **CLI tools**
  - `pnpm brain:ingest [--source]`
  - `pnpm brain:query "..."`
  - `pnpm brain:stats`

---

## 9. Agent layer (LangGraph.js)

**Topology.** A **Supervisor/Router** graph classifies intent with the `router` role and hands off to a specialist subgraph. Specialists share the brain tools and have their own tool allowlists. Direct addressing (`@coder …`) bypasses routing.

**Agent definition (file-based, hot-reloadable)** lives in `config/agents/<slug>/`:
- `persona.md`: voice, goals, boundaries, and examples
- `agent.yaml`:
  - `model_role`
  - `tools` (allowlist)
  - `brain_scope` (sources, tags, path prefixes)
  - `memory_scope`
  - `triggers` (cron or event)
  - `notify` (whatsapp | dashboard | none)
  - `autonomy: read_only | propose`

**Initial agents:**

| Slug | Persona | Mode | Key tools |
|---|---|---|---|
| `concierge` | Default chat entry point and router; concise | On-demand | brain.search, handoff |
| `librarian` | Answers from the vault with citations; finds connections | On-demand | brain.search, brain.get_doc, graph.neighbors |
| `coder` | Senior engineer across my repos (TS, JS, Java) | On-demand | repos.search, repos.read_file, brain.search (no write tools) |
| `planner` | Daily planning, task triage, weekly review | On-demand + morning brief | tasks.list, tasks.propose_create/update (approval), calendar later |
| `inbox` | Email triage: summarize, prioritize, draft replies **as drafts for me only** | Background on new email | email.list, email.read, email.propose_draft (approval) |
| `finance` | Read-only spending and budget analysis | Weekly + on-demand | finance.query, finance.categorize_proposal (approval) |
| `coach` | Personal development: learning goals, reflection prompts | Weekly + on-demand | brain.search, memories.read |
| `sentinel` | Watches events, decides whether something is worth pinging me | Background | events.read, notify.me |

**Mechanics:**
- **Checkpoints:** `PostgresSaver`, so runs are resumable and inspectable.
- **Human-in-the-loop.** Every tool declares `sideEffect: boolean` and `risk: low | medium | high`. Side-effect tools call `interrupt()`, which creates an `approvals` row and notifies me. The run resumes on approve or reject from the dashboard or from WhatsApp. Approvals expire after a configurable time.
- **Memory:** short-term memory is the thread. Long-term memory is the `memories` table; agents may *propose* memories, and they become active only after I approve them.
- **Guardrails:** max steps per run, max tokens, a per-agent rate limit, and a loop detector.
- **Streaming:** token streaming plus node/step events over SSE to the dashboard.

**MCP servers** (in `apps/mcp`):
- `brain`
- `tasks`
- `finance` (read)
- `repos` (read)
- `email` (read)

These are stdio and streamable-HTTP, so they work in LangGraph (through MCP adapters) and also in Claude Code, Cursor, etc.

---

## 10. Background engine (events and schedules)

- **Triggers:**
  - cron, from `config/schedules.yaml` (timezone `America/Chicago`), for example a morning brief at 07:00 and a weekly review on Sunday evening
  - file events (vault changes, a CSV dropped)
  - new email (poll)
  - git HEAD changes
  - manual triggers from the dashboard
- **Flow:** trigger → `events` row → BullMQ job → agent run (through `LlmGate` at background priority) → result stored → `sentinel`/`notify` policy decides whether to message me.
- **Notification policy:**
  - quiet hours (default 22:00–07:00), with urgent overrides
  - digesting: batch low-priority items
  - dedup
  - a max of N proactive messages per day
- **Job controls:** retries with backoff, a dead-letter queue, and a visible job history in the dashboard.

---

## 11. WhatsApp channel

- Interface: `MessagingChannel { send(to, msg), onMessage(handler), health() }`. Keep it pluggable.
- **Implementations:**
  - `baileys`: a local WhatsApp Web session. It's unofficial and carries an **account ban risk**. Document this clearly and use a secondary number if possible.
  - `cloud-api`: the official Meta WhatsApp Cloud API. It needs a business number and an HTTPS webhook (Tailscale Funnel or Cloudflare Tunnel). This is the more stable option.
- **Security:**
  - **Allowlist: my number only.** Ignore and log everything else.
  - Never message any other contact. That capability doesn't exist in the code path.
- **Commands:**
  - free text goes to `concierge`
  - `@agent text`
  - `/approve <id>` and `/reject <id>`
  - `/status`, `/agents`, `/brief`, `/mute 2h`
- Long answers are sent as a short summary plus a dashboard link (over Tailscale).

---

## 12. Dashboard (apps/web)

The UI should be dark, dense, and keyboard-friendly: an "operator console" feel, but clean and readable. Pages:

1. **Home:**
   - today's brief and pending approvals (one-click approve or reject)
   - recent runs and upcoming schedules
   - **system health:** GPU/VRAM, loaded models (from `/api/ps`), LlmGate queue depth, tok/s, BullMQ queues, DB size, last ingestion
2. **Chat:** agent picker, streaming, inline citations (click to open a note or file), tool-call and step trace drawer, threads
3. **Agents:**
   - a list with status; edit persona and config (writes to `config/agents/*`)
   - enable or disable an agent, test-run it
   - per-agent metrics
4. **Workflows:**
   - React Flow view of each LangGraph graph
   - a run history timeline that replays a run step by step
   - trigger a run manually
5. **Brain:**
   - search with filters, a document viewer, and source management
   - ingestion status and re-index buttons
6. **Graph:**
   - a force-directed graph of notes, tags, entities, and agents
   - color by folder or tag; filter by source, tag, or date
   - click to preview or open; a neighborhood focus mode
   - performance target: 5k+ nodes smooth in 2D
7. **Approvals:** inbox with a diff/preview of each proposed action, plus history
8. **Tasks**, **Finance** (charts, read-only), and **Inbox** (email summaries)
9. **Settings:** model roles (with "run benchmark"), channels, schedules, quiet hours, sources
10. **Logs / Audit**

**Auth:** single user. Use a session login (a passkey, or a password plus TOTP), served on the Tailscale interface only.

---

## 13. Running AETHERION as an always-on AI server

- **Phase 0 audit.** Detect and document:
  - WSL version and whether systemd is enabled
  - Docker (Docker Desktop WSL integration vs. Docker Engine inside WSL)
  - Node and pnpm
  - `nvidia-smi` inside WSL, and `ollama ps` showing GPU
- **Ollama.** Run it inside WSL with CUDA through the Windows driver, *or* on Windows natively and reach it from WSL. Benchmark both if unsure, pick the faster stable one, and record an ADR.
- **Services:** Supabase via its CLI, Redis via docker compose, and the Node apps via systemd units (preferred if WSL systemd is on) or pm2. Provide `pnpm doctor` to check every dependency.
- **Keep WSL alive.** Document, but don't apply without asking:
  - a `.wslconfig` (memory ≈ 24GB, swap, idle-timeout settings)
  - a Windows Task Scheduler task that starts the distro and services at boot or logon
- **Remote access:** Tailscale (already in use). Use `tailscale serve` for the dashboard and API.
- **Backups:** nightly `pg_dump` with rotation. The vault and repos are the source of truth, so the DB can be rebuilt by re-ingesting.

---

## 14. Security checklist

- Secrets only in `.env` (git-ignored); provide `.env.example`. OAuth tokens are encrypted at rest.
- Each agent has a tool allowlist. Side-effect tools require approval. Everything goes to the audit log.
- Prompt-injection hygiene:
  - wrap retrieved content in clear data delimiters
  - never let retrieved content choose tools
  - require a strict schema for tool arguments
- Rate limits on the channels and API. CORS locked to the dashboard origin.

---

## 15. Agent-agnostic repo conventions

- `AGENTS.md` is canonical:
  - project purpose and constraints (Sections 1–2 condensed)
  - architecture map
  - exact commands (install, dev, test, lint, bench, ingest, doctor)
  - code conventions and "do / don't" rules
  - where specs and ADRs live, and how to update `docs/PLAN.md`
- `CLAUDE.md` only points to `AGENTS.md`. Don't use tool-specific hooks or config that another agent couldn't follow.
- **Spec-first:** before building a feature or agent, write `docs/specs/<name>.md` covering goal, inputs and outputs, tools, acceptance criteria, and tests.
- Every non-trivial choice gets an ADR.
- One command surface: root `package.json` scripts, mirrored in a `Makefile`.
- CI-ready: `pnpm lint && pnpm typecheck && pnpm test` must pass at the end of every phase.

---

Baseline access, approval integrity, and restore gates are specified in `specs/security-recovery.md` and required at service introduction, before remote exposure or real-vault ingestion. Final operational hardening remains in Phase 8.

## 16. Phases and acceptance criteria

**Phase 0: Environment audit and models**
- Audit the host (Section 13) and write `docs/HARDWARE.md`.
- Install or verify Ollama with the GPU, pull the role models, apply the Ollama settings, and run `bench:models`.
- ✅ Done when every resident model shows 100% GPU, the benchmark table exists, and the model roles are confirmed with me.

**Phase 1: Scaffold**
- Create the monorepo, `AGENTS.md`, `docs/PLAN.md`, the Supabase local project and first migrations, Redis compose, and `packages/shared`, `packages/db`, and `packages/llm` (role router, LlmGate, tool-call repair).
- Add `pnpm doctor`.
- ✅ Done when `pnpm doctor` is all green, `packages/llm` passes unit tests (including tool-call repair cases), and a `/health` endpoint reports Ollama and the DB.

**Phase 2: Brain**
- Build Obsidian ingestion (watch + resync), chunking, embeddings, hybrid search with RRF, and link extraction.
- Build the `brain` MCP server and the brain CLIs.
- ✅ Done when the full vault is ingested, incremental updates land in under 5s, `brain:query` returns cited results, and the eval set reaches recall@5 of at least 0.8.

**Phase 3: Agent core**
- Build the supervisor, `concierge`, and `librarian`; the persona loader; `PostgresSaver`; the approval/interrupt flow (with a fake side-effect tool for testing); and the API with SSE.
- ✅ Done when a chat via the API streams a cited answer, and the fake side-effect tool pauses the run, creates an approval, and resumes correctly on approve and on reject.

**Phase 4: Dashboard v1**
- Build Home (health + approvals), Chat, Brain search, Runs, Approvals, and Auth.
- ✅ Done when the Playwright smoke tests pass and the dashboard is reachable over Tailscale from my phone.

**Phase 5: Graph and workflows**
- Build the Graph page (notes, links, tags) and the Workflows page (graph render + run replay).
- ✅ Done when the graph renders the full vault smoothly and clicking a run replays its steps.

**Phase 6: Background engine and WhatsApp**
- Build BullMQ, schedules, events, `sentinel`, the notification policy, the WhatsApp adapter (default chosen in Section 17), and the morning brief.
- ✅ Done when the morning brief arrives on WhatsApp at the scheduled time, `/approve` works from WhatsApp, and messages from non-allowlisted numbers are ignored and logged.

**Phase 7: Domain agents** (one at a time, each spec-first)
- Order: `coder` (repo ingestion + read tools) → `planner` + tasks → `inbox` (Gmail read-only) → `finance` (CSV) → `coach`.
- ✅ Done when each agent's spec acceptance criteria and eval set pass.

**Phase 8: Hardening**
- Add evals in CI, backups, service units, keep-alive docs, log retention, and a final `ARCHITECTURE.md`.
- ✅ Done when the machine survives a reboot with all services back up automatically and the system is documented end to end.

---

## 17. Open decisions

At the start of the relevant phase, ask me about each item. If I don't answer, use the default.

| Decision | Default |
|---|---|
| WhatsApp provider | `baileys` behind the adapter, with the ban risk documented. The `cloud-api` implementation is stubbed and ready to switch. |
| Email provider | Gmail, read-only scope |
| Finance data | Bank CSV exports (no Plaid) |
| Tasks | Built-in task store (an external integration such as Todoist can come later) |
| Access | Tailscale only; nothing public |
| Ollama location | Inside WSL, unless the Phase 0 benchmark favors Windows-native |
| Host RAM for WSL | Propose raising it to about 24 GB; ask before editing `.wslconfig` |

---

## 18. Start now

1. Read this whole file.
2. Create `docs/BUILD_PROMPT.md` (a copy of this file), `docs/PLAN.md` (phases as checklists), and a first draft of `AGENTS.md`.
3. Execute **Phase 0 only**, then stop and report:
   - the hardware findings
   - the benchmark table
   - the recommended final model roles
   - anything in this plan that the measurements say should change
