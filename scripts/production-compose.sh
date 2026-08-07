#!/bin/sh

set -eu

unset CDPATH
SCRIPT_DIRECTORY=$(cd -- "$(dirname -- "$0")" && pwd)
COMPOSE_FILE="$SCRIPT_DIRECTORY/../compose.production.yaml"
IMAGE_NAME_PATTERN='[a-z0-9]+([._-][a-z0-9]+)*(:[0-9]+)?(/[a-z0-9]+([._-][a-z0-9]+)*)*'

if [ -z "${PRODUCTION_IMAGE:-}" ]; then
  printf '%s\n' 'PRODUCTION_IMAGE is required' >&2
  exit 2
fi

if ! printf '%s\n' "$PRODUCTION_IMAGE" | grep -Eq '^[^[:space:]]+$'; then
  printf '%s\n' 'PRODUCTION_IMAGE must not contain whitespace' >&2
  exit 2
fi

for argument in "$@"; do
  case "$argument" in
    -f | -f?* | --file | --file=*)
      printf '%s\n' 'Overriding the production Compose file is not allowed' >&2
      exit 2
      ;;
  esac
done

if printf '%s\n' "$PRODUCTION_IMAGE" | grep -Eq \
  "^${IMAGE_NAME_PATTERN}:[0-9a-f]{40}$|^${IMAGE_NAME_PATTERN}@sha256:[0-9a-f]{64}$"; then
  exec docker compose --env-file /dev/null -f "$COMPOSE_FILE" "$@"
fi

printf '%s\n' \
  'PRODUCTION_IMAGE must use a full lowercase commit SHA tag or sha256 digest' >&2
exit 2
