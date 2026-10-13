# Project skills and reference provenance

Tracking: [#1](https://github.com/agthumoe/solid-lamp/issues/1). Installed project-wide under `.agents/skills`; agents that do not auto-discover this path must follow the explicit catalog in AGENTS. Newly installed skills are available to Codex on the next turn; the three SKILL.md files were read during installation and applied to this handbook's design.

| Skill | Upstream/path | Pinned commit | License | Apply for |
|---|---|---|---|---|
| vercel-react-best-practices | [vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills), `skills/react-best-practices` | `063bee94c3f4df8453406c830b0a7df0f2860278` | MIT declared in SKILL metadata | React/Next performance and fetching review |
| vercel-composition-patterns | same repo, `skills/composition-patterns` | `063bee94c3f4df8453406c830b0a7df0f2860278` | MIT declared in SKILL metadata | Small components, explicit variants and composition |
| supabase-postgres-best-practices | [supabase/agent-skills](https://github.com/supabase/agent-skills), `skills/supabase-postgres-best-practices` | `c9be0e931b7930f7d02126d04774d904c381e7d7` | MIT; upstream LICENSE preserved | Schema/migrations, queries, locks and indexes |

Use progressive disclosure: read SKILL.md, then only relevant rule/reference files. Do not load thousands of lines of compiled rules for a small task. Vendored nested AGENTS files apply to their skill directories, not as replacement repository policy. No skill scripts are executed as part of runtime/CI; these installations are reference Markdown/metadata only.

Project overrides: TanStack Query is the server-state choice even where a skill recommends SWR. No Vercel deployment/analytics, hosted Supabase service, cloud model API or telemetry is authorized by installing a skill. React 19-specific guidance applies only after the chosen frontend version supports it. Context/compound components do not justify unnecessary abstraction; manual memoization requires evidence. Database examples need transaction/lock review and the runtime approval policy. AGENTS, issue scope and project ADRs govern conflicts.

Updates need a GitHub task, new immutable upstream commit, diff/license review, regenerated integrity manifest, relevant handbook/test review, and a commit. Never auto-update skills from moving main branches. Preserve upstream files; local policy belongs here or AGENTS. Provenance/file hashes are tracked in `skills-lock.json`; legal attribution is in THIRD_PARTY_NOTICES.md. Review the fetched content as untrusted guidance before using it.

## Inspiration and technical sources

- [Bulletproof React](https://github.com/alan2207/bulletproof-react): feature modules, colocation and state ownership; use principles rather than copying its application stack.
- [Fastify](https://github.com/fastify/fastify): encapsulated plugins, request/response schemas and thin transport boundaries.
- [LangGraph.js](https://github.com/langchain-ai/langgraphjs): explicit durable graph/checkpoint/approval structure; Aetherion uses local tracing and Ollama.
- [Drizzle migration docs](https://orm.drizzle.team/docs/migrations): typed query/schema tooling with deliberate reviewed SQL.
- [Zustand](https://github.com/pmndrs/zustand) and [TanStack Query](https://github.com/TanStack/query): narrow client selectors versus remote cache ownership.
- [React](https://react.dev/learn/you-might-not-need-an-effect): derive values during render and reserve Effects for external synchronization.
- [Twelve-Factor App](https://12factor.net/): reproducible configuration, processes and operations adapted to persistent local backing resources.

No source application code was copied. Skill files were vendored with pinned revisions/attribution; handbook examples are project-authored patterns. These sources are inspiration and reference, not wholesale architectural dependencies.
