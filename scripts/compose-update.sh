#!/usr/bin/env sh
set -eu

SERVICE="${SERVICE:-proxy}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yaml}"
WAIT_SECONDS="${WAIT_SECONDS:-120}"

if docker compose version >/dev/null 2>&1; then
    COMPOSE_IMPL="v2"
    compose() {
        docker compose -f "$COMPOSE_FILE" "$@"
    }
elif command -v docker-compose >/dev/null 2>&1; then
    COMPOSE_IMPL="v1"
    compose() {
        docker-compose -f "$COMPOSE_FILE" "$@"
    }
else
    echo "Docker Compose is not installed. Install Docker Compose v2 or docker-compose v1." >&2
    exit 1
fi

echo "Using Docker Compose ${COMPOSE_IMPL}"

if [ ! -f "$COMPOSE_FILE" ]; then
    echo "Compose file not found: ${COMPOSE_FILE}" >&2
    exit 1
fi

compose pull "$SERVICE"
compose up -d db

if [ "$COMPOSE_IMPL" = "v1" ]; then
    ids="$(compose ps -q "$SERVICE" 2>/dev/null || true)"
    if [ -n "$ids" ]; then
        echo "Legacy docker-compose v1 detected; recreating only ${SERVICE} to avoid the ContainerConfig bug."
        docker rm -f $ids >/dev/null
    fi
fi

compose up -d "$SERVICE"

container_id="$(compose ps -q "$SERVICE" 2>/dev/null || true)"
if [ -z "$container_id" ]; then
    echo "Could not find ${SERVICE} container after startup." >&2
    compose ps
    exit 1
fi

elapsed=0
while [ "$elapsed" -lt "$WAIT_SECONDS" ]; do
    state="$(docker inspect -f '{{.State.Status}}' "$container_id" 2>/dev/null || echo unknown)"
    health="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$container_id" 2>/dev/null || echo unknown)"

    if [ "$health" = "healthy" ] || { [ "$health" = "none" ] && [ "$state" = "running" ]; }; then
        echo "${SERVICE} is ${health} (${state})."
        compose ps
        exit 0
    fi

    if [ "$state" = "exited" ] || [ "$health" = "unhealthy" ]; then
        echo "${SERVICE} failed to start: state=${state}, health=${health}" >&2
        docker logs --tail=120 "$container_id" >&2 || true
        exit 1
    fi

    sleep 2
    elapsed=$((elapsed + 2))
done

echo "Timed out waiting for ${SERVICE} health after ${WAIT_SECONDS}s." >&2
compose ps >&2 || true
docker logs --tail=120 "$container_id" >&2 || true
exit 1
