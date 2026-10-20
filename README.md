# GranthAi

Automatic API documentation, generated from the traffic your API actually serves.

This monorepo holds every GranthAi project:

| Path | What it is | Published as |
| --- | --- | --- |
| [`packages/node`](packages/node) | Express middleware that generates an OpenAPI 3.1 description, Swagger UI at `/api-docs` and an MCP server at `/mcp-server` | [`granthai`](https://www.npmjs.com/package/granthai) on npm |
| [`packages/agent`](packages/agent) | Language-agnostic reverse proxy: put it in front of any HTTP API (Python, Java, PHP, Go, ...) with `npx granthai-agent --target 8000` and get the same docs and MCP server with no code changes | [`granthai-agent`](https://www.npmjs.com/package/granthai-agent) on npm |
| [`apps/web`](apps/web) | The [granthai.vercel.app](https://granthai.vercel.app) website (Next.js) | Deployed on Vercel |

SDKs for more languages (Python, Java, ...) will live alongside the Node package under `packages/`.

## Development

Requires Node 18+ and [pnpm](https://pnpm.io).

```bash
pnpm install        # install all workspace dependencies
pnpm dev:web        # run the website locally
pnpm build:web      # production build of the website
```

## Publishing the npm packages

Bump `version` in the package's `package.json`, commit, then from the repo root:

```bash
pnpm publish:node    # granthai
pnpm publish:agent   # granthai-agent
```

## License

[MIT](LICENSE)
