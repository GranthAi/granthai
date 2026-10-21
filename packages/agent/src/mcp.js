// MCP server (Streamable HTTP transport, stateless) built from the generated OpenAPI spec.
// Every operation in the spec is exposed as a tool; calling a tool sends the real HTTP request
// straight to the target app (not back through the proxy, so tool calls don't reshape the spec).
const { version } = require("../package.json");

const SUPPORTED_PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26"];
const HTTP_METHODS = ["get", "post", "put", "patch", "delete"];
const TOOL_CALL_TIMEOUT_MS = 30000;
const MAX_MESSAGE_BYTES = 4 * 1024 * 1024;
// Credentials an MCP client sends to the MCP endpoint that are passed on to the API, so
// cookie/session based apps (and their CSRF checks) work the same as bearer-token ones
const FORWARDED_HEADERS = ["authorization", "cookie", "x-csrf-token", "x-xsrf-token", "x-api-key"];

function toolNameFor(method, path) {
	const slug = path
		.replace(/[{}]/g, "")
		.split("/")
		.filter(Boolean)
		.join("_")
		.replace(/[^a-zA-Z0-9_-]/g, "_");
	return `${method}_${slug || "root"}`.slice(0, 64);
}

// "requires a Bearer token" style hint, so an agent knows why a call may answer 401
function authHint(spec, operation) {
	const security = operation.security;
	if (!security || security.length === 0 || security.some((requirement) => Object.keys(requirement).length === 0)) return "";
	const schemes = (spec.components && spec.components.securitySchemes) || {};
	const names = security.map((requirement) => {
		const scheme = schemes[Object.keys(requirement)[0]] || {};
		if (scheme.scheme === "bearer") return "a Bearer token";
		if (scheme.scheme === "basic") return "Basic auth";
		if (scheme.in === "cookie") return `the ${scheme.name} session cookie`;
		return `the ${scheme.name} ${scheme.in === "query" ? "query parameter" : "header"}`;
	});
	return ` (requires ${[...new Set(names)].join(" or ")})`;
}

function buildTools(spec, { includeAuthTools = false } = {}) {
	const tools = [];
	const used = new Set();

	for (const path in spec.paths) {
		for (const method of HTTP_METHODS) {
			const operation = spec.paths[path][method];
			if (!operation) continue;
			// Logins need a person (passwords, OTPs, browser redirects), so they aren't agent tools by default
			if (operation["x-granthai-login"] && !includeAuthTools) continue;

			let name = toolNameFor(method, path);
			for (let i = 2; used.has(name); i++) {
				name = `${toolNameFor(method, path).slice(0, 60)}_${i}`;
			}
			used.add(name);

			const properties = {};
			const required = [];
			for (const param of operation.parameters || []) {
				if (param.in !== "path" && param.in !== "query") continue;
				properties[param.name] = { ...param.schema, description: `${param.in} parameter` };
				if (param.required) required.push(param.name);
			}

			let bodyContentType;
			const content = operation.requestBody && operation.requestBody.content;
			if (content && Object.keys(content).length > 0) {
				bodyContentType = Object.keys(content).find((type) => type.includes("json")) || Object.keys(content)[0];
				properties.body = { ...content[bodyContentType].schema, description: "Request body" };
			}

			tools.push({
				name,
				description: (operation.summary || `${method.toUpperCase()} ${path}`) + authHint(spec, operation),
				inputSchema: { type: "object", properties, ...(required.length ? { required } : {}) },
				_operation: { method, path, parameters: operation.parameters || [], bodyContentType }
			});
		}
	}
	return tools;
}

async function callTool(tool, args, { origin, forwardedHeaders }) {
	const { method, path, parameters, bodyContentType } = tool._operation;
	let urlPath = path;
	const query = new URLSearchParams();

	for (const param of parameters) {
		const value = args[param.name];
		if (value === undefined || value === null) continue;
		if (param.in === "path") urlPath = urlPath.replace(`{${param.name}}`, encodeURIComponent(String(value)));
		if (param.in === "query") query.append(param.name, String(value));
	}

	const missing = urlPath.match(/{[^}]+}/g);
	if (missing) {
		return { content: [{ type: "text", text: `Missing required path parameter(s): ${missing.join(", ")}` }], isError: true };
	}

	const url = new URL(urlPath, origin);
	url.search = query.toString();

	const headers = { accept: "application/json, text/plain, */*", ...forwardedHeaders };
	let body;
	if (args.body !== undefined && method !== "get" && method !== "delete") {
		if (bodyContentType === "application/x-www-form-urlencoded") {
			headers["content-type"] = bodyContentType;
			body = new URLSearchParams(args.body).toString();
		} else {
			headers["content-type"] = bodyContentType && bodyContentType.includes("json") ? bodyContentType : "application/json";
			body = JSON.stringify(args.body);
		}
	}

	try {
		const response = await fetch(url, { method: method.toUpperCase(), headers, body, signal: AbortSignal.timeout(TOOL_CALL_TIMEOUT_MS) });
		const text = await response.text();
		return {
			content: [{ type: "text", text: `HTTP ${response.status} ${response.statusText}\n\n${text}` }],
			isError: !response.ok
		};
	} catch (err) {
		return { content: [{ type: "text", text: `Request to ${method.toUpperCase()} ${url.pathname} failed: ${err.message}` }], isError: true };
	}
}

function rpcResult(id, result) {
	return { jsonrpc: "2.0", id, result };
}

function rpcError(id, code, message) {
	return { jsonrpc: "2.0", id, error: { code, message } };
}

async function handleMessage(message, ctx) {
	if (!message || message.jsonrpc !== "2.0") return rpcError(message?.id ?? null, -32600, "Invalid Request");
	// Client responses and notifications get no reply
	if (message.method === undefined || message.id === undefined) return null;

	const { id, method, params = {} } = message;
	switch (method) {
		case "initialize": {
			const requested = params.protocolVersion;
			const protocolVersion = SUPPORTED_PROTOCOL_VERSIONS.includes(requested) ? requested : SUPPORTED_PROTOCOL_VERSIONS[0];
			return rpcResult(id, {
				protocolVersion,
				capabilities: { tools: { listChanged: false } },
				serverInfo: { name: ctx.spec.info.title, version },
				instructions:
					"Tools are generated by GranthAi from API traffic observed by the GranthAi agent. Each tool calls one API endpoint and returns the raw HTTP response. Endpoints appear here after they have handled at least one request through the agent."
			});
		}
		case "ping":
			return rpcResult(id, {});
		case "tools/list":
			return rpcResult(id, { tools: buildTools(ctx.spec, ctx).map(({ _operation, ...tool }) => tool) });
		case "tools/call": {
			const tool = buildTools(ctx.spec, ctx).find((t) => t.name === params.name);
			if (!tool) return rpcError(id, -32602, `Unknown tool: ${params.name}`);
			return rpcResult(id, await callTool(tool, params.arguments || {}, ctx));
		}
		default:
			return rpcError(id, -32601, `Method not found: ${method}`);
	}
}

function readJson(req) {
	return new Promise((resolve, reject) => {
		let data = "";
		req.setEncoding("utf8");
		req.on("data", (chunk) => {
			data += chunk;
			if (data.length > MAX_MESSAGE_BYTES) reject(new Error("Message too large"));
		});
		req.on("end", () => {
			try {
				resolve(JSON.parse(data));
			} catch (err) {
				reject(err);
			}
		});
		req.on("error", reject);
	});
}

function isOriginAllowed(req, allowedOrigins) {
	const origin = req.headers.origin;
	if (!origin) return true;
	if (allowedOrigins.includes(origin)) return true;
	try {
		return new URL(origin).host === req.headers.host;
	} catch (err) {
		return false;
	}
}

function sendJson(res, status, body, headers = {}) {
	res.writeHead(status, { "content-type": "application/json", ...headers });
	res.end(JSON.stringify(body));
}

async function handleMcpRequest(req, res, { spec, origin, allowedOrigins = [], includeAuthTools = false }) {
	// Protects against DNS rebinding as required by the Streamable HTTP transport spec
	if (!isOriginAllowed(req, allowedOrigins)) {
		return sendJson(res, 403, rpcError(null, -32000, "Origin not allowed"));
	}

	if (req.method !== "POST") {
		// Stateless server: no standalone SSE stream (GET) and no sessions to terminate (DELETE)
		return sendJson(res, 405, rpcError(null, -32000, "Method not allowed"), { allow: "POST" });
	}

	let payload;
	try {
		payload = await readJson(req);
	} catch (err) {
		return sendJson(res, 400, rpcError(null, -32700, "Parse error"));
	}

	const forwardedHeaders = {};
	for (const name of FORWARDED_HEADERS) {
		if (req.headers[name]) forwardedHeaders[name] = req.headers[name];
	}
	const ctx = { spec, origin, forwardedHeaders, includeAuthTools };

	const messages = Array.isArray(payload) ? payload : [payload];
	const responses = (await Promise.all(messages.map((message) => handleMessage(message, ctx)))).filter(Boolean);

	if (responses.length === 0) {
		res.writeHead(202);
		return res.end();
	}
	return sendJson(res, 200, Array.isArray(payload) ? responses : responses[0]);
}

module.exports = handleMcpRequest;
