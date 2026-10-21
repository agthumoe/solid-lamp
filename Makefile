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

.PHONY: dev\:api
dev\:api:
	pnpm dev:api

.PHONY: doctor
doctor:
	pnpm run doctor

.PHONY: db\:start
db\:start:
	pnpm db:start

.PHONY: db\:stop
db\:stop:
	pnpm db:stop

.PHONY: db\:migrate
db\:migrate:
	pnpm db:migrate

.PHONY: db\:status
db\:status:
	pnpm db:status

.PHONY: db\:backup
db\:backup:
	pnpm db:backup

.PHONY: db\:restore-verify
db\:restore-verify:
	pnpm db:restore-verify $(ARGS)

.PHONY: brain\:fixture-vault
brain\:fixture-vault:
	pnpm brain:fixture-vault $(ARGS)
.PHONY: brain\:watch-latency
brain\:watch-latency:
	pnpm brain:watch-latency
.PHONY: brain\:pdf-fixtures
brain\:pdf-fixtures:
	pnpm brain:pdf-fixtures

.PHONY: test\:doctor
test\:doctor:
	pnpm test:doctor

.PHONY: test\:db
test\:db:
	pnpm test:db

.PHONY: test\:int
test\:int:
	pnpm test:int

.PHONY: dev\:worker
dev\:worker:
	pnpm dev:worker

.PHONY: test\:worker
test\:worker:
	pnpm test:worker

.PHONY: dev\:mcp-brain
dev\:mcp-brain:
	pnpm dev:mcp-brain

.PHONY: brain\:query
brain\:query:
	pnpm brain:query $(ARGS)

.PHONY: brain\:stats
brain\:stats:
	pnpm brain:stats $(ARGS)

.PHONY: test\:mcp
test\:mcp:
	pnpm test:mcp

.PHONY: test\:api
test\:api:
	pnpm test:api

.PHONY: test\:brain
test\:brain:
	pnpm test:brain

.PHONY: test\:inference
test\:inference:
	pnpm test:inference

.PHONY: test\:brain
test\:brain:
	pnpm test:brain

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

.PHONY: deps\:audit
deps\:audit:
	pnpm deps:audit
