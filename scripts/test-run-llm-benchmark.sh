#!/usr/bin/env bash

set -euo pipefail

ROOT_DIRECTORY=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)
TEST_DIR=$(mktemp -d)
FAKE_DOCKER_DIR="$TEST_DIR/fake-docker"
FAKE_DOCKER_BIN="$FAKE_DOCKER_DIR/docker"
FAKE_LOG="$TEST_DIR/docker-run-args.log"
mkdir -p "$ROOT_DIRECTORY/.tmp"
LAUNCHER_CONFIG_PATH="$(mktemp "$ROOT_DIRECTORY/.tmp/llm-benchmark.local-for-test.XXXXXX.json")"
CONFIG_PATH="${LAUNCHER_CONFIG_PATH#$ROOT_DIRECTORY/}"
LAUNCHER_REPORT_PATH="$ROOT_DIRECTORY/.tmp/llm-benchmark"

LAUNCHER_FOREIGN_REPORT_SENTINEL_PATH=
LAUNCHER_TEST_REPORT_ARTIFACT_PATH=
REPORT_DIRECTORY_CREATED_BY_TEST=false

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

assert_not_file_exists() {
  local path="$1"
  if [[ -e "$path" ]]; then
    fail "Expected file to not exist: $path"
  fi
}

assert_file_exists() {
  local path="$1"
  if [[ ! -e "$path" ]]; then
    fail "Expected file to exist: $path"
  fi
}

assert_contains_in_file() {
  local expected="$1"
  local path="$2"
  if ! rg -F -q -- "$expected" "$path"; then
    fail "Expected to find '$expected' in $path"
  fi
}

assert_not_contains_in_file() {
  local expected="$1"
  local path="$2"
  if rg -F -q -- "$expected" "$path"; then
    fail "Did not expect to find '$expected' in $path"
  fi
}

run_log() {
  local label="$1"
  printf 'Running scenario: %s\n' "$label"
}

cleanup() {
  cleanup_owned_artifacts
  final_teardown
  if [[ "$REPORT_DIRECTORY_CREATED_BY_TEST" == true ]]; then
    rmdir "$LAUNCHER_REPORT_PATH" 2>/dev/null || true
  fi
  rm -rf "$TEST_DIR"
}

cleanup_owned_artifacts() {
  rm -f "$LAUNCHER_CONFIG_PATH"
  rm -f "$LAUNCHER_TEST_REPORT_ARTIFACT_PATH"
}

final_teardown() {
  rm -f "$LAUNCHER_FOREIGN_REPORT_SENTINEL_PATH"
}

trap 'cleanup' EXIT

mkdir -p "$FAKE_DOCKER_DIR"
cat > "$FAKE_DOCKER_BIN" <<'EOT'
#!/usr/bin/env bash
set -euo pipefail

if [[ "$#" -lt 1 ]]; then
  echo 'missing docker command' >&2
  exit 1
fi

subcommand="$1"
case "$subcommand" in
  build)
    echo "build|$*" >> "$DOCKER_CALL_LOG"
    ;;
  run)
    echo "run|$*" >> "$DOCKER_CALL_LOG"
    ;;
  image)
    echo "image|$*" >> "$DOCKER_CALL_LOG"
    ;;
  *)
    echo "other|$*" >> "$DOCKER_CALL_LOG"
    ;;
esac
exit 0
EOT
chmod +x "$FAKE_DOCKER_BIN"

export PATH="$FAKE_DOCKER_DIR:$PATH"

if [[ ! -d "$LAUNCHER_REPORT_PATH" ]]; then
  mkdir -p "$LAUNCHER_REPORT_PATH"
  REPORT_DIRECTORY_CREATED_BY_TEST=true
else
  REPORT_DIRECTORY_CREATED_BY_TEST=false
fi

RUN_ID="$(date +%s%N)"
LAUNCHER_FOREIGN_REPORT_SENTINEL_PATH="$LAUNCHER_REPORT_PATH/.test-runner-foreign-sentinel-${RUN_ID}"
printf 'existing-report-data\n' > "$LAUNCHER_FOREIGN_REPORT_SENTINEL_PATH"
LAUNCHER_TEST_REPORT_ARTIFACT_PATH="$LAUNCHER_REPORT_PATH/.test-runner-owned-artifact-${RUN_ID}"
printf 'owned-artifact\n' > "$LAUNCHER_TEST_REPORT_ARTIFACT_PATH"

cat > "$LAUNCHER_CONFIG_PATH" <<'EOC'
{
  "protocol": "chat-completions",
  "chatCompletionsOutputTokenParameter": "max_tokens",
  "maxOutputTokens": 10,
  "models": [
    {
      "label": "benchmark-test",
      "modelId": "benchmark-test-model",
      "provider": "test",
      "price": {
        "currency": "RUB",
        "inputPerMillionTokens": 0,
        "outputPerMillionTokens": 0
      }
    }
  ]
}
EOC

run_launcher() {
  local scenario_label="$1"
  local api_url="$2"
  local api_key="$3"
  local auth_scheme="$4"
  local folder_id="${5:-}"
  shift 5
  local -a args=("$@")

  rm -f "$FAKE_LOG"
  run_log "$scenario_label"

  if [[ -n "$folder_id" ]]; then
    DOCKER_CALL_LOG="$FAKE_LOG" \
    LLM_API_URL="$api_url" \
    LLM_API_KEY="$api_key" \
    LLM_AUTH_SCHEME="$auth_scheme" \
    LLM_FOLDER_ID="$folder_id" \
    bash "$ROOT_DIRECTORY/scripts/run-llm-benchmark.sh" "${args[@]}"
  else
    env -u LLM_FOLDER_ID \
    DOCKER_CALL_LOG="$FAKE_LOG" \
    LLM_API_URL="$api_url" \
    LLM_API_KEY="$api_key" \
    LLM_AUTH_SCHEME="$auth_scheme" \
    bash "$ROOT_DIRECTORY/scripts/run-llm-benchmark.sh" "${args[@]}"
  fi
}

SYNTHETIC_API_URL='https://synthetic.invalid/provider-test'
SYNTHETIC_API_KEY='synthetic-secret-key-123'
SYNTHETIC_AUTH_SCHEME='Synthetic-Auth-Scheme'
SYNTHETIC_FOLDER_ID='synthetic-folder-id-456'

# Base forwarding + env forwarding without optional folder-id.
run_launcher \
  'base forwarding and safe env vars' \
  "$SYNTHETIC_API_URL" \
  "$SYNTHETIC_API_KEY" \
  "$SYNTHETIC_AUTH_SCHEME" \
  '' \
  --config "$CONFIG_PATH" \
  --scenario only-description \
  --limit 2 \
  --repeats 3 \
  --run

assert_contains_in_file "run|run" "$FAKE_LOG"
assert_contains_in_file "--rm" "$FAKE_LOG"
assert_contains_in_file "--env LLM_API_URL" "$FAKE_LOG"
assert_contains_in_file "--env LLM_API_KEY" "$FAKE_LOG"
assert_contains_in_file "--env LLM_AUTH_SCHEME" "$FAKE_LOG"
assert_not_contains_in_file "$SYNTHETIC_API_URL" "$FAKE_LOG"
assert_not_contains_in_file "$SYNTHETIC_API_KEY" "$FAKE_LOG"
assert_not_contains_in_file "$SYNTHETIC_AUTH_SCHEME" "$FAKE_LOG"
assert_not_contains_in_file "LLM_FOLDER_ID" "$FAKE_LOG"

assert_contains_in_file "--scenario only-description" "$FAKE_LOG"
assert_contains_in_file "--limit 2" "$FAKE_LOG"
assert_contains_in_file "--repeats 3" "$FAKE_LOG"
assert_contains_in_file "--run" "$FAKE_LOG"
assert_contains_in_file "--volume $LAUNCHER_CONFIG_PATH:/app/$CONFIG_PATH:ro" "$FAKE_LOG"
assert_contains_in_file "--volume $LAUNCHER_REPORT_PATH:/app/.tmp/llm-benchmark" "$FAKE_LOG"

# Optional LLM_FOLDER_ID is passed only when set.
run_launcher \
  'optional folder id passed as env name only' \
  "$SYNTHETIC_API_URL" \
  "$SYNTHETIC_API_KEY" \
  "$SYNTHETIC_AUTH_SCHEME" \
  "$SYNTHETIC_FOLDER_ID" \
  --config "$CONFIG_PATH" \
  --repeats 2

assert_contains_in_file "--env LLM_FOLDER_ID" "$FAKE_LOG"
assert_not_contains_in_file "$SYNTHETIC_FOLDER_ID" "$FAKE_LOG"

run_launcher \
  'optional folder id absent' \
  "$SYNTHETIC_API_URL" \
  "$SYNTHETIC_API_KEY" \
  "$SYNTHETIC_AUTH_SCHEME" \
  '' \
  --config "$CONFIG_PATH" \
  --limit 1 \
  --repeats 1

assert_not_contains_in_file "--env LLM_FOLDER_ID" "$FAKE_LOG"

SYNTHETIC_HOST_FOLDER_ID='synthetic-host-folder-id'
(
  export LLM_FOLDER_ID="$SYNTHETIC_HOST_FOLDER_ID"
  run_launcher \
  'optional folder id absent when inherited' \
  "$SYNTHETIC_API_URL" \
  "$SYNTHETIC_API_KEY" \
  "$SYNTHETIC_AUTH_SCHEME" \
  '' \
  --config "$CONFIG_PATH" \
  --limit 1 \
  --repeats 1
)

assert_not_contains_in_file "--env LLM_FOLDER_ID" "$FAKE_LOG"

cleanup_owned_artifacts
assert_not_file_exists "$LAUNCHER_TEST_REPORT_ARTIFACT_PATH"
assert_file_exists "$LAUNCHER_FOREIGN_REPORT_SENTINEL_PATH"

final_teardown
if [[ "$REPORT_DIRECTORY_CREATED_BY_TEST" == true ]]; then
  rmdir "$LAUNCHER_REPORT_PATH" 2>/dev/null || true
fi

printf 'Launcher regression checks passed\n'
