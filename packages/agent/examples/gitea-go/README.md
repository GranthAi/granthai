# granthai-agent + Gitea (Go)

[Gitea](https://github.com/go-gitea/gitea) is a self-hosted Git service (a GitHub alternative) written in **Go**: repositories, issues, pull requests, labels, users, orgs. Its REST API lives under `/api/v1`.

Here you run the official Gitea Docker image unchanged, put `granthai-agent` in front of it, and watch an OpenAPI spec and MCP tools build up from real API calls. Nothing in Gitea is modified.

```
curl / browser ──► :4000 granthai-agent ──► :3100 Gitea (Go)
                        │
                        ├─ /_granthai/api-docs   Swagger UI
                        └─ /_granthai/mcp        MCP tools
```

## Prerequisites

- Docker running (Docker Desktop, colima, OrbStack, ...)
- Node.js 18.17+ (for the agent and the MCP client)
- Free ports `3100` (Gitea) and `4000` (agent)

## 1. Start Gitea

```bash
cd packages/agent/examples/gitea-go
./setup.sh
```

This runs `gitea/gitea:1.25` with SQLite on http://localhost:3100, skips the install wizard and creates an admin user `ada` / `Granth@i-Demo-2026`. Running it again is safe.

## 2. Start the agent

```bash
npx granthai-agent --target 3100 --title "Gitea API" \
  --route "/api/v1/repos/{owner}/{repo}/contents/{filepath*}" \
  --route "/api/v1/repos/{owner}/{repo}/**" \
  --route "/api/v1/users/{username}/**"
```

Gitea's URLs contain names (`/repos/ada/my-repo/...`) that look like ordinary words, so the agent can't detect them on its own. The `--route` flags name them:

- `{filepath*}` matches across slashes (`docs/guide/intro.md`).
- A route ending in `/**` templates the prefix and leaves the rest to the automatic detection. Issue numbers and other IDs after it still become parameters (`/issues/3` → `/issues/{issueId}`).

## 3. Send traffic through the agent

In a second terminal, watch MCP tools appear:

```bash
node ../mcp.mjs watch
```

In a third, replay a typical session with curl: create a repo, a label and two issues, comment, close an issue, search.

```bash
./traffic.sh
```

```
GET     /api/v1/version                                            200
POST    /api/v1/user/repos                                         201
POST    /api/v1/repos/ada/demo-1792565903/labels                   201
POST    /api/v1/repos/ada/demo-1792565903/issues                   201
GET     /api/v1/repos/ada/demo-1792565903/issues?state=open&page=1&limit=10 200
POST    /api/v1/repos/ada/demo-1792565903/issues/1/comments        201
PATCH   /api/v1/repos/ada/demo-1792565903/issues/2                 201
...
```

You can also use the Gitea UI and API through the agent at http://localhost:4000. Then open **http://localhost:4000/_granthai/api-docs**:

```
GET    /api/v1/repos/{owner}/{repo}
GET    /api/v1/repos/{owner}/{repo}/contents/{filepath}
POST   /api/v1/repos/{owner}/{repo}/issues
GET    /api/v1/repos/{owner}/{repo}/issues
GET    /api/v1/repos/{owner}/{repo}/issues/{issueId}
PATCH  /api/v1/repos/{owner}/{repo}/issues/{issueId}
POST   /api/v1/repos/{owner}/{repo}/issues/{issueId}/comments
GET    /api/v1/users/{username}
...
```

Request and response schemas are inferred from the real payloads.

## 4. Talk to the MCP server

Gitea accepts Basic auth. The agent forwards the `Authorization` header from the MCP request to Gitea, so tools run as `ada`:

```bash
export MCP_AUTH="Basic $(printf 'ada:Granth@i-Demo-2026' | base64)"

node ../mcp.mjs tools
node ../mcp.mjs call get_api_v1_repos_owner_repo_issues '{"owner":"ada","repo":"<repo from traffic.sh>","state":"open"}'
node ../mcp.mjs call post_api_v1_repos_owner_repo_issues \
  '{"owner":"ada","repo":"<repo>","body":{"title":"Filed by an AI agent over MCP"}}'
```

The new issue shows up at http://localhost:3100/ada/<repo>/issues.

With Claude Code:

```bash
claude mcp add --transport http gitea http://localhost:4000/_granthai/mcp \
  --header "Authorization: $MCP_AUTH"
```

Then ask *"List the open issues in my newest Gitea repo and file one called 'Write release notes'."*

## Clean up

```bash
# stop the agent with Ctrl+C, then:
./setup.sh down
rm -f granthai.openapi.json
```
