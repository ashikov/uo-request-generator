.PHONY: dev compose build start lint lint-md format format-check typecheck test check

dev:
	pnpm dev

compose:
	docker compose up --build

build:
	pnpm build

start:
	pnpm start

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
