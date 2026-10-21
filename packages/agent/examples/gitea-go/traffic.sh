#!/usr/bin/env bash
# Drives a typical Gitea workflow through the agent with plain curl: create a repo, label,
# issues, comments, close an issue, search. Every call goes to the agent, never to :3100.
set -euo pipefail

AGENT="${AGENT_URL:-http://localhost:4000}"
AUTH="ada:Granth@i-Demo-2026"
REPO="demo-$(date +%s)"

call() {
	local method="$1" path="$2" body="${3:-}"
	local args=(-s -u "$AUTH" -X "$method" -H "accept: application/json" -w '\n%{http_code}')
	[ -n "$body" ] && args+=(-H "content-type: application/json" -d "$body")
	local out status
	out=$(curl "${args[@]}" "$AGENT$path")
	status="${out##*$'\n'}"
	printf '%-7s %-58s %s\n' "$method" "$path" "$status" >&2
	printf '%s' "${out%$'\n'*}"
}
# Reads a top-level field from a JSON response (node is already needed for the agent)
field() { node -e 'let d="";process.stdin.on("data",(c)=>(d+=c)).on("end",()=>console.log(JSON.parse(d)[process.argv[1]]))' "$1"; }

call GET /api/v1/version >/dev/null
call GET /api/v1/user >/dev/null
call GET /api/v1/settings/api >/dev/null
call POST /api/v1/user/repos "{\"name\":\"$REPO\",\"description\":\"Created through granthai-agent\",\"auto_init\":true}" >/dev/null
call GET "/api/v1/repos/ada/$REPO" >/dev/null
call GET "/api/v1/repos/ada/$REPO/branches" >/dev/null
call GET "/api/v1/repos/ada/$REPO/contents/README.md" >/dev/null

LABEL=$(call POST "/api/v1/repos/ada/$REPO/labels" '{"name":"bug","color":"#ee0701"}' | field id)
call POST "/api/v1/repos/ada/$REPO/issues" '{"title":"Search is slow","body":"Takes 3s on large repos"}' >/dev/null
call POST "/api/v1/repos/ada/$REPO/issues" '{"title":"Typo in README"}' >/dev/null
call GET "/api/v1/repos/ada/$REPO/issues?state=open&page=1&limit=10" >/dev/null
call GET "/api/v1/repos/ada/$REPO/issues/1" >/dev/null
call POST "/api/v1/repos/ada/$REPO/issues/1/labels" "{\"labels\":[$LABEL]}" >/dev/null
call POST "/api/v1/repos/ada/$REPO/issues/1/comments" '{"body":"Reproduced on 1.25"}' >/dev/null
call GET "/api/v1/repos/ada/$REPO/issues/1/comments" >/dev/null
call PATCH "/api/v1/repos/ada/$REPO/issues/2" '{"state":"closed"}' >/dev/null
call GET "/api/v1/repos/search?q=demo&limit=5" >/dev/null
call GET /api/v1/users/ada >/dev/null
call GET /api/v1/users/ada/repos >/dev/null

echo "Done: repo ada/$REPO with 2 issues. Open $AGENT/_granthai/api-docs" >&2
