https://github.com/omkarajagunde/granthai/assets/50138744/35d42210-307e-4cb8-a320-106b661b1593
### How to integrate?
```js
const GranthAi = require("granthai")
const app = express()
app.use(GranthAi({ 
    docTitle: "..." // optional
    key: "..."      // optional
    baseUrl: "..."  // required
}))
```
Note: If you use nodemon on your server, put `openapi.json` (this file is created at the level of server entry point file) to nodemon ignore else documentation will not show up


### How to access the generated API Documentation?
When the NodeJs server starts up, GranthAi will add a new public route to your server url at `/api-docs`, you can simply visit this `/api-docs` route to access your generated API Documentation

GranthAi generates an [OpenAPI 3.1](https://spec.openapis.org/oas/v3.1.0) description (with JSON Schema 2020-12 schemas inferred from real requests and responses), saved as `openapi.json` and rendered with Swagger UI.


### MCP server
GranthAi also turns the same generated OpenAPI spec into an [MCP](https://modelcontextprotocol.io) server at `/mcp-server` (Streamable HTTP transport), so AI agents and MCP clients like Claude can call your API directly. Every endpoint in the spec is exposed as a tool (e.g. `GET /users/{id}` becomes `get_users_id`), and calling a tool makes the real HTTP request to your API using `baseUrl`.

```bash
claude mcp add --transport http my-api https://your-server.com/mcp-server
```

- Tools appear once an endpoint has handled at least one request, just like `/api-docs`
- The `Authorization`, `Cookie`, `X-CSRF-Token` and `X-XSRF-Token` headers sent to `/mcp-server` are forwarded to your API, so your existing auth (bearer tokens or sessions) keeps applying
- Browser requests from other origins are rejected unless listed in `mcpAllowedOrigins`
- Disable it with `GranthAi({ ..., mcp: false })`

See it on a real app: [`examples/worklenz`](examples/worklenz) injects GranthAi into [Worklenz](https://github.com/Worklenz/worklenz), an open-source Jira/Asana alternative, so you can watch its API docs and MCP tools fill in as you use it.


### Is it free to use? 

Absolutely, this tool is completely free to use.
[Signup here to get updates](https://granthai.com/)

- Rest assured that we don't collect or retain any of your API data or metrics on our servers. 
- This information is solely utilized for auditing purposes, service enhancement, and gaining insight into user requirements. 
- If you choose to subscribe to our upcoming features like API metrics & monitoring, live hosting, automated testing, error tracking, and more, we might consider storing such data then.

## Support and feedback
- manage.granthai@gmail.com

### Authors
- Omkar Ajagunde (http://omkarajagunde.web.app/), 
- Sanket Chaudhari (https://github.com/sanketssc)


