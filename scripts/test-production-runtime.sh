#!/usr/bin/env bash

set -euo pipefail

ROOT_DIRECTORY=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
COMPOSE_FILE="$ROOT_DIRECTORY/compose.production.yaml"
COMPOSE_WRAPPER="$ROOT_DIRECTORY/scripts/production-compose.sh"
TEMP_DIRECTORY=$(mktemp -d -t uo-runtime-contract.XXXXXXXXXX)
TEST_ID=$(printf '%s' "$TEMP_DIRECTORY" | sha256sum | cut -c 1-12)
COMPOSE_PROJECT_NAME="uo-runtime-contract-${TEST_ID}"
PROXY_NETWORK="uo-runtime-proxy-${TEST_ID}"
FIRST_SHA="1111111111111111111111111111111111111111"
SECOND_SHA="2222222222222222222222222222222222222222"
FIRST_IMAGE="uo-request-generator-contract-${TEST_ID}:${FIRST_SHA}"
SECOND_IMAGE="uo-request-generator-contract-${TEST_ID}:${SECOND_SHA}"
CONTEXT_PROBE_IMAGE="uo-request-generator-context-probe-${TEST_ID}:${FIRST_SHA}"
PRODUCTION_ENV_FILE="$TEMP_DIRECTORY/.env.production"
COMPOSE_OUTPUT="$TEMP_DIRECTORY/compose.json"
CONTAINER_ID=""
FIRST_IMAGE_ID=""
SECOND_IMAGE_ID=""
NETWORK_CREATED=false

cleanup() {
  if [[ -f "$COMPOSE_FILE" && -n "${PRODUCTION_IMAGE:-}" ]]; then
    PRODUCTION_IMAGE="$PRODUCTION_IMAGE" \
      PRODUCTION_ENV_FILE="$PRODUCTION_ENV_FILE" \
      PRODUCTION_PROXY_NETWORK="$PROXY_NETWORK" \
      "$COMPOSE_WRAPPER" -p "$COMPOSE_PROJECT_NAME" down --remove-orphans \
      >/dev/null 2>&1 || true
  fi
  if [[ "$NETWORK_CREATED" == true ]]; then
    docker network rm "$PROXY_NETWORK" >/dev/null 2>&1 || true
  fi
  docker image rm "$CONTEXT_PROBE_IMAGE" "$SECOND_IMAGE" "$FIRST_IMAGE" \
    >/dev/null 2>&1 || true
  rm -rf "$TEMP_DIRECTORY"
}
trap cleanup EXIT

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

compose() {
  PRODUCTION_IMAGE="$PRODUCTION_IMAGE" \
    PRODUCTION_ENV_FILE="$PRODUCTION_ENV_FILE" \
    PRODUCTION_PROXY_NETWORK="$PROXY_NETWORK" \
    "$COMPOSE_WRAPPER" -p "$COMPOSE_PROJECT_NAME" "$@"
}

wait_until_healthy() {
  local deadline=$((SECONDS + 90))
  local status

  while ((SECONDS < deadline)); do
    status=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}' "$CONTAINER_ID")
    if [[ "$status" == "healthy" ]]; then
      return 0
    fi
    if [[ "$status" == "unhealthy" ]]; then
      compose logs --tail=100 request-generator >&2 || true
      fail "container became unhealthy"
    fi
    sleep 1
  done

  compose logs --tail=100 request-generator >&2 || true
  fail "container did not become healthy before timeout"
}

assert_container_image() {
  local expected_reference=$1
  local expected_image_id=$2
  local actual_reference
  local actual_image_id
  actual_reference=$(docker inspect --format '{{.Config.Image}}' "$CONTAINER_ID")
  actual_image_id=$(docker inspect --format '{{.Image}}' "$CONTAINER_ID")
  [[ "$actual_reference" == "$expected_reference" ]] || \
    fail "container uses an unexpected image reference"
  [[ "$actual_image_id" == "$expected_image_id" ]] || \
    fail "container uses an unexpected image ID"
}

printf 'Checking required Compose inputs...\n'
if env -u PRODUCTION_IMAGE \
  PRODUCTION_ENV_FILE="$PRODUCTION_ENV_FILE" \
  PRODUCTION_PROXY_NETWORK="$PROXY_NETWORK" \
  docker compose --env-file /dev/null -f "$COMPOSE_FILE" config --quiet \
  >"$TEMP_DIRECTORY/missing-image.log" 2>&1; then
  fail "docker compose config accepted a missing image reference"
fi

printf 'SMARTCAPTCHA_MODE=disabled\n' >"$PRODUCTION_ENV_FILE"
chmod 600 "$PRODUCTION_ENV_FILE"

PRODUCTION_IMAGE="$FIRST_IMAGE"
if env -u PRODUCTION_PROXY_NETWORK \
  PRODUCTION_IMAGE="$PRODUCTION_IMAGE" \
  PRODUCTION_ENV_FILE="$PRODUCTION_ENV_FILE" \
  docker compose --env-file /dev/null -f "$COMPOSE_FILE" config --quiet \
  >"$TEMP_DIRECTORY/missing-network.log" 2>&1; then
  fail "docker compose config accepted a missing proxy network"
fi

if PRODUCTION_IMAGE="$PRODUCTION_IMAGE" \
  PRODUCTION_ENV_FILE="$TEMP_DIRECTORY/missing.env" \
  PRODUCTION_PROXY_NETWORK="$PROXY_NETWORK" \
  docker compose --env-file /dev/null -f "$COMPOSE_FILE" config --quiet \
  >"$TEMP_DIRECTORY/missing-env.log" 2>&1; then
  fail "docker compose config accepted a missing production env file"
fi

if PRODUCTION_IMAGE="uo-request-generator-contract:latest" \
  PRODUCTION_ENV_FILE="$PRODUCTION_ENV_FILE" \
  PRODUCTION_PROXY_NETWORK="$PROXY_NETWORK" \
  "$COMPOSE_WRAPPER" config --quiet \
  >"$TEMP_DIRECTORY/floating-image.log" 2>&1; then
  fail "production wrapper accepted a floating image tag"
fi

cat >"$TEMP_DIRECTORY/override.yaml" <<'YAML'
services:
  request-generator:
    build: .
    image: alpine:latest
YAML
if PRODUCTION_IMAGE="$PRODUCTION_IMAGE" \
  PRODUCTION_ENV_FILE="$PRODUCTION_ENV_FILE" \
  PRODUCTION_PROXY_NETWORK="$PROXY_NETWORK" \
  "$COMPOSE_WRAPPER" -f "$TEMP_DIRECTORY/override.yaml" config --quiet \
  >"$TEMP_DIRECTORY/compose-override.log" 2>&1; then
  fail "production wrapper accepted a Compose file override"
fi
grep -q 'Overriding the production Compose file' \
  "$TEMP_DIRECTORY/compose-override.log" || \
  fail "Compose file override was rejected for an unexpected reason"

compose config --quiet
PRODUCTION_IMAGE="uo-request-generator-contract@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" \
  PRODUCTION_ENV_FILE="$PRODUCTION_ENV_FILE" \
  PRODUCTION_PROXY_NETWORK="$PROXY_NETWORK" \
  "$COMPOSE_WRAPPER" config --quiet
PRODUCTION_IMAGE="$FIRST_IMAGE"

PRODUCTION_IMAGE="$PRODUCTION_IMAGE" \
  PRODUCTION_ENV_FILE="$PRODUCTION_ENV_FILE" \
  PRODUCTION_PROXY_NETWORK="$PROXY_NETWORK" \
  docker compose --env-file /dev/null -f "$COMPOSE_FILE" config --format json >"$COMPOSE_OUTPUT"

COMPOSE_OUTPUT="$COMPOSE_OUTPUT" EXPECTED_IMAGE="$FIRST_IMAGE" EXPECTED_NETWORK="$PROXY_NETWORK" node <<'NODE'
const fs = require("node:fs");
const config = JSON.parse(fs.readFileSync(process.env.COMPOSE_OUTPUT, "utf8"));
const services = config.services ?? {};
const requestGenerator = services["request-generator"];
if (!requestGenerator || Object.keys(services).length !== 1 || "web" in services) throw new Error("expected exactly one request-generator service");
if ("build" in requestGenerator) throw new Error("production service must not contain build");
if ("ports" in requestGenerator) throw new Error("production service must not publish host ports");
if (requestGenerator.image !== process.env.EXPECTED_IMAGE) throw new Error("unexpected image reference");
if (!Array.isArray(requestGenerator.expose) || !requestGenerator.expose.includes("3000")) throw new Error("port 3000 must be exposed internally");
if (requestGenerator.restart !== "unless-stopped") throw new Error("unexpected restart policy");
if (requestGenerator.stop_grace_period !== "15s") throw new Error("stop_grace_period must be 15s");
if (requestGenerator.read_only !== true) throw new Error("root filesystem must be read-only");
if (requestGenerator.init !== true) throw new Error("Compose init must be enabled");
if (requestGenerator.user !== "node") throw new Error("service must run as node");
if (!Array.isArray(requestGenerator.cap_drop) || !requestGenerator.cap_drop.includes("ALL")) throw new Error("all capabilities must be dropped");
if (!Array.isArray(requestGenerator.security_opt) || !requestGenerator.security_opt.includes("no-new-privileges:true")) throw new Error("no-new-privileges must be enabled");
if (!Number.isSafeInteger(requestGenerator.pids_limit) || requestGenerator.pids_limit <= 0) throw new Error("positive pids_limit is required");
if ("mem_limit" in requestGenerator || "cpus" in requestGenerator) throw new Error("unmeasured resource limits must not be set");
if ("tmpfs" in requestGenerator) throw new Error("application does not require tmpfs");
const attachedNetworks = Object.keys(requestGenerator.networks ?? {});
if (attachedNetworks.length !== 1 || attachedNetworks[0] !== "reverse-proxy") throw new Error("service must use only the reverse-proxy network");
const network = config.networks?.["reverse-proxy"];
if (!network || network.external !== true || network.name !== process.env.EXPECTED_NETWORK) throw new Error("reverse-proxy network must be explicitly named and external");
if (!requestGenerator.healthcheck?.test?.join(" ").includes("/api/health")) throw new Error("healthcheck must use /api/health");
NODE

printf 'Checking that .env files are excluded from the build context...\n'
CONTEXT_PROBE_DIRECTORY="$TEMP_DIRECTORY/build-context"
mkdir "$CONTEXT_PROBE_DIRECTORY"
cp "$ROOT_DIRECTORY/.dockerignore" "$CONTEXT_PROBE_DIRECTORY/.dockerignore"
printf 'safe build-context file\n' >"$CONTEXT_PROBE_DIRECTORY/visible.txt"
printf 'placeholder only\n' >"$CONTEXT_PROBE_DIRECTORY/.env.production"
cat >"$CONTEXT_PROBE_DIRECTORY/Dockerfile" <<'DOCKERFILE'
FROM node:26.3.0-alpine
COPY . /context
RUN test -e /context/visible.txt && test ! -e /context/.env.production
DOCKERFILE
docker build --no-cache -t "$CONTEXT_PROBE_IMAGE" "$CONTEXT_PROBE_DIRECTORY" \
  >"$TEMP_DIRECTORY/build-context.log"
docker image rm "$CONTEXT_PROBE_IMAGE" >/dev/null

printf 'Building the production image...\n'
docker build --target runner -t "$FIRST_IMAGE" "$ROOT_DIRECTORY"
docker build \
  --target runner \
  --label io.github.uo-request-generator.runtime-contract=second \
  -t "$SECOND_IMAGE" \
  "$ROOT_DIRECTORY"

FIRST_IMAGE_ID=$(docker image inspect --format '{{.Id}}' "$FIRST_IMAGE")
SECOND_IMAGE_ID=$(docker image inspect --format '{{.Id}}' "$SECOND_IMAGE")
if [[ "$FIRST_IMAGE_ID" == "$SECOND_IMAGE_ID" ]]; then
  fail "test images must have different image IDs"
fi

if [[ -n "$(docker run --rm --user 0 --entrypoint find "$FIRST_IMAGE" / -name '.env*' -print -quit)" ]]; then
  fail ".env file found in the production image"
fi

printf 'Starting production Compose on an isolated network...\n'
docker network create --internal "$PROXY_NETWORK" >/dev/null
NETWORK_CREATED=true
compose up -d --no-build --pull never
CONTAINER_ID=$(compose ps -q request-generator)
[[ -n "$CONTAINER_ID" ]] || fail "request-generator container was not created"
wait_until_healthy
assert_container_image "$FIRST_IMAGE" "$FIRST_IMAGE_ID"

CONTAINER_ID="$CONTAINER_ID" EXPECTED_NETWORK="$PROXY_NETWORK" node <<'NODE'
const { execFileSync } = require("node:child_process");
const inspection = JSON.parse(execFileSync("docker", ["inspect", process.env.CONTAINER_ID], { encoding: "utf8" }))[0];
const host = inspection.HostConfig;
if (host.ReadonlyRootfs !== true) throw new Error("container root filesystem is writable");
if (host.Init !== true) throw new Error("container init is disabled");
if (inspection.Config.User !== "node") throw new Error("container is not running as node");
if (host.PortBindings && Object.keys(host.PortBindings).length !== 0) throw new Error("container publishes a host port");
if (!host.CapDrop?.includes("ALL")) throw new Error("container did not drop all capabilities");
if (!host.SecurityOpt?.includes("no-new-privileges:true")) throw new Error("container lacks no-new-privileges");
if (!(host.PidsLimit > 0)) throw new Error("container lacks a process limit");
const networks = Object.keys(inspection.NetworkSettings.Networks ?? {});
if (networks.length !== 1 || networks[0] !== process.env.EXPECTED_NETWORK) throw new Error("container joined an unexpected network");
NODE

if docker exec "$CONTAINER_ID" touch /tmp/runtime-contract-write-probe \
  >"$TEMP_DIRECTORY/read-only.log" 2>&1; then
  fail "container root filesystem accepted a write"
fi

docker run --rm --network "$PROXY_NETWORK" --entrypoint node "$FIRST_IMAGE" \
  -e "fetch('http://request-generator:3000/api/health').then(async response => { if (!response.ok || (await response.json()).status !== 'ok') process.exit(1) }).catch(() => process.exit(1))"
docker run --rm --network "$PROXY_NETWORK" --entrypoint node "$FIRST_IMAGE" \
  -e "fetch('http://request-generator:3000/vendor/bootstrap/bootstrap.min.css').then(async response => { const body = await response.text(); if (!response.ok || !response.headers.get('content-type')?.includes('text/css') || !/Bootstrap\\s+v5\\.3\\.8/.test(body)) process.exit(1) }).catch(() => process.exit(1))"
docker run --rm --network "$PROXY_NETWORK" --entrypoint node "$FIRST_IMAGE" \
  -e "fetch('http://request-generator:3000/api/generate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ description: 'Тестовое описание неисправности без персональных данных' }) }).then(async response => { const body = await response.json(); if (response.status !== 503 || body.error?.code !== 'generation_provider_unavailable') process.exit(1) }).catch(() => process.exit(1))"

printf 'Checking graceful SIGTERM and restart...\n'
compose stop request-generator
[[ "$(docker inspect --format '{{.State.ExitCode}}' "$CONTAINER_ID")" == "0" ]] || fail "container did not stop cleanly after SIGTERM"
compose up -d --no-build --pull never
CONTAINER_ID=$(compose ps -q request-generator)
wait_until_healthy
assert_container_image "$FIRST_IMAGE" "$FIRST_IMAGE_ID"

printf 'Replacing the full SHA image reference...\n'
PRODUCTION_IMAGE="$SECOND_IMAGE"
compose up -d --no-build --pull never --force-recreate
CONTAINER_ID=$(compose ps -q request-generator)
wait_until_healthy
assert_container_image "$SECOND_IMAGE" "$SECOND_IMAGE_ID"

printf 'Rolling back to the previous image reference...\n'
PRODUCTION_IMAGE="$FIRST_IMAGE"
compose up -d --no-build --pull never --force-recreate
CONTAINER_ID=$(compose ps -q request-generator)
wait_until_healthy
assert_container_image "$FIRST_IMAGE" "$FIRST_IMAGE_ID"

printf 'Production runtime contract checks passed.\n'
