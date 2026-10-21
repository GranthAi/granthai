#!/usr/bin/env bash
# Runs Spring PetClinic REST (Java, Spring Boot) in Docker on :9966 with its in-memory database.
#   ./setup.sh        start (safe to re-run)
#   ./setup.sh down   stop and delete the container and its data
set -euo pipefail

IMAGE="springcommunity/spring-petclinic-rest:4.0.2"
NAME="granthai-petclinic"
PORT="${PETCLINIC_PORT:-9966}"

step() { printf '\n\033[1;34m==> %s\033[0m\n' "$1"; }

if [ "${1:-}" = "down" ]; then
	docker rm -f "$NAME" >/dev/null 2>&1 && echo "Removed $NAME" || echo "$NAME is not running"
	exit 0
fi

docker info >/dev/null 2>&1 || { echo "Docker is not running (start Docker Desktop, colima, OrbStack, ...)"; exit 1; }

step "Starting $IMAGE on http://localhost:$PORT/petclinic"
if docker container inspect "$NAME" >/dev/null 2>&1; then
	docker start "$NAME" >/dev/null
	echo "Already created, started it"
else
	# The image is amd64 only; Apple Silicon runs it under emulation, which is slower to boot
	docker run -d --name "$NAME" --platform linux/amd64 -p "$PORT:9966" "$IMAGE" >/dev/null
fi

step "Waiting for PetClinic (up to 3 minutes under emulation)"
for _ in $(seq 1 180); do
	curl -fs "http://localhost:$PORT/petclinic/api/pettypes" >/dev/null && break
	sleep 1
done
curl -fs -o /dev/null "http://localhost:$PORT/petclinic/api/pettypes" || { echo "PetClinic did not start, see: docker logs $NAME"; exit 1; }
echo "PetClinic is up"

step "Done. Next: start the agent (README.md, step 2)"
