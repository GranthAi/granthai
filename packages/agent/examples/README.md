# granthai-agent examples

Each example runs a real open-source app from its official Docker image, unchanged, and puts `granthai-agent` in front of it. The agent only sees HTTP, so the app's language doesn't matter.

| Example | Language | App | Shows |
| --- | --- | --- | --- |
| [gitea-go](gitea-go) | Go | Gitea, a self-hosted Git service | `--route` with `/**` prefixes for `/{owner}/{repo}` URLs, Basic auth forwarded over MCP |
| [meilisearch-rust](meilisearch-rust) | Rust | Meilisearch search engine | Async `202` task APIs, Bearer auth forwarded over MCP |
| [petclinic-java](petclinic-java) | Java | Spring PetClinic REST | Zero config: numeric IDs detected automatically |

Every example has the same layout:

- `setup.sh` starts the app in Docker (`./setup.sh down` removes it)
- `traffic.sh` replays a realistic session through the agent with plain `curl`
- `README.md` walks through the steps, from running the agent to calling MCP tools from Claude

[`mcp.mjs`](mcp.mjs) is a small MCP client shared by all three: `node ../mcp.mjs watch | tools | call <tool> '<json>'`.

Working on the agent itself? Swap `npx granthai-agent` for `node ../../bin/granthai-agent.js` to run your local copy.
