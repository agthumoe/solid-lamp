# Aetherion OS

A single-user, local-first AI operating system for a home Windows/WSL machine. Runtime inference uses local Ollama; agents share a cited brain and side effects require approval.

**Current phase:** Phase 0 — environment and model validation. The application scaffold is not built yet. Read [STATUS](docs/STATUS.md) for live progress and [PLAN](docs/PLAN.md) for phase gates.

## Development

Start with [AGENTS.md](AGENTS.md), the [development handbook](docs/development/README.md), and [contribution workflow](CONTRIBUTING.md). Create/select a [GitHub issue](https://github.com/agthumoe/solid-lamp/issues) before editing project files. The handbook defines small single-responsibility components, TanStack Query/Zustand state ownership, Fastify contracts, Drizzle/SQL migrations, local AI safety, logging and debugging.

Node 24 and the pinned pnpm version in package.json are required. Current checks:

```bash
pnpm install --frozen-lockfile
pnpm test:bench
pnpm docs:check
```

For live local benchmarks, ensure no other inference run is active and use a fresh label: `pnpm bench:models --label tuned-next`. See [HARDWARE](docs/HARDWARE.md) for results/caveats. Full lint/typecheck/application tests are added in Phase 1.

[Requirements](docs/BUILD_PROMPT.md) · [Architecture decisions](docs/adr/0003-development-architecture.md) · [Project skills](docs/development/skills.md) · [Issues](https://github.com/agthumoe/solid-lamp/issues)
