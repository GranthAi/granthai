# granthai-agent

API docs and an MCP server for **any** HTTP API — Python, Java, PHP, Go, Node, .NET — with one command and zero code changes.

```bash
npx granthai-agent --target 8000
```

```
  Proxy      http://localhost:4000  ->  http://localhost:8000
  API docs   http://localhost:4000/_granthai/api-docs
  OpenAPI    http://localhost:4000/_granthai/openapi.json
  MCP        http://localhost:4000/_granthai/mcp
```

Send your traffic to `:4000` instead of `:8000`. The agent forwards every request untouched and builds an OpenAPI 3.1 spec, Swagger UI and MCP tools from what it sees. Endpoints appear as soon as they are used.

Needs Node 18.17+ where the agent runs. Your app can be written in anything.

## Options

| Flag | Default | |
| --- | --- | --- |
| `-t, --target` | required | `8000`, `localhost:8000`, `http://api:8080`, `https://…` |
| `-p, --port` | `4000` | Port the agent listens on |
| `--host` | `127.0.0.1` | Use `0.0.0.0` in containers |
| `--title` | `API Documentation` | Docs title |
| `-o, --out` | `./granthai.openapi.json` | Spec file, reloaded on restart |
| `--route` | | Path template, repeatable: `"/users/{username}"`, `"/files/{path*}"`, or a prefix `"/repos/{owner}/{repo}/**"` |
| `--prefix` | `/_granthai` | Where the agent's own pages live |
| `--no-mcp` | | Disable the MCP endpoint |

Run `npx granthai-agent --help` for all options.

## Use with Claude / MCP clients

```bash
claude mcp add --transport http my-api http://localhost:4000/_granthai/mcp
```

Each endpoint becomes a tool (`GET /orders/{orderId}` → `get_orders_orderId`). `Authorization`, `Cookie`, CSRF and `X-API-Key` headers are forwarded to your API.

## Examples

Real open-source apps, run from their Docker images, with step-by-step READMEs:

- [Gitea (Go)](https://github.com/GranthAi/granthai/tree/main/packages/agent/examples/gitea-go)
- [Meilisearch (Rust)](https://github.com/GranthAi/granthai/tree/main/packages/agent/examples/meilisearch-rust)
- [Spring PetClinic REST (Java)](https://github.com/GranthAi/granthai/tree/main/packages/agent/examples/petclinic-java)

## Good to know

- IDs in paths (numbers, UUIDs, Mongo IDs, hashes) become parameters automatically: `/projects/42` → `/projects/{projectId}`. Use `--route` for slugs and usernames.
- Only schemas are stored, never values. No telemetry.
- Pages, scripts and images pass through without being recorded. WebSockets are tunnelled.
- The docs and MCP endpoints have no auth of their own — keep the agent on a trusted network.

## License

MIT
