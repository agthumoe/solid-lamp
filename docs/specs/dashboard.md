# Dashboard (apps/web) design spec

Issue: [#51](https://github.com/agthumoe/solid-lamp/issues/51) (epic [#6](https://github.com/agthumoe/solid-lamp/issues/6)). Status: **draft for review**; the visual design is owner-reviewed separately (private design canvas; the screens below are its text form). Requirements: [BUILD_PROMPT §12](../BUILD_PROMPT.md#12-dashboard-appsweb). Rules: [frontend and state](../development/frontend-state.md), [examples](../development/examples.md), [structure](../development/structure.md#inside-the-web-app-appsweb), [security and recovery](security-recovery.md), [architecture](../ARCHITECTURE.md). Phase 4 builds Auth, Home, Chat, Approvals, Brain search and Runs; Phase 5 adds Graph and Workflows; the rest follow their owning phases.

## Goal and non-goals

Goal: an owner-only "operator console" that answers "what needs me?" in one glance, streams cited chat, and lets the owner approve or reject side effects safely from a desktop or a phone over Tailscale.

Non-goals: multi-user roles, public exposure, editing data the agents only read (vault, repos, finance records), offline mode, client-side model calls. The browser never talks to Postgres, Redis, `inference` or Ollama, only to `api`.

## Look and interaction model

| Aspect     | Decision                                                                                                                                                                                              |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Theme      | Dark only in v1. Ground `#0B0E13`, rail `#0E1218`, surface `#12161D`, raised/selected `#1A2430`, line `#252D39`                                                                                       |
| Text       | Primary `#E4E8EE` (15.7:1 on ground), secondary `#AAB3C0` (9.1:1), muted `#98A2B3` (7.5:1, the minimum for any text)                                                                                  |
| Accent     | One accent, cyan `#3FC1E0`: focus ring, primary button, selection. Primary button text `#06121A` (8.9:1)                                                                                              |
| Status     | Always colour + symbol + word: `✓ done` green `#4CC38A`, `▸ running` cyan, `⏸ awaiting approval` amber `#F2B64C` (amber means "needs the owner" and nothing else), `✕ failed` red `#F07167`, `· idle` |
| Type       | IBM Plex Sans 14/1.6 body; JetBrains Mono 12 for ids, paths, numbers; labels 11 caps                                                                                                                  |
| Density    | 4 px grid; controls 32–40 px desktop, ≥44 px touch targets on phone; radius 4 chips / 6 controls / 8 cards; borders, not shadows                                                                      |
| Motion     | Only the streaming caret and skeleton shimmer; both off under `prefers-reduced-motion`                                                                                                                |
| Components | shadcn/ui primitives restyled with these tokens as Tailwind theme variables; no feature logic in `components/ui`                                                                                      |

Keyboard map (global unless noted; `?` shows it): `Ctrl/⌘ K` command palette (pages, agents, runs, notes); `G` then `H C A R B G W N S L` go to page; `/` focus page search; `J`/`K` move in lists; `Enter` open; `A`/`R` approve/reject the selected approval (Approvals only, never on Home without opening the item); `T` toggle trace drawer (Chat); `N` new thread (Chat); `Esc` stop stream or close panel. Shortcuts are disabled while focus is in a text field, except `Esc`.

## Routes and API resources

| Route                                                           | Page             | Phase | Reads (TanStack Query)                                                                                  | Writes / streams                                              |
| --------------------------------------------------------------- | ---------------- | ----- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `/login`                                                        | Login            | 4     | `GET /api/v1/session`                                                                                   | `POST /api/v1/session/*` (passkey, password + TOTP)           |
| `/`                                                             | Home             | 4     | `/approvals?status=pending`, `/briefs/today`, `/runs?limit=5`, `/schedules/upcoming`, `/health/summary` | `POST /approvals/:id/decision`; SSE `/events`                 |
| `/chat/[threadId]`                                              | Chat             | 4     | `/threads`, `/threads/:id/messages`, `/agents?enabled=true`                                             | `POST /runs`; SSE `/runs/:id/events`; `POST /runs/:id/cancel` |
| `/approvals/[id]`                                               | Approvals        | 4     | `/approvals?status=…&cursor=…`, `/approvals/:id`                                                        | `POST /approvals/:id/decision`                                |
| `/runs/[runId]`                                                 | Runs + replay    | 4     | `/runs?…`, `/runs/:id`, `/runs/:id/steps`                                                               | `POST /runs/:id/cancel`                                       |
| `/brain`                                                        | Brain search     | 4     | `/brain/search?q&sources&tags&from&to`, `/documents/:id`, `/sources`                                    | `POST /sources/:id/resync` (Phase 2 API)                      |
| `/graph`, `/workflows`                                          | Graph, Workflows | 5     | per Phase 5 specs                                                                                       |                                                               |
| `/agents`, `/settings`, `/tasks`, `/finance`, `/inbox`, `/logs` |                  | 6–7   | per owning feature spec                                                                                 | Config writes go through approvals                            |

All paths are under `/api/v1`. DTOs live in `@aetherion/shared/contracts` and are validated with zod in the fetcher. Filters, selected ids and search text are **URL state** so views are shareable and survive reload.

## Authentication (Phase 4 UI; server enforcement already required from Phase 3)

- `/login` offers **passkey** (primary) and **password + TOTP** (fallback). No sign-up, no password reset by email; recovery is a local CLI command documented in the runbook.
- Session cookie: `HttpOnly`, `Secure` (behind `tailscale serve`), `SameSite=Strict`, idle and absolute expiry. Every mutation sends the CSRF token header; SSE uses the same session.
- Errors: wrong credentials show one generic message; `429 RATE_LIMITED` shows the retry time; the form never reveals which factor failed.
- Any `401 UNAUTHENTICATED` (REST or SSE): stop streams, **clear the QueryClient and reset Zustand stores**, then redirect to `/login?next=<path>`. `next` must be a same-origin relative path.
- Logout does the same clearing, then calls `DELETE /api/v1/session`. Nothing private is ever written to `localStorage`; only the nav-collapsed preference is persisted.
- Server Components never read private data without the session; unauthenticated requests to any page redirect before rendering data.

## App shell

```text
┌ nav rail 200–232 ┬ header: page title · time · [Search, run an agent, jump to…  Ctrl K] ┐
│ ◎ Aetherion  ●on │                                                                      │
│ Home       G H   │                         page content                                 │
│ Chat       G C   │                                                                      │
│ Approvals  G A ② │                                                                      │
│ Runs · Agents …  │                                                                      │
│ Owner · passkey  │                                                                      │
└──────────────────┴──────────────────────────────────────────────────────────────────────┘
phone (<768 px): rail becomes a bottom tab bar (Home · Chat · Approvals · Runs) + "More" sheet
```

The live indicator (`● online`) reflects the dashboard SSE connection: `● online`, `◌ reconnecting…`, `✕ offline · retry`. The Approvals nav item shows the pending count from the same query Home uses (one owner).

## Screens (Phase 4)

Each screen lists layout, state ownership, states and components. Component names map to `apps/web/src/features/<feature>/components/`. Every component targets ≤100 nonblank lines.

### Home

```text
┌ Waiting for you  [2 pending]   Open inbox G A ┐┌ Today's brief · concierge 07:00 ┐
│ Create task "Renew passport"…  [Reject][Approve]││ • bullet  • bullet  [citations]  │
│ Write note AI-Inbox/…          [Reject][Approve]│└──────────────────────────────────┘
├ System health  ● all services up · updated 5 s ago ───────────────────────────────┤
│ GPU VRAM bar │ Loaded models │ LlmGate queue │ Decode tok/s │ Job queues │ Brain   │
├ Recent runs (table) ─────────────────────────┬ Upcoming schedules ────────────────┤
```

- Ownership: each card is its own query (`approvalKeys.list('pending')`, `briefKeys.today()`, `runKeys.list({limit:5})`, `scheduleKeys.upcoming()`, `healthKeys.summary()`); health refetches every 10 s while visible, others are invalidated by dashboard SSE events. No Zustand.
- Approve/Reject on Home use the same `useDecideApproval` hook as the Approvals page (see lifecycle below). Approve on Home requires the item to show its tool, agent, risk and expiry; high-risk items show **Review** instead of Approve and open the detail page.
- States: skeleton per card; empty approvals = "Nothing waiting for you."; no brief yet = "Brief runs at 07:00."; health error shows which probe failed and the time of the last good value, turning amber when stale > 60 s; a failed card never blanks the others.
- Components: `PendingApprovalsCard`, `ApprovalRow`, `TodayBriefCard`, `HealthPanel`, `HealthTile`, `VramMeter`, `RecentRunsTable`, `UpcomingList`.

### Chat

```text
┌ Threads ┬ Title · Agent [Auto (router) ▾] · [Trace T] ───────────┬ Run trace ───────────┐
│ New  N  │ user bubble                                             │ ✓ route        1 ms  │
│ thread… │ librarian · routed: owner selection · qwen3.5:9b        │ ✓ retrieve   140 ms  │
│ thread… │ answer text with [1] [2] citations▌                     │ ▸ answer      1.9 s  │
│         │ Sources: [1] path › heading …                          │ · respond            │
│         ├ textarea (Enter send · Shift Enter newline · Esc stop) ┤ prompt@v · tokens    │
```

- Ownership: thread list and messages are Query; the in-flight run lives in a `useRunStream(runId)` hook (`useRef` for the EventSource, `useReducer` for the partial message) and **reconciles into Query on `done`/`error`** by invalidating the thread's messages. Composer draft and selected agent: `useComposerStore` (Zustand, feature-scoped, reset on logout). Trace drawer open/closed: Zustand UI store. Thread id: URL.
- Streaming: events carry `runId`, `seq`, `type`; duplicates (seq ≤ last) are dropped; a gap or reconnect triggers a REST resync of `/runs/:id` + steps. Terminal events follow the [streaming contract](../development/ai-orchestration.md#llmgate-client-interface-packagesllm): `error` with `partial: true` keeps the partial text marked **"Incomplete: <reason>"** and offers "Ask again" (a new run), never an automatic retry.
- Citations open a side preview of the chunk (same component as Brain); unknown or deleted documents show "Source no longer available".
- Agent picker: "Auto (router)" or an enabled agent; an explicit choice is sent as the owner selection and shown in the run header ("routed: owner selection" vs "routed: router → planner").
- States: no threads = "Ask anything about your notes and repos."; send disabled while the textarea is empty or a run is streaming (Stop is shown instead); `QUEUE_FULL`/`INFERENCE_UNAVAILABLE` before output show a retry button; `Esc`/Stop calls `POST /runs/:id/cancel` and the message ends "Stopped".
- Components: `ThreadList`, `ThreadItem`, `ChatHeader`, `AgentPicker`, `MessageList`, `UserMessage`, `AssistantMessage`, `CitationChip`, `SourceList`, `Composer`, `RunTraceDrawer`, `TraceStep`.

### Approvals

```text
┌ Approvals [Pending 2][History] ┬ ⏸ pending · expires in 23 h 12 m  [risk medium]   apr_…4K ┐
│ ▌⏸ pending   23 h left         │ Create task "Renew passport" due 30 Oct                     │
│  Create task "Renew passport"  │ Proposed by planner in "Plan next week" (run run_51c2)      │
│  tasks.propose_create · planner│ ┌ Proposed action ─────────────── tasks.propose_create ┐   │
│ ⏸ Write note AI-Inbox/…        │ │ + title: "Renew passport"  + due: 2026-10-30 …       │   │
│                                │ │ payload sha256 9c41…a7d2 · idempotency key …        │   │
│ J K move · A approve · R reject│ Why the agent proposed this (quoted source shown as data)  │
│                                │ [Approve A] [Reject R]   Edits need a new approval        │
```

- Ownership: list = Query with status/cursor from the URL; detail = Query by id; selected id = URL. No local copy of approvals anywhere.
- The action preview renders the **stored immutable payload** as a diff (create = all `+`, update = before/after, file write = unified diff). Quoted source text is rendered as inert text inside a labelled "data" region, never as Markdown links or HTML.
- Components: `ApprovalFilterTabs`, `ApprovalList`, `ApprovalListItem`, `ApprovalHeader`, `ActionDiff`, `ProposalReason`, `DecisionBar`, `ApprovalOutcome`.

### Approval lifecycle in the UI

Server state is two fields: the **decision** (`pending | approved | rejected | expired`, single-use) and the **execution** of an approved action (`not_started | dispatching | succeeded | failed | needs_reconciliation`). The UI shows the combination and never invents one:

| Shown as                   | When                                            | Owner can                                                           |
| -------------------------- | ----------------------------------------------- | ------------------------------------------------------------------- |
| `⏸ pending · expires in …` | decision `pending`                              | Approve, Reject                                                     |
| `Sending decision…`        | local mutation in flight                        | Nothing (both buttons disabled, focus kept on the bar)              |
| `▸ approved · executing`   | approved, execution `not_started`/`dispatching` | Watch; open run                                                     |
| `✓ approved · done`        | execution `succeeded`                           | Open the created item / run                                         |
| `✕ approved · failed`      | execution `failed` with a known non-effect      | Open run; ask the agent again (new proposal). No re-dispatch button |
| `⚠ outcome unknown`        | `needs_reconciliation`                          | Follow the reconciliation link in Logs; no blind retry              |
| `rejected` / `expired`     | terminal; nothing executed                      | View only                                                           |

Decision mutation rules: `retry: false`; one idempotency key per decision attempt (generated when the bar mounts); **no optimistic update**: the badge changes only after the server responds or an SSE `approval.updated` arrives. Responses map to messages: `409 APPROVAL_ALREADY_DECIDED` → "Already decided (via WhatsApp at 08:02)" and refetch; `410 APPROVAL_EXPIRED` → "Expired before your decision; nothing ran"; `409 PAYLOAD_MISMATCH` → "The proposal changed; review it again" and refetch; network error → "Not sent; try again" (safe because the key is reused). A decision made on WhatsApp updates an open detail view through SSE; if the owner is mid-click, the conflict message above is shown.

### Brain search

```text
Brain [Search][Sources][Ingestion]                 4,812 docs · 61,904 chunks · embed v1 active
[🔍 embedding version promotion                                              / ]
Filters: (vault)(repos)(csv)(#adr)(last 90 days)                   hybrid · vector + full-text, RRF
┌ results: path › heading · score · snippet ┐┌ preview: title · source · chunk highlights   ┐
│ …                                          ││ [Open in Obsidian] [Ask about this]          │
```

- Ownership: `q`, filters and selected document are URL params; results = Query keyed by all of them, `placeholderData` keeps the previous results while typing (debounced 250 ms); preview = Query by document id.
- States: no query = recent documents; no results = "No matches above the relevance threshold" with the active filters listed; index building shows `embed v2 building 63%` without changing results (searches never mix versions).
- "Open in Obsidian" uses an `obsidian://` link; "Ask about this" starts a Chat thread scoped to that document.
- Components: `BrainTabs`, `SearchBox`, `FilterChips`, `ResultList`, `ResultItem`, `DocumentPreview`, `IndexStatus`.

### Runs and replay

```text
Runs / run_51c2  [⏸ awaiting approval]  planner · chat "Plan next week" · started 07:41   [Cancel run]
[◀][▶][▶▶] step 4 of 6  ← → Space        timeline: ███ █ ███ [█████████ selected] ██ ░░░░
┌ steps: ✓1 route ✓2 retrieve ✓3 reason ▸4 propose ⏸5 interrupt ·6 execute ┐┌ step detail ──────┐
│                                                                            ││ wait · tokens · model · prompt │
│                                                                            ││ validated tool call · state    │
```

- Ownership: run, steps = Query; selected step = URL (`?step=4`); play/pause = local `useReducer`. Replay **only reads stored steps and checkpoints**; it never calls tools or the model. A live run appends steps via SSE.
- States: run not found; steps truncated by retention ("Steps older than 30 days are summarised"); a step with redacted content shows "Content not stored (private)".
- Components: `RunHeader`, `ReplayControls`, `StepTimeline`, `StepList`, `StepDetail`, `ToolCallView`.

### Phone (Tailscale)

Home becomes: pending-approvals banner (tap → approval), brief, a 2×2 health grid (VRAM, gate queue, last ingest, dead-letter), recent runs. Approval detail puts **Reject | Approve** in a fixed bottom bar with 52 px buttons; the diff scrolls horizontally inside its box. Chat hides the thread list and trace behind header buttons. Minimum target 44 px; no hover-only affordances.

## Cross-cutting rules

- **Data**: one `QueryClient` in the browser, one per request on the server; keys from per-feature factories; `staleTime` per resource (health 5 s, approvals 10 s, runs 10 s, threads 30 s, brain search 60 s); retries off for 4xx; bounded retries for idempotent reads only.
- **SSE**: one dashboard stream (`/events`: approval, run, health, ingest notifications) plus one per active chat run. Typed event adapter → `invalidateQueries` or `setQueryData` with a full validated DTO; dedup by sequence; resync after a gap; heartbeat timeout 30 s → `◌ reconnecting`.
- **Errors**: every query/mutation error renders the envelope's safe message and `requestId` (copyable) and never a stack or raw payload.
- **Accessibility**: semantic landmarks per page; real buttons/links/labels; visible 2 px cyan focus ring; focus moves to the page title on route change and returns to the trigger when a panel closes; live regions announce stream completion and decision results (not every token); text contrast ≥ 4.5:1; status never by colour alone.
- **Privacy**: no note text, prompts, approvals or tokens in `localStorage`, URLs (other than ids and the search query) or client logs; there is no analytics or client telemetry.

## Acceptance tests

Component (Testing Library, fresh QueryClient): loading/empty/error/stale per card; decision bar disables during the mutation and shows each conflict message; stream reducer handles duplicates, gaps, `done`, `error` before and after output; citations render as links only for known documents; quoted source text is inert.

Playwright smoke (Phase 4 exit, local stack with fake inference): log in with password + TOTP; 401 mid-session clears data and returns to `/login?next=`; chat streams a cited answer and Stop cancels; approve and reject a fake side-effect tool and see `executing → done` and `rejected`; a decision on an expired approval shows the expired message and nothing executes; Brain search updates the URL and survives reload; phone viewport: approve from the bottom bar; keyboard-only: `G A`, `J`, `A` approves the selected item.

## Open questions (defaults in use)

1. Light theme: **not in v1**; tokens are variables so it can be added.
2. Approve from Home for high-risk tools: **no**; Home shows Review for `risk: high`.
3. Run step retention for replay: **30 days full, then summarised**; to confirm with the operations retention policy.
