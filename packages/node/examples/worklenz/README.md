# GranthAi + Worklenz (open-source Jira / Asana alternative)

[Worklenz](https://github.com/Worklenz/worklenz) is a production project-management platform: projects, tasks, sub-tasks, kanban boards, sprints/phases, comments, time logs, reporting, Gantt. Its backend is a large Express + PostgreSQL app with ~60 API routers, which makes it a realistic place to see GranthAi at work:

- every API call the app makes is documented live at **`/api-docs`** (OpenAPI 3.1)
- every documented endpoint becomes an **MCP tool** at **`/mcp-server`**, so an AI agent can read and file tickets through Worklenz's real API, as the logged-in user

Nothing is mocked. You run the real Worklenz backend and web app locally, with GranthAi injected as one middleware.

## Prerequisites

- Node.js 20+, git, pnpm
- Docker running (Docker Desktop, colima, OrbStack, ...) for PostgreSQL
- Free ports: `3000` (backend), `5173` (web app), `55432` (Postgres)
- About 2 GB of disk and ~5 minutes for the first setup

## 1. Set up

```bash
cd packages/node/examples/worklenz
./setup.sh
```

`setup.sh` is idempotent and does exactly what you would do by hand:

| Step | What happens |
|---|---|
| Clone | Worklenz is cloned into `./worklenz`, pinned to a known commit. The folder is gitignored, never committed here |
| Inject | `granthai.patch` is applied to `worklenz-backend/src/app.ts` (see below) |
| Database | `docker compose up` starts Postgres 15 and loads Worklenz's schema from the clone |
| Backend | `.env` is copied from `backend.env`, dependencies installed, **this repo's** `granthai` linked in (`npm install granthai@file:../../..`), built, migrations run |
| Frontend | `.env` pointed at `http://localhost:3000`, dependencies installed |

### How GranthAi is injected

The whole integration is one middleware in `worklenz-backend/src/app.ts` (from `granthai.patch`), right after the body parsers:

```ts
app.use(express.urlencoded({ extended: false, limit: "50mb" }));

const GranthAi = require("granthai");
app.use(GranthAi({
  docTitle: "Worklenz API",
  baseUrl: process.env.GRANTHAI_BASE_URL || `http://localhost:${process.env.PORT || 3000}`,
}));

app.use(cookieParser(process.env.COOKIE_SECRET));
// ... Worklenz's session, passport, CSRF, routes
```

It sits **before** Worklenz's session and CSRF middleware so `/mcp-server` and `/api-docs` are reachable. Auth isn't bypassed, though. Each MCP tool call is a normal HTTP request to Worklenz, carrying the caller's `Cookie` and `X-CSRF-Token`, so Worklenz checks it like any other request.

## 2. Run it

Use three terminals, all from `packages/node/examples/worklenz`:

```bash
# Terminal 1: Worklenz backend with GranthAi (http://localhost:3000)
cd worklenz/worklenz-backend && npm start

# Terminal 2: Worklenz web app (http://localhost:5173)
cd worklenz/worklenz-frontend && npm start

# Terminal 3: watch MCP tools appear as endpoints get used
node scripts/mcp.mjs watch
```

At this point `watch` shows a single tool. GranthAi only knows endpoints that have handled a request, and the backend just started.

## 3. Use the app and watch the API populate

Open http://localhost:5173, sign up (any email works; there's no email verification locally), finish the setup wizard, then create a project, add tasks, open a task and comment, switch to the board view, and so on. Terminal 3 shows each endpoint the moment the UI first calls it:

```
7:25:16 PM  +  1  get_csrf-token                              GET /csrf-token
7:25:26 PM  +  2  get_secure_verify                           GET /secure/verify
7:25:42 PM  +  3  get_api_v1_project-statuses                 GET /api/v1/project-statuses
7:25:42 PM  +  4  get_api_v1_statuses_categories              GET /api/v1/statuses/categories
7:25:42 PM  +  5  get_api_v1_task-time-log_running-timers     GET /api/v1/task-time-log/running-timers
...
```

Refresh **http://localhost:3000/api-docs** as you go. It's GranthAi's Swagger UI, built from that traffic, with request/response schemas inferred from real payloads and path params like `/api/v1/projects/{id}` detected from Express routes. (Worklenz ships a handwritten spec at `worklenz-backend/src/docs/openapi.yaml`. GranthAi takes over the `/api-docs` route, so you can compare the two.)

Prefer the terminal? `scripts/traffic.mjs` replays a typical session through the API: sign up as `ada@example.com`, look around the workspace, create a project, file three tasks, comment, add a label, open the board and list views:

```bash
node scripts/traffic.mjs
```

It also saves the session cookie and CSRF token to `.session.json` (gitignored), which the MCP steps below use. Run it again whenever the session expires or the backend restarts. You can also log in to the web app as `ada@example.com` / `Granth@i-Demo-2026`.

## 4. Talk to the MCP server

### With the included client

```bash
node scripts/mcp.mjs tools
```

```
get_api_v1_projects                       index, size, field, order
post_api_v1_projects                      body
get_api_v1_projects_id                    id
post_api_v1_tasks                         body
get_api_v1_tasks_kanban_id                id
post_api_v1_task-comments                 body
...
25 tools from Worklenz API
```

Call tools the same way an agent would. Reads and CSRF-protected writes both work:

```bash
PROJECT=$(node -p 'require("./.session.json").projectId')

node scripts/mcp.mjs call get_api_v1_projects_id "{\"id\":\"$PROJECT\"}"

node scripts/mcp.mjs call get_api_v1_statuses "{\"project\":\"$PROJECT\"}"   # copy a status id
node scripts/mcp.mjs call post_api_v1_tasks \
  "{\"body\":{\"name\":\"Filed by an AI agent over MCP\",\"project_id\":\"$PROJECT\",\"status_id\":\"<status id>\"}}"
```

The new task shows up in the web app straight away (with a key like `EVMG-4`), filed as the logged-in user.

### With raw JSON-RPC (curl)

```bash
COOKIE=$(node -p 'require("./.session.json").cookie')
CSRF=$(node -p 'require("./.session.json").csrfToken')

curl -s http://localhost:3000/mcp-server \
  -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \
  -H "cookie: $COOKIE" -H "x-csrf-token: $CSRF" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

### With Claude Code (or any MCP client)

```bash
claude mcp add --transport http worklenz http://localhost:3000/mcp-server \
  --header "Cookie: $(node -p 'require("./.session.json").cookie')" \
  --header "X-CSRF-Token: $(node -p 'require("./.session.json").csrfToken')"
```

Then ask things like *"What projects do I have in Worklenz, and what's on the board for the newest one?"* or *"File a task called 'Write release notes' in that project."* Remove it afterwards with `claude mcp remove worklenz`.

[MCP Inspector](https://github.com/modelcontextprotocol/inspector) (`npx @modelcontextprotocol/inspector`) works too: pick **Streamable HTTP**, use `http://localhost:3000/mcp-server`, and add the same two headers.

## Good to know

- **The spec lives in memory.** It resets on every backend restart. GranthAi also writes it to `worklenz/worklenz-backend/openapi.json`, but doesn't load it back on startup.
- **Login isn't a tool.** `POST /secure/login` answers with a redirect rather than JSON, so GranthAi doesn't record it. Agents use the session you give them via headers.
- **Editing GranthAi:** the backend uses this repo's `packages/node` through a symlink, so restart the backend (Terminal 1) after changing `index.js` or `mcpServer.js`.
- **Analytics:** the GranthAi middleware sends a Mixpanel event per request. The Worklenz web app loads Google Analytics in dev, and declining its cookie banner is fine.
- **Upgrading Worklenz:** change `WORKLENZ_COMMIT` in `setup.sh`, delete `./worklenz`, and re-run. If the patch no longer applies, re-add the middleware by hand and regenerate it with `git -C worklenz diff -- worklenz-backend/src/app.ts > granthai.patch`.

## Clean up

```bash
# stop terminals 1-3 with Ctrl+C, then:
docker compose down -v      # stop Postgres and delete its data
rm -rf worklenz .session.json
```
