#!/usr/bin/env bash
# Runs Meilisearch (Rust) in Docker on :7700 with a master key.
#   ./setup.sh        start (safe to re-run)
#   ./setup.sh down   stop and delete the container and its data
set -euo pipefail

IMAGE="getmeili/meilisearch:v1.20"
NAME="granthai-meilisearch"
PORT="${MEILI_PORT:-7700}"
MASTER_KEY="granthai-demo-master-key-0123456789"

step() { printf '\n\033[1;34m==> %s\033[0m\n' "$1"; }

if [ "${1:-}" = "down" ]; then
	docker rm -f "$NAME" >/dev/null 2>&1 && echo "Removed $NAME" || echo "$NAME is not running"
	exit 0
fi

docker info >/dev/null 2>&1 || { echo "Docker is not running (start Docker Desktop, colima, OrbStack, ...)"; exit 1; }

step "Starting $IMAGE on http://localhost:$PORT"
if docker container inspect "$NAME" >/dev/null 2>&1; then
	docker start "$NAME" >/dev/null
	echo "Already created, started it"
else
	docker run -d --name "$NAME" -p "$PORT:7700" \
		-e MEILI_MASTER_KEY="$MASTER_KEY" \
		-e MEILI_NO_ANALYTICS=true \
		"$IMAGE" >/dev/null
fi

step "Waiting for Meilisearch"
for _ in $(seq 1 60); do
	curl -fs "http://localhost:$PORT/health" >/dev/null && break
	sleep 1
done
curl -fs "http://localhost:$PORT/health" || { echo "Meilisearch did not start, see: docker logs $NAME"; exit 1; }
echo

step "Done. Next: start the agent (README.md, step 2)"
