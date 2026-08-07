.PHONY: dev compose build start smoke-llm test-production-runtime
.PHONY: lint lint-md format format-check typecheck test check

dev:
	pnpm dev

compose:
	docker compose up --build

build:
	pnpm build

start:
	pnpm start

smoke-llm:
	pnpm smoke:llm

test-production-runtime:
	./scripts/test-production-runtime.sh

lint:
	pnpm lint

lint-md:
	pnpm lint:md

format:
	pnpm format

format-check:
	pnpm format:check

typecheck:
	pnpm typecheck

test:
	pnpm test

check:
	pnpm check
