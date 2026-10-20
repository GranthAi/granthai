#!/usr/bin/env bash
# Clones Worklenz (pinned), injects GranthAi, starts Postgres and installs/builds everything.
# Safe to re-run: each step is skipped when it has already been done.
set -euo pipefail

WORKLENZ_REPO="https://github.com/Worklenz/worklenz.git"
WORKLENZ_COMMIT="536b0ac1e74c094758f22d660b3dc3bcd33f89b2" # v3.2.1 images, 2026-10-19

EXAMPLE_DIR="$(cd "$(dirname "$0")" && pwd)"
GRANTHAI_DIR="$(cd "$EXAMPLE_DIR/../.." && pwd)"
CLONE_DIR="$EXAMPLE_DIR/worklenz"

step() { printf '\n\033[1;34m==> %s\033[0m\n' "$1"; }

step "Checking prerequisites"
node -e 'process.exit(+process.versions.node.split(".")[0] >= 20 ? 0 : 1)' || { echo "Node.js 20+ is required"; exit 1; }
docker info >/dev/null 2>&1 || { echo "Docker is not running (start Docker Desktop, colima, OrbStack, ...)"; exit 1; }
if [ ! -d "$GRANTHAI_DIR/node_modules/mixpanel" ]; then
	echo "Installing granthai's own dependencies"
	(cd "$GRANTHAI_DIR" && pnpm install)
fi

step "Cloning Worklenz @ ${WORKLENZ_COMMIT:0:8}"
if [ ! -d "$CLONE_DIR/.git" ]; then
	git init -q "$CLONE_DIR"
	git -C "$CLONE_DIR" remote add origin "$WORKLENZ_REPO"
	git -C "$CLONE_DIR" fetch -q --depth 1 origin "$WORKLENZ_COMMIT"
	git -C "$CLONE_DIR" checkout -q FETCH_HEAD
else
	echo "Already cloned"
fi

step "Injecting GranthAi into worklenz-backend/src/app.ts"
if git -C "$CLONE_DIR" apply --reverse --check "$EXAMPLE_DIR/granthai.patch" 2>/dev/null; then
	echo "Already injected"
else
	git -C "$CLONE_DIR" apply "$EXAMPLE_DIR/granthai.patch"
fi

step "Starting Postgres (docker compose, port 55432)"
docker compose -f "$EXAMPLE_DIR/docker-compose.yml" up -d --wait

step "Installing and building the backend"
cd "$CLONE_DIR/worklenz-backend"
[ -f .env ] || cp "$EXAMPLE_DIR/backend.env" .env
# Links this repo's granthai package, so edits to it show up after a backend restart
npm pkg set "dependencies.granthai=file:$GRANTHAI_DIR"
npm install --no-audit --no-fund
# npm 10 records a new file: link in the lockfile on a fresh install but only creates it on the next run
node -e 'require.resolve("granthai")' 2>/dev/null || npm install --no-audit --no-fund
node -e 'require.resolve("granthai")' || { echo "granthai is not linked into worklenz-backend"; exit 1; }
npm run build:dev
npm run migrate:up

step "Installing the frontend"
cd "$CLONE_DIR/worklenz-frontend"
if [ ! -f .env ]; then
	sed -e 's|^VITE_API_URL=.*|VITE_API_URL=http://localhost:3000|' \
		-e 's|^VITE_SOCKET_URL=.*|VITE_SOCKET_URL=ws://localhost:3000|' .env.example > .env
fi
npm install --no-audit --no-fund

step "Done. Next: see README.md, \"Run it\""
