#!/usr/bin/env bash

set -euo pipefail

ROOT_DIRECTORY=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)
DOCKERFILE_PATH="$ROOT_DIRECTORY/tests/llm-benchmark/Dockerfile"
IMAGE_TAG="uo-request-generator-benchmark-llm:local"

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    fail "required command '$1' not found"
  fi
}

require_command docker

NODE_VERSION=$(sed -n '1p' "$ROOT_DIRECTORY/.nvmrc" | tr -d '[:space:]')
PNPM_VERSION=$(sed -n 's/.*"packageManager"[[:space:]]*:[[:space:]]*"pnpm@\([^"]*\)".*/\1/p' "$ROOT_DIRECTORY/package.json" | head -n 1)
if [[ -z "$NODE_VERSION" || -z "$PNPM_VERSION" ]]; then
  fail 'не удалось прочитать версии runtime из .nvmrc и package.json'
fi

if ! grep -q "NODE_VERSION=${NODE_VERSION}" "$DOCKERFILE_PATH" &&
  ! grep -q "ARG NODE_VERSION=${NODE_VERSION}" "$DOCKERFILE_PATH"; then
  fail "Dockerfile does not pin NODE_VERSION=${NODE_VERSION}"
fi

if ! grep -q "ARG PNPM_VERSION=${PNPM_VERSION}" "$DOCKERFILE_PATH"; then
  fail "Dockerfile does not pin PNPM_VERSION=${PNPM_VERSION}"
fi

if ! grep -q "pnpm@\${PNPM_VERSION}" "$DOCKERFILE_PATH"; then
  fail "Dockerfile does not use pnpm@${PNPM_VERSION}"
fi

if ! grep -q "pnpm install --frozen-lockfile" "$DOCKERFILE_PATH"; then
  fail 'Dockerfile does not use frozen lockfile'
fi

printf 'Building benchmark docker image...\n'
docker build --file "$DOCKERFILE_PATH" --tag "$IMAGE_TAG" "$ROOT_DIRECTORY"

printf 'Checking runtime versions inside image...\n'
node_version=$(docker run --rm --entrypoint node "$IMAGE_TAG" --version)
pnpm_version=$(docker run --rm --entrypoint pnpm "$IMAGE_TAG" --version)

if [[ "$node_version" != "v$NODE_VERSION" ]]; then
  fail "node version mismatch: expected v${NODE_VERSION}, got ${node_version}"
fi

if [[ "$pnpm_version" != "$PNPM_VERSION" ]]; then
  fail "pnpm version mismatch: expected ${PNPM_VERSION}, got ${pnpm_version}"
fi

printf 'Checking build context excludes local benchmark config and reports...\n'
docker run --rm --entrypoint sh "$IMAGE_TAG" -c '\
  test ! -f ".llm-benchmark.local.json" && \
  test ! -d ".tmp" && \
  test ! -e ".env" && \
  test ! -e ".env.local" \
'

printf 'Checking default plan mode through container without local Node.js/pnpm...\n'
plan_output=$(docker run --rm "$IMAGE_TAG" --config .llm-benchmark.example.json --limit 1 --repeats 1)

if [[ "$plan_output" != *"LLM benchmark plan (provider requests: 0)"* ]]; then
  fail 'plan mode did not report zero provider requests'
fi

if [[ "$plan_output" != *"Total requests: 2"* ]]; then
  fail 'unexpected total requests in plan mode'
fi

if [[ "$plan_output" != *"Scenarios (1): only-description"* ]]; then
  fail 'limit/plan arguments did not reach benchmark parsing'
fi

printf 'Checking argument forwarding for repeats and scenario...\n'
repeat_output=$(docker run --rm "$IMAGE_TAG" \
  --config .llm-benchmark.example.json \
  --scenario only-description \
  --repeats 2)

if [[ "$repeat_output" != *"Repeats: 2"* ]]; then
  fail 'repeats argument did not reach container benchmark'
fi

if [[ "$repeat_output" != *"Total requests: 4"* ]]; then
  fail 'repeats + scenario forwarding produced unexpected total requests'
fi

printf 'Checking --run cannot execute in non-interactive environment...\n'
if docker run --rm "$IMAGE_TAG" --config .llm-benchmark.example.json --run --repeats 1 >/tmp/uo-benchmark-run.log 2>&1; then
  fail 'run mode should not execute in non-interactive container run'
fi

if ! grep -Eq "Платный запуск доступен только в интерактивном терминале\\. Выполнено 0 запросов\\.|Запуск отменён\\. Выполнено 0 запросов\\." /tmp/uo-benchmark-run.log; then
  fail 'non-interactive run path did not block paid mode as expected'
fi

rm -f /tmp/uo-benchmark-run.log
docker image rm "$IMAGE_TAG" >/dev/null

printf 'Benchmark container contract checks passed\n'
