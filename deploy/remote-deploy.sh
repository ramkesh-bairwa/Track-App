#!/usr/bin/env bash
# Runs ON THE SERVER (Jenkins uploads it to DEPLOY_DIR and calls it).
#
#   ./remote-deploy.sh <image-tag> [run-migrations: true|false]
#
# Expects in the same directory: docker-compose.yml and .env.
# The image mytrack:<image-tag> must already be loaded (`docker load`).
# Starts the new version, waits for its health check and, if it never turns
# healthy, puts the previous version back and exits non-zero.
set -euo pipefail

TAG="${1:?usage: remote-deploy.sh <image-tag> [run-migrations]}"
MIGRATE="${2:-false}"
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

COMPOSE="docker compose"
$COMPOSE version >/dev/null 2>&1 || COMPOSE="docker-compose"
CONTAINER=mytrack
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-120}"

[ -f .env ] || { echo "ERROR: $DIR/.env is missing"; exit 1; }
docker image inspect "mytrack:${TAG}" >/dev/null 2>&1 || { echo "ERROR: image mytrack:${TAG} is not loaded"; exit 1; }

PREVIOUS="$(cat .current_tag 2>/dev/null || true)"
echo "Deploying mytrack:${TAG} (previous: ${PREVIOUS:-none})"

if [ "$MIGRATE" = "true" ]; then
  echo "Running database migrations..."
  IMAGE_TAG="${TAG}" $COMPOSE run --rm --no-deps mytrack node scripts/migrate.js
fi

wait_healthy() {
  local waited=0 status
  while [ "$waited" -lt "$HEALTH_TIMEOUT" ]; do
    status="$(docker inspect --format '{{.State.Health.Status}}' "$CONTAINER" 2>/dev/null || echo missing)"
    case "$status" in
      healthy) return 0 ;;
      unhealthy) return 1 ;;
    esac
    sleep 3
    waited=$((waited + 3))
  done
  return 1
}

IMAGE_TAG="${TAG}" $COMPOSE up -d --remove-orphans

if wait_healthy; then
  echo "${TAG}" > .current_tag
  echo "${TAG}" >> .deploy_history
  [ -n "${PREVIOUS}" ] && [ "${PREVIOUS}" != "${TAG}" ] && echo "${PREVIOUS}" > .previous_tag
  echo "mytrack:${TAG} is healthy."
else
  echo "ERROR: mytrack:${TAG} did not become healthy. Last logs:"
  docker logs --tail 50 "$CONTAINER" 2>&1 || true
  if [ -n "${PREVIOUS}" ] && docker image inspect "mytrack:${PREVIOUS}" >/dev/null 2>&1; then
    echo "Rolling back to mytrack:${PREVIOUS}..."
    IMAGE_TAG="${PREVIOUS}" $COMPOSE up -d --remove-orphans
    wait_healthy && echo "Rolled back to mytrack:${PREVIOUS}." || echo "WARNING: rollback is not healthy either."
  fi
  exit 1
fi

# Remove older versions this script deployed; keep the running one and the
# one before it (for rollback). Images it never deployed are left alone.
KEEP="${TAG} $(cat .previous_tag 2>/dev/null || true)"
sort -u .deploy_history | while read -r t; do
  case " $KEEP " in *" $t "*) ;; *) docker rmi "mytrack:$t" >/dev/null 2>&1 || true ;; esac
done
printf '%s\n' $KEEP > .deploy_history
docker image prune -f >/dev/null 2>&1 || true
