#!/usr/bin/env bash
set -Eeuo pipefail

readonly REVISION="${1:?usage: deploy-tailor <git-revision>}"
readonly APP_ROOT=/opt/workspace/apps/tailor
readonly SOURCE_ROOT="$APP_ROOT/source"
readonly REPOSITORY=https://github.com/Bukunmi2108/tailor.git

mkdir -p "$APP_ROOT"
if [[ ! -d "$SOURCE_ROOT/.git" ]]; then
  git clone "$REPOSITORY" "$SOURCE_ROOT"
fi

git -C "$SOURCE_ROOT" fetch --prune origin
git -C "$SOURCE_ROOT" checkout --detach "$REVISION"

TAILOR_IMAGE_TAG="$REVISION" docker compose \
  --project-directory "$APP_ROOT" \
  -f "$SOURCE_ROOT/deploy/compose.production.yaml" \
  up -d --build --remove-orphans

healthy=false
for _ in {1..24}; do
  if [[ "$(docker inspect --format '{{.State.Health.Status}}' workspace-tailor 2>/dev/null)" == "healthy" ]]; then
    healthy=true
    break
  fi
  sleep 5
done

if [[ "$healthy" != true ]]; then
  docker logs --tail 100 workspace-tailor >&2
  exit 1
fi

docker image prune -f --filter "until=168h"
