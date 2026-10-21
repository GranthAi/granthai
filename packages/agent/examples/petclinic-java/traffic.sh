#!/usr/bin/env bash
# Drives a typical PetClinic workflow through the agent with plain curl: browse vets and owners,
# register an owner and their pet, book a visit, update and clean up.
set -euo pipefail

AGENT="${AGENT_URL:-http://localhost:4000}"
API="/petclinic/api"

call() {
	local method="$1" path="$2" body="${3:-}"
	local args=(-s -X "$method" -H "accept: application/json" -w '\n%{http_code}')
	[ -n "$body" ] && args+=(-H "content-type: application/json" -d "$body")
	local out status
	out=$(curl "${args[@]}" "$AGENT$API$path")
	status="${out##*$'\n'}"
	printf '%-7s %-52s %s\n' "$method" "$API$path" "$status" >&2
	printf '%s' "${out%$'\n'*}"
}
# Reads a top-level field from a JSON response (node is already needed for the agent)
field() { node -e 'let d="";process.stdin.on("data",(c)=>(d+=c)).on("end",()=>console.log(JSON.parse(d)[process.argv[1]]))' "$1"; }

call GET /pettypes >/dev/null
call GET /specialties >/dev/null
call GET /vets >/dev/null
call GET /vets/1 >/dev/null
call GET /owners >/dev/null
call GET "/owners?lastName=Davis" >/dev/null
call GET /owners/1 >/dev/null

OWNER=$(call POST /owners '{"firstName":"Ada","lastName":"Lovelace","address":"12 St James Square","city":"London","telephone":"0207946000"}' | field id)
call PUT "/owners/$OWNER" '{"firstName":"Ada","lastName":"Lovelace","address":"12 St James Square","city":"London","telephone":"0207946001"}' >/dev/null
PET=$(call POST "/owners/$OWNER/pets" '{"name":"Babbage","birthDate":"2021-03-14","type":{"id":2,"name":"dog"}}' | field id)
call GET "/owners/$OWNER/pets/$PET" >/dev/null
VISIT=$(call POST "/owners/$OWNER/pets/$PET/visits" '{"date":"2026-11-02","description":"Annual vaccination"}' | field id)
call GET "/visits/$VISIT" >/dev/null
call GET /visits >/dev/null
call GET "/pets/$PET" >/dev/null
call GET /pets >/dev/null
call DELETE "/visits/$VISIT" >/dev/null

echo "Done: owner $OWNER with pet $PET. Open $AGENT/_granthai/api-docs" >&2
