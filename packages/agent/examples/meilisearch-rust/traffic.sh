#!/usr/bin/env bash
# Drives a typical Meilisearch workflow through the agent with plain curl: create an index,
# add documents, configure filters, search, fetch and delete documents, inspect tasks.
set -euo pipefail

AGENT="${AGENT_URL:-http://localhost:4000}"
KEY="granthai-demo-master-key-0123456789"

call() {
	local method="$1" path="$2" body="${3:-}"
	local args=(-s -X "$method" -H "authorization: Bearer $KEY" -H "accept: application/json" -w '\n%{http_code}')
	[ -n "$body" ] && args+=(-H "content-type: application/json" -d "$body")
	local out status
	out=$(curl "${args[@]}" "$AGENT$path")
	status="${out##*$'\n'}"
	printf '%-7s %-52s %s\n' "$method" "$path" "$status" >&2
	printf '%s' "${out%$'\n'*}"
}
# Reads a top-level field from a JSON response (node is already needed for the agent)
field() { node -e 'let d="";process.stdin.on("data",(c)=>(d+=c)).on("end",()=>console.log(JSON.parse(d)[process.argv[1]]))' "$1"; }
# Meilisearch applies writes asynchronously; wait until a task has finished
wait_task() {
	for _ in $(seq 1 30); do
		call GET "/tasks/$1" | grep -qE '"status":"(succeeded|failed)"' && return
		sleep 0.5
	done
}

call GET /health >/dev/null
call GET /version >/dev/null

TASK=$(call POST /indexes '{"uid":"movies","primaryKey":"id"}' | field taskUid)
wait_task "$TASK"
TASK=$(call POST /indexes/movies/documents '[
	{"id":1,"title":"Star Wars","year":1977,"genres":["sci-fi","adventure"],"rating":8.6},
	{"id":2,"title":"The Matrix","year":1999,"genres":["sci-fi","action"],"rating":8.7},
	{"id":3,"title":"Spirited Away","year":2001,"genres":["animation","fantasy"],"rating":8.6},
	{"id":4,"title":"Interstellar","year":2014,"genres":["sci-fi","drama"],"rating":8.7},
	{"id":5,"title":"Parasite","year":2019,"genres":["thriller","drama"],"rating":8.5}
]' | field taskUid)
wait_task "$TASK"
TASK=$(call PATCH /indexes/movies/settings '{"filterableAttributes":["genres","year"],"sortableAttributes":["year","rating"]}' | field taskUid)
wait_task "$TASK"

call POST /indexes/movies/search '{"q":"star","limit":5}' >/dev/null
call POST /indexes/movies/search '{"q":"","filter":"genres = sci-fi AND year > 1990","sort":["year:desc"],"facets":["genres"]}' >/dev/null
call GET "/indexes/movies/search?q=matrix" >/dev/null
call GET /indexes/movies/documents/2 >/dev/null
call GET "/indexes/movies/documents?limit=3&fields=title,year" >/dev/null
call GET /indexes/movies/settings >/dev/null
call GET /indexes/movies/stats >/dev/null
call GET /indexes >/dev/null
call GET /stats >/dev/null
TASK=$(call DELETE /indexes/movies/documents/5 | field taskUid)
wait_task "$TASK"
call GET "/tasks?limit=5" >/dev/null
call GET /keys >/dev/null

echo "Done: index movies with 4 documents. Open $AGENT/_granthai/api-docs" >&2
