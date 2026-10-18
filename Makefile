.PHONY: install bench\:models test\:bench

install:
	pnpm install

bench\:models:
	pnpm bench:models $(ARGS)

test\:bench:
	pnpm test:bench

.PHONY: test\:templates
test\:templates:
	pnpm test:templates

.PHONY: test\:shared
test\:shared:
	pnpm test:shared

.PHONY: test\:llm
test\:llm:
	pnpm test:llm

.PHONY: dev\:inference
dev\:inference:
	pnpm dev:inference

.PHONY: test\:inference
test\:inference:
	pnpm test:inference

.PHONY: docs\:check
docs\:check:
	pnpm docs:check

.PHONY: lint
lint:
	pnpm lint

.PHONY: typecheck
typecheck:
	pnpm typecheck

.PHONY: test
test:
	pnpm test

.PHONY: format
format:
	pnpm format

.PHONY: format\:check
format\:check:
	pnpm format:check

.PHONY: compliance\:check
compliance\:check:
	pnpm compliance:check

.PHONY: check
check:
	pnpm check

.PHONY: evals\:check
evals\:check:
	pnpm evals:check

.PHONY: evals\:domain\:check
evals\:domain\:check:
	pnpm evals:domain:check
