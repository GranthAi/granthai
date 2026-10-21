#!/usr/bin/env bash
# Runs Gitea (Go) in Docker on :3100 and creates an admin user to drive its API with.
#   ./setup.sh        start (safe to re-run)
#   ./setup.sh down   stop and delete the container and its data
set -euo pipefail

IMAGE="gitea/gitea:1.25"
NAME="granthai-gitea"
PORT="${GITEA_PORT:-3100}"
USERNAME="ada"
PASSWORD="Granth@i-Demo-2026"

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
	# INSTALL_LOCK skips the web installer; SQLite keeps it to a single container
	docker run -d --name "$NAME" -p "$PORT:3000" \
		-e GITEA__security__INSTALL_LOCK=true \
		-e GITEA__database__DB_TYPE=sqlite3 \
		-e GITEA__server__ROOT_URL="http://localhost:$PORT/" \
		"$IMAGE" >/dev/null
fi

step "Waiting for Gitea"
for _ in $(seq 1 60); do
	curl -fs "http://localhost:$PORT/api/v1/version" >/dev/null && break
	sleep 1
done
curl -fs "http://localhost:$PORT/api/v1/version" || { echo "Gitea did not start, see: docker logs $NAME"; exit 1; }
echo

step "Creating admin user $USERNAME"
if curl -fs -u "$USERNAME:$PASSWORD" "http://localhost:$PORT/api/v1/user" >/dev/null; then
	echo "Already exists"
else
	docker exec -u git "$NAME" gitea admin user create --admin --username "$USERNAME" --password "$PASSWORD" \
		--email ada@example.com --must-change-password=false
fi

step "Done. Next: start the agent (README.md, step 2)"
