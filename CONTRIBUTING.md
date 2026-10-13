# Contributing

Read AGENTS, STATUS, PLAN and the development handbook. Create/select a GitHub task **before writing project files**. Use the task/bug templates to define scope, acceptance, checks and dependencies. Respect owner-controlled phase gates.

Follow [GitHub delivery](docs/development/delivery.md): issue-linked branch/commits, focused PR, relevant validation and accurate handoff. [Architecture/API](docs/development/architecture-api.md), [frontend/state](docs/development/frontend-state.md), [database](docs/development/database.md), [AI](docs/development/ai.md), and [operations](docs/development/operations.md) are the review standards.

Run current checks (`pnpm test:bench`, `pnpm docs:check`) and syntax checks for changed native TS scripts. Future lint/typecheck/test commands must not be reported as passing before they exist. Include skipped checks and risks in the PR. Do not publish private vault content, secrets, credentials or debug dumps.

Update STATUS/PLAN and issue evidence before handoff. Vendored skills are pinned, advisory references; update them only through a reviewed issue with licenses and hashes preserved.
