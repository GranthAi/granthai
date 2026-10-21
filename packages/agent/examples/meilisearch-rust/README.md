# granthai-agent + Meilisearch (Rust)

[Meilisearch](https://github.com/meilisearch/meilisearch) is a fast search engine written in **Rust**, with a JSON REST API for indexes, documents, settings, search and async tasks.

Here you run the official Meilisearch Docker image unchanged, put `granthai-agent` in front of it, and watch an OpenAPI spec and MCP tools build up from real API calls. With the MCP server, an AI agent can search your index and manage documents.

```
curl / SDK ──► :4000 granthai-agent ──► :7700 Meilisearch (Rust)
                    │
                    ├─ /_granthai/api-docs   Swagger UI
                    └─ /_granthai/mcp        MCP tools
```

## Prerequisites

- Docker running (Docker Desktop, colima, OrbStack, ...)
- Node.js 18.17+ (for the agent and the MCP client)
- Free ports `7700` (Meilisearch) and `4000` (agent)

## 1. Start Meilisearch

```bash
cd packages/agent/examples/meilisearch-rust
./setup.sh
```

This runs `getmeili/meilisearch:v1.20` on http://localhost:7700 with the master key `granthai-demo-master-key-0123456789`. Running it again is safe.

## 2. Start the agent

```bash
npx granthai-agent --target 7700 --title "Meilisearch API" --route "/indexes/{indexUid}/**"
```

Index names like `movies` look like ordinary words, so `--route` names that segment. The `/**` suffix leaves the rest of the path to automatic detection, so `/documents/2` still becomes `/documents/{documentId}`.

## 3. Send traffic through the agent

In a second terminal, watch MCP tools appear:

```bash
node ../mcp.mjs watch
```

In a third, replay a typical session with curl: create a `movies` index, add five films, make `genres` and `year` filterable, run searches with filters, sorting and facets, fetch and delete documents, and check tasks.

```bash
./traffic.sh
```

```
POST    /indexes                                             202
GET     /tasks/0                                             200
POST    /indexes/movies/documents                            202
PATCH   /indexes/movies/settings                             202
POST    /indexes/movies/search                               200
GET     /indexes/movies/documents/2                          200
DELETE  /indexes/movies/documents/5                          202
...
```

To use your own app or a Meilisearch SDK instead, point it at `http://localhost:4000`. Then open **http://localhost:4000/_granthai/api-docs**:

```
POST   /indexes
GET    /tasks/{taskId}
POST   /indexes/{indexUid}/documents
PATCH  /indexes/{indexUid}/settings
POST   /indexes/{indexUid}/search
GET    /indexes/{indexUid}/documents/{documentId}
DELETE /indexes/{indexUid}/documents/{documentId}
...
```

Request and response schemas are inferred from the real payloads, including the `202` task responses Meilisearch returns for writes.

## 4. Talk to the MCP server

The agent forwards the `Authorization` header from the MCP request to Meilisearch, so pass the key:

```bash
export MCP_AUTH="Bearer granthai-demo-master-key-0123456789"

node ../mcp.mjs tools
node ../mcp.mjs call post_indexes_indexUid_search \
  '{"indexUid":"movies","body":{"q":"","filter":"year < 2000","sort":["year:asc"]}}'
```

```
HTTP 200 OK

{"hits":[{"id":1,"title":"Star Wars","year":1977,...},{"id":2,"title":"The Matrix","year":1999,...}],...}
```

Without the header, Meilisearch rejects the call with `401`. The agent never bypasses the app's auth.

With Claude Code:

```bash
claude mcp add --transport http meilisearch http://localhost:4000/_granthai/mcp \
  --header "Authorization: $MCP_AUTH"
```

Then ask *"Which sci-fi movies from after 1990 are in my index?"* or *"Add Arrival (2016, sci-fi, 7.9) to movies."*

## Clean up

```bash
# stop the agent with Ctrl+C, then:
./setup.sh down
rm -f granthai.openapi.json
```
