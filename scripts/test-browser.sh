#!/usr/bin/env bash

set -euo pipefail

ROOT_DIRECTORY=""
ROOT_DIRECTORY=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)
COMPOSE_FILE="$ROOT_DIRECTORY/compose.browser.yaml"
TEMPORARY_ARTIFACT_DIRECTORY="$ROOT_DIRECTORY/.browser-test-artifacts"
LOCK_FILE="$ROOT_DIRECTORY/.browser-test.lock"

if ! command -v git >/dev/null 2>&1; then
  printf '%s\n' 'Для запуска browser-level тестов требуется Git' >&2
  exit 2
fi
if CHECKOUT_PHYSICAL_ID=$(stat --format='%d:%i' "$ROOT_DIRECTORY" 2>/dev/null); then
  :
elif CHECKOUT_PHYSICAL_ID=$(stat -f '%d:%i' "$ROOT_DIRECTORY" 2>/dev/null); then
  :
else
  printf '%s\n' 'Не удалось определить физический идентификатор checkout' >&2
  exit 2
fi
if [[ ! "$CHECKOUT_PHYSICAL_ID" =~ ^[0-9]+:[0-9]+$ ]]; then
  printf '%s\n' 'Получен некорректный физический идентификатор checkout' >&2
  exit 2
fi
CHECKOUT_HASH=$(
  printf '%s' "$CHECKOUT_PHYSICAL_ID" |
    env \
      -u GIT_DIR \
      -u GIT_WORK_TREE \
      -u GIT_COMMON_DIR \
      -u GIT_IMPLICIT_WORK_TREE \
      -u GIT_INDEX_FILE \
      -u GIT_OBJECT_DIRECTORY \
      -u GIT_ALTERNATE_OBJECT_DIRECTORIES \
      -u GIT_CEILING_DIRECTORIES \
      -u GIT_DISCOVERY_ACROSS_FILESYSTEM \
      -u GIT_CONFIG \
      -u GIT_CONFIG_PARAMETERS \
      -u GIT_CONFIG_COUNT \
      git -C "$ROOT_DIRECTORY" hash-object --stdin
)
if [[ ! "$CHECKOUT_HASH" =~ ^[0-9a-f]{40}$ &&
  ! "$CHECKOUT_HASH" =~ ^[0-9a-f]{64}$ ]]; then
  printf '%s\n' 'Не удалось вычислить идентификатор checkout' >&2
  exit 2
fi
COMPOSE_PROJECT_NAME="uo-request-generator-browser-${CHECKOUT_HASH:0:16}"

BROWSER_TEST_UID=$(id -u)
BROWSER_TEST_GID=$(id -g)
export BROWSER_TEST_UID BROWSER_TEST_GID

compose() {
  docker compose \
    --project-name "$COMPOSE_PROJECT_NAME" \
    --env-file /dev/null \
    --file "$COMPOSE_FILE" \
    "$@"
}

publish_artifacts() {
  local publish_status=0

  for artifact_name in playwright-report test-results; do
    if [[ -d "$TEMPORARY_ARTIFACT_DIRECTORY/$artifact_name" ]]; then
      if ! mv \
        "$TEMPORARY_ARTIFACT_DIRECTORY/$artifact_name" \
        "$ROOT_DIRECTORY/$artifact_name"; then
        publish_status=1
      fi
    fi
  done
  if ! rm -rf "$TEMPORARY_ARTIFACT_DIRECTORY"; then
    publish_status=1
  fi

  return "$publish_status"
}

# Функция вызывается через trap EXIT.
# shellcheck disable=SC2329
cleanup() {
  local exit_status=$?
  local cleanup_status=0
  trap - EXIT INT TERM

  if ! compose down --volumes --remove-orphans; then
    cleanup_status=1
  fi
  if ! publish_artifacts; then
    cleanup_status=1
  fi

  if [[ "$exit_status" -ne 0 ]]; then
    exit "$exit_status"
  fi
  exit "$cleanup_status"
}

if ! command -v flock >/dev/null 2>&1; then
  printf '%s\n' 'Для запуска browser-level тестов требуется flock' >&2
  exit 2
fi
exec 9>"$LOCK_FILE"
if ! flock --nonblock 9; then
  printf '%s\n' 'Browser-level тесты уже выполняются в этом checkout' >&2
  exit 2
fi

trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

compose down --volumes --remove-orphans >/dev/null 2>&1 || true
rm -rf \
  "$ROOT_DIRECTORY/playwright-report" \
  "$ROOT_DIRECTORY/test-results" \
  "$TEMPORARY_ARTIFACT_DIRECTORY"
mkdir -p "$TEMPORARY_ARTIFACT_DIRECTORY"

if compose up \
  --build \
  --abort-on-container-exit \
  --exit-code-from browser-tests; then
  test_exit_status=0
else
  test_exit_status=$?
fi

exit "$test_exit_status"
