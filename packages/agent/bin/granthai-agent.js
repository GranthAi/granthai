#!/usr/bin/env node
const { parseArgs } = require("util");
const { createAgent } = require("../src");
const { version } = require("../package.json");

const HELP = `granthai-agent ${version}

Put GranthAi in front of any HTTP API (Node, Python, Java, PHP, Go, .NET, ...) and get
OpenAPI docs, Swagger UI and an MCP server generated from its live traffic. No code changes.

Usage
  npx granthai-agent --target <port | host:port | url> [options]

Options
  -t, --target <target>     The app to document, e.g. 3000, localhost:8080, http://api:8000 (required)
  -p, --port <port>         Port the agent listens on (default 4000)
      --host <host>         Interface to bind (default 127.0.0.1, use 0.0.0.0 in containers)
      --title <title>       Title of the generated documentation
  -o, --out <file>          Where the spec is saved and reloaded from (default ./granthai.openapi.json)
      --route <template>    Path template to use for matching requests, repeatable,
                            e.g. --route "/users/{username}" --route "/files/{path*}"
                            End with /** to template a prefix and auto-detect the rest:
                            --route "/repos/{owner}/{repo}/**"
      --prefix <path>       Where the agent serves its own pages (default /_granthai)
      --public-url <url>    URL clients use to reach the agent, written to the spec's servers
      --max-body <bytes>    Largest request/response body inspected (default 1048576)
      --mcp-origin <url>    Browser origin allowed to call the MCP endpoint, repeatable
      --no-mcp              Don't serve the MCP endpoint
  -h, --help                Show this help
  -v, --version             Show the version

Example
  npx granthai-agent --target 8000 --title "Orders API"
  # send your traffic to http://localhost:4000 instead of :8000, then open
  # http://localhost:4000/_granthai/api-docs`;

function fail(message) {
	console.error(`granthai-agent: ${message}\nRun granthai-agent --help for usage.`);
	process.exit(1);
}

let parsed;
try {
	const argv = process.argv.slice(2);
	parsed = parseArgs({
		args: argv.filter((arg) => arg !== "--no-mcp"),
		options: {
			target: { type: "string", short: "t" },
			port: { type: "string", short: "p", default: process.env.PORT || "4000" },
			host: { type: "string", default: "127.0.0.1" },
			title: { type: "string" },
			out: { type: "string", short: "o", default: "./granthai.openapi.json" },
			route: { type: "string", multiple: true, default: [] },
			prefix: { type: "string", default: "/_granthai" },
			"public-url": { type: "string" },
			"max-body": { type: "string", default: "1048576" },
			"mcp-origin": { type: "string", multiple: true, default: [] },
			help: { type: "boolean", short: "h" },
			version: { type: "boolean", short: "v" }
		},
		allowPositionals: false
	});
	parsed.values.mcp = !argv.includes("--no-mcp");
} catch (err) {
	fail(err.message);
}

const options = parsed.values;
if (options.help) {
	console.log(HELP);
	process.exit(0);
}
if (options.version) {
	console.log(version);
	process.exit(0);
}
if (!options.target) fail("--target is required");

const port = Number(options.port);
const maxBody = Number(options["max-body"]);
if (!Number.isInteger(port) || port < 0 || port > 65535) fail(`invalid --port ${options.port}`);
if (!Number.isInteger(maxBody) || maxBody < 0) fail(`invalid --max-body ${options["max-body"]}`);
if (!options.prefix.startsWith("/") || options.prefix.length < 2) fail("--prefix must start with / and not be the root");

let agent;
try {
	agent = createAgent({
		target: options.target,
		title: options.title,
		specFile: options.out,
		routes: options.route,
		prefix: options.prefix,
		publicUrl: options["public-url"],
		mcp: options.mcp,
		mcpAllowedOrigins: options["mcp-origin"],
		maxBody
	});
} catch (err) {
	fail(err.message);
}

agent
	.listen(port, options.host)
	.then((address) => {
		const shownHost = ["0.0.0.0", "::", "127.0.0.1", "::1"].includes(address.address) ? "localhost" : address.address;
		const url = `http://${shownHost}:${address.port}`;
		console.log(`
  GranthAi agent ${version}

  Proxy      ${url}  ->  ${agent.target.origin}
  API docs   ${url}${agent.prefix}/api-docs
  OpenAPI    ${url}${agent.prefix}/openapi.json${options.mcp ? `\n  MCP        ${url}${agent.prefix}/mcp` : ""}
  Spec file  ${options.out}

  Send your traffic to ${url} and endpoints will show up as they are used.
`);
	})
	.catch((err) => fail(err.code === "EADDRINUSE" ? `port ${port} is already in use, pick another with --port` : err.message));

function shutdown() {
	agent.close().then(() => process.exit(0));
	setTimeout(() => process.exit(0), 3000).unref();
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
