# Handbook compliance enforcement

Tracking: [#13](https://github.com/agthumoe/solid-lamp/issues/13); benchmark fixes also resolve [#11](https://github.com/agthumoe/solid-lamp/issues/11).

Goal: enforce every currently applicable handbook rule and establish gates for code introduced later. Nonexistent API, DB, agent and frontend features are not counted as implemented or tested.

Changes: strict TS with unchecked-index and exact-optional checks; ESLint typed safety/hooks/import boundaries; formatting; zod validation at diagnostic config/HTTP/fixture boundaries; structured allowlisted logging; benchmark CLI/refusal/residency acceptance; AST-based future frontend/boundary policy checks; compliance evidence matrix; unified CI/Makefile commands.

Acceptance: `pnpm check` passes; negative tests show invalid config/HTTP input, unsafe logging, duplicate flags, incorrect residency acceptance, oversized components and boundary violations fail. Existing benchmark artifacts remain immutable. A linked branch/PR carries validation and accurately states applicability. Existing Node test runner is retained until the Phase 1 Vitest migration; no system packages/services or model-role changes are introduced.
