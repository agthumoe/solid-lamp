.PHONY: install bench\:models test\:bench

install:
	pnpm install

bench\:models:
	pnpm bench:models $(ARGS)

test\:bench:
	pnpm test:bench

.PHONY: docs\:check
docs\:check:
	pnpm docs:check
