.PHONY: dev compose build start smoke-llm lint lint-md format format-check typecheck test check

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
