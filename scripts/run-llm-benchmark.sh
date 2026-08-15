#!/usr/bin/env bash

set -euo pipefail

ROOT_DIRECTORY=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)
DOCKERFILE_PATH="$ROOT_DIRECTORY/tests/llm-benchmark/Dockerfile"
IMAGE_TAG="uo-request-generator-benchmark-llm:local"

if [[ $# -gt 0 && ("$1" == "-h" || "$1" == "--help") ]]; then
  printf 'Usage: make benchmark-llm ARGS="[benchmark args]"\n'
  printf 'или:  scripts/run-llm-benchmark.sh [benchmark args]\n'
  printf '\n'
  printf 'Пример:\n'
  printf '  scripts/run-llm-benchmark.sh --config .llm-benchmark.local.json --limit 1\n'
  exit 0
fi

CONFIG_PATH=".llm-benchmark.local.json"
HAS_CONFIG_ARG=false
BENCHMARK_ARGS=()
ALL_ARGS=("$@")

for ((index = 0; index < ${#ALL_ARGS[@]}; index += 1)); do
  argument="${ALL_ARGS[index]}"

  if [[ "$argument" == "--" ]]; then
    BENCHMARK_ARGS+=("${ALL_ARGS[@]:index}")
    break
  fi

  if [[ "$argument" == "--config" ]]; then
    next_index=$((index + 1))
    CONFIG_PATH="${ALL_ARGS[next_index]:-}"

    if [[ -z "$CONFIG_PATH" || "$CONFIG_PATH" == --* ]]; then
      printf 'Ошибка: у --config должен быть явный путь к файлу\n' >&2
      exit 1
    fi

    HAS_CONFIG_ARG=true
    BENCHMARK_ARGS+=(--config "$CONFIG_PATH")
    index=$next_index
    continue
  fi

  if [[ "$argument" == --config=* ]]; then
    HAS_CONFIG_ARG=true
    CONFIG_PATH="${argument#*=}"
    if [[ -z "$CONFIG_PATH" || "$CONFIG_PATH" == --* ]]; then
      printf 'Ошибка: у --config должен быть явный путь к файлу\n' >&2
      exit 1
    fi
    BENCHMARK_ARGS+=("--config" "$CONFIG_PATH")
    continue
  fi

  BENCHMARK_ARGS+=("$argument")
done

if [[ "$HAS_CONFIG_ARG" == false ]]; then
  BENCHMARK_ARGS=(--config "$CONFIG_PATH" "${BENCHMARK_ARGS[@]}")
fi

if [[ "${CONFIG_PATH:0:1}" == "/" ]]; then
  printf 'Ошибка: --config должен быть относительным путём внутри checkout\n' >&2
  exit 1
fi

if [[ "$CONFIG_PATH" == *".."* ]]; then
  printf 'Ошибка: --config не должен содержать ..\n' >&2
  exit 1
fi

HOST_CONFIG_PATH="$ROOT_DIRECTORY/$CONFIG_PATH"
if [[ ! -f "$HOST_CONFIG_PATH" ]]; then
  printf 'Не найден benchmark config: %s. Скопируйте .llm-benchmark.example.json в .llm-benchmark.local.json\n' \
    "$CONFIG_PATH" >&2
  exit 1
fi

REPORT_DIRECTORY=".tmp/llm-benchmark"
mkdir -p "$ROOT_DIRECTORY/$REPORT_DIRECTORY"

docker build --file "$DOCKERFILE_PATH" --tag "$IMAGE_TAG" "$ROOT_DIRECTORY"

TTY_ARGS=(--interactive)
if [[ -t 0 && -t 1 ]]; then
  TTY_ARGS+=(--tty)
fi

ENV_ARGS=()
if [[ -n "${LLM_API_URL:-}" ]]; then
  ENV_ARGS+=(--env LLM_API_URL)
fi
if [[ -n "${LLM_API_KEY:-}" ]]; then
  ENV_ARGS+=(--env LLM_API_KEY)
fi
if [[ -n "${LLM_AUTH_SCHEME:-}" ]]; then
  ENV_ARGS+=(--env LLM_AUTH_SCHEME)
fi
if [[ -n "${LLM_FOLDER_ID:-}" ]]; then
  ENV_ARGS+=(--env LLM_FOLDER_ID)
fi

docker run --rm "${TTY_ARGS[@]}" \
  --volume "$HOST_CONFIG_PATH:/app/$CONFIG_PATH:ro" \
  --volume "$ROOT_DIRECTORY/$REPORT_DIRECTORY:/app/$REPORT_DIRECTORY" \
  "${ENV_ARGS[@]}" \
  "$IMAGE_TAG" "${BENCHMARK_ARGS[@]}"
