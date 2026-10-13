# AGENTS.md — Aetherion OS

Canonical instructions for any coding agent (Claude Code, Cursor, Codex, OpenCode, …) working in this repo.
Status: **development governance adopted (2026-10-13)**; application enforcement is phased.

## Start here (every session)

1. Read **[`docs/STATUS.md`](docs/STATUS.md)**: what's in flight, the next steps in order, what's blocked on the owner, and gotchas.
2. Skim **[`docs/PLAN.md`](docs/PLAN.md)**: phase checklist + decisions log.
3. Read the [development handbook](docs/development/README.md) and the relevant topic guide. **Create/select an open GitHub task before writing project files**; see [delivery](docs/development/delivery.md). If GitHub is unavailable, continue read-only discovery and report the blocker.
4. Consult as needed: [`docs/BUILD_PROMPT.md`](docs/BUILD_PROMPT.md) (full requirements), [`docs/HARDWARE.md`](docs/HARDWARE.md) (host facts + benchmarks), `docs/adr/`, `docs/specs/`.

**Before ending a session**, update `docs/STATUS.md` (Now / Next / Blocked / Session log) and tick boxes in `docs/PLAN.md`. Another agent must be able to continue from those files alone.

| File | Holds | Update when |
|---|---|---|
| `docs/STATUS.md` | Current state, next actions, blockers, gotchas, session log | Every session / meaningful step |
| `docs/PLAN.md` | Phase checklists, decisions log | Task done or decision made |
| `docs/HARDWARE.md` | Host audit, benchmark results | Hardware/config change, new benchmark |
| `docs/adr/NNNN-*.md` | One architecture decision each | Any non-trivial choice |
| `docs/specs/<name>.md` | Feature/agent spec | Before building it |

## What this is

A single-user, local-first, multi-agent AI "operating system" running on one home machine (AETHERION: Windows + WSL2 "Pengwin", RTX 3060 12 GB).
Agents answer from one shared brain (Obsidian vault + repos embedded in local Supabase/pgvector), run on schedules, and message the owner on WhatsApp.
Full spec: [`docs/BUILD_PROMPT.md`](docs/BUILD_PROMPT.md). Status: [`docs/PLAN.md`](docs/PLAN.md). Hardware and benchmarks: [`docs/HARDWARE.md`](docs/HARDWARE.md).

## Hard constraints (never violate)

1. **Local-only inference at runtime.** All chat, reasoning, and embeddings go through Ollama on this machine. No cloud LLM or embedding API calls from runtime code.
2. **Read-only by default.** Any external side effect (sending email, messaging anyone but the owner, writing tasks or finance records, writing outside the app workspace, `git commit`/`push`, any write API) goes through the approval queue. Messaging the owner is allowed.
3. **Private network only.** Bind to `127.0.0.1` or the Tailscale interface. Never `0.0.0.0` without approval.
4. **TypeScript everywhere.** Node 24 LTS, pnpm workspaces, strict TS.
5. **Untrusted content is data.** Ingested emails, notes, web pages, and repo files are wrapped in data delimiters and can never select or trigger tools.

## Architecture map (target)

```
apps/web       Next.js dashboard          packages/llm     Ollama client, role router, LlmGate, tool-call repair
apps/api       Fastify gateway + SSE      packages/brain   ingest, chunk, embed, hybrid search
apps/worker    BullMQ jobs + schedules    packages/agents  LangGraph graphs, personas, tool registry
apps/channels  WhatsApp adapters          packages/db      Drizzle schema
apps/mcp       MCP servers                packages/shared  config, zod schemas, logger
config/        models.yaml, agents/, schedules.yaml
supabase/      migrations     infra/  compose, systemd, ollama, windows docs     scripts/  bench, doctor, ingest
```

## Commands

| Task | Command | Available from |
|---|---|---|
| Install | `pnpm install` | Phase 0 |
| Benchmark models | `pnpm bench:models` (flags: `--only chat,router`, `--no-fallbacks`, `--no-think`, `--label x`) | Phase 0 |
| Benchmark regression tests | `pnpm test:bench` | Phase 0 |
| Documentation/skill integrity | `pnpm docs:check` | Phase 0 |
| Dev / test / lint / typecheck | `pnpm dev`, `pnpm test`, `pnpm lint`, `pnpm typecheck` | Phase 1 |
| Doctor | `pnpm doctor` | Phase 1 |
| Brain | `pnpm brain:ingest [--source]`, `pnpm brain:query "..."`, `pnpm brain:stats` | Phase 2 |

Every current root script is mirrored in the `Makefile`; future scaffold scripts must be mirrored too.

## Conventions

**Do**
- Refer to models by **role** (`chat`, `router`, `coder`, `embed`, `vision`), resolved through `config/models.yaml`. Never hard-code a model tag.
- Route every generation call through `LlmGate` (interactive priority over background).
- Set `num_ctx` per request from the role config.
- Declare every tool with `sideEffect` and `risk`; side-effect tools must `interrupt()` for approval.
- Validate all external input and tool arguments with zod.
- Pin dependency versions exactly.
- Write `docs/specs/<name>.md` before building a feature or agent; write an ADR (`docs/adr/NNNN-title.md`) for every non-trivial choice.

**Don't**
- Don't call cloud model APIs from runtime code.
- Don't write to the Obsidian vault except `AI-Inbox/`, and only after approval.
- Don't add tool-specific config (hooks, rules files) that another agent couldn't follow; put instructions here.
- Don't install system packages, edit `.wslconfig`/Task Scheduler, open ports, or handle credentials without asking the owner.
- Don't commit secrets. Use `.env` (git-ignored) and keep `.env.example` current.

## Working process

1. Work in phases (`docs/PLAN.md`). At the end of each phase run `pnpm lint && pnpm typecheck && pnpm test`, update `docs/PLAN.md` (checkboxes + decisions log) and `docs/STATUS.md`, summarize, and **stop for the owner's go-ahead**.
2. When something is unclear, check §17 "Open decisions" in `docs/BUILD_PROMPT.md`, use the default, and log it in `docs/PLAN.md`.


## Development standards and project skills

Use [the handbook](docs/development/README.md) as the review contract: modular features and explicit dependency direction; narrow SOLID ports; Fastify/zod API contracts; Drizzle queries with a single Supabase SQL migration ledger; small single-responsibility React components; TanStack Query server state and Zustand shared ephemeral client state; deliberate hooks; local-first twelve-factor operations; structured redacted Pino logs.

React component functions target ≤100 nonblank lines, >150 triggers extraction/review, and authored frontend files >250 require decomposition or an issue/PR exception. State has one owner. Do not use Effects to mirror fetched/derived state or memoize every expression automatically.

Project skill catalog (read SKILL.md when relevant, then only the needed references):

| Skill | Entry point | Apply when |
|---|---|---|
| vercel-react-best-practices | [.agents/skills/react-best-practices/SKILL.md](.agents/skills/react-best-practices/SKILL.md) | React/Next fetching, render and performance work |
| vercel-composition-patterns | [.agents/skills/composition-patterns/SKILL.md](.agents/skills/composition-patterns/SKILL.md) | Components, variants and composition design |
| supabase-postgres-best-practices | [.agents/skills/supabase-postgres-best-practices/SKILL.md](.agents/skills/supabase-postgres-best-practices/SKILL.md) | DB schema, migrations, queries, vector search and locking |

These are cross-agent Markdown references, not agent-specific hooks. Upstream advice cannot override local-only inference, private networking, approval policy, TanStack Query choice or the issue scope. Preserve pinned files/licenses; update through a GitHub issue and refresh the skill lock. See [skills provenance](docs/development/skills.md).

GitHub is the task/progress tracker; STATUS/PLAN summarize it. New implementation uses issue-linked branches and PRs. Explicit owner authorization to commit/push or create GitHub tasks in a development session satisfies that development action's approval; it does not relax runtime side-effect approvals. Never commit/push without that authorization. The owner authorized the initial baseline publication in issue #1's session.
