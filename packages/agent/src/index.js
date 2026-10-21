// GranthAi agent: a reverse proxy placed in front of any HTTP API, whatever language or
// framework it is written in. Traffic is forwarded untouched while request/response pairs are
// recorded into an OpenAPI spec, served with Swagger UI and an MCP server on the same port.
const http = require("http");
const https = require("https");
const { createRecorder } = require("./recorder");
const handleMcpRequest = require("./mcp");
const swaggerPage = require("./swaggerPage");

const DEFAULT_MAX_BODY = 1024 * 1024;
const HOP_BY_HOP = new Set([
	"connection",
	"keep-alive",
	"proxy-authenticate",
	"proxy-authorization",
	"proxy-connection",
	"te",
	"trailer",
	"transfer-encoding",
	"upgrade"
]);

// Accepts 3000, :3000, localhost:3000, http://api.internal:8080
function parseTarget(target) {
	const value = String(target || "").trim();
	if (!value) throw new Error("A target is required, e.g. --target 3000");
	let url;
	if (/^\d+$/.test(value)) url = new URL(`http://localhost:${value}`);
	else if (/^:\d+$/.test(value)) url = new URL(`http://localhost${value}`);
	else if (/^https?:\/\//i.test(value)) url = new URL(value);
	else url = new URL(`http://${value}`);
	if (url.pathname !== "/") throw new Error(`The target must be an origin without a path, got ${value}`);
	return url;
}

function forwardableHeaders(headers) {
	const result = {};
	for (const name in headers) {
		if (!HOP_BY_HOP.has(name)) result[name] = headers[name];
	}
	return result;
}

// Keeps up to `limit` bytes of a streamed body for recording without slowing the stream down
function bodyCapture(limit) {
	const chunks = [];
	let size = 0;
	return {
		truncated: false,
		push(chunk) {
			if (this.truncated) return;
			size += chunk.length;
			if (size > limit) {
				this.truncated = true;
				chunks.length = 0;
			} else {
				chunks.push(chunk);
			}
		},
		get body() {
			return Buffer.concat(chunks);
		}
	};
}

function createAgent({
	target,
	title,
	specFile,
	routes = [],
	prefix = "/_granthai",
	publicUrl,
	mcp = true,
	mcpAllowedOrigins = [],
	mcpAuthTools = false,
	maxBody = DEFAULT_MAX_BODY,
	onError = (err) => console.warn(`[granthai] ${err.message}`)
}) {
	const targetUrl = parseTarget(target);
	const client = targetUrl.protocol === "https:" ? https : http;
	const upstreamAgent = new client.Agent({ keepAlive: true });
	const recorder = createRecorder({ title, specFile, routes, publicUrl });
	const base = prefix.replace(/\/+$/, "");

	function upstreamOptions(req) {
		const headers = forwardableHeaders(req.headers);
		const forwardedFor = req.headers["x-forwarded-for"];
		const clientIp = req.socket.remoteAddress;
		headers["x-forwarded-for"] = forwardedFor ? `${forwardedFor}, ${clientIp}` : clientIp;
		headers["x-forwarded-host"] = req.headers["x-forwarded-host"] || req.headers.host;
		headers["x-forwarded-proto"] = req.headers["x-forwarded-proto"] || (req.socket.encrypted ? "https" : "http");
		headers.host = targetUrl.host;
		return {
			protocol: targetUrl.protocol,
			hostname: targetUrl.hostname.replace(/^\[|\]$/g, ""),
			port: targetUrl.port,
			method: req.method,
			path: req.url,
			headers,
			agent: upstreamAgent,
			autoSelectFamily: true
		};
	}

	// Redirects the app sends to its own origin must keep the client on the proxy
	function rewriteLocation(headers) {
		if (!headers.location) return;
		try {
			const location = new URL(headers.location, targetUrl);
			if (location.origin === targetUrl.origin) headers.location = location.pathname + location.search + location.hash;
		} catch (err) {
			// Leave unparseable locations alone
		}
	}

	function serveInternal(req, res, pathname) {
		const route = pathname.slice(base.length).replace(/\/+$/, "");
		if (route === "" || route === "/api-docs") {
			if (route === "") {
				res.writeHead(302, { location: `${base}/api-docs` });
				return res.end();
			}
			res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
			return res.end(swaggerPage({ title: recorder.spec.info.title, specUrl: `${base}/openapi.json` }));
		}
		if (route === "/openapi.json") {
			res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
			return res.end(JSON.stringify(recorder.spec));
		}
		if (route === "/mcp" && mcp) {
			return handleMcpRequest(req, res, {
				spec: recorder.spec,
				origin: targetUrl.origin,
				allowedOrigins: mcpAllowedOrigins,
				includeAuthTools: mcpAuthTools
			}).catch((err) => {
				onError(err);
				if (!res.headersSent) res.writeHead(500);
				res.end();
			});
		}
		res.writeHead(404, { "content-type": "application/json" });
		res.end(JSON.stringify({ error: `Unknown GranthAi route ${pathname}` }));
	}

	function proxyRequest(req, res) {
		const pathname = req.url.split("?")[0];
		if (pathname === base || pathname.startsWith(`${base}/`)) return serveInternal(req, res, pathname);

		const reqCapture = bodyCapture(maxBody);
		const upstreamReq = client.request(upstreamOptions(req), (upstreamRes) => {
			const headers = forwardableHeaders(upstreamRes.headers);
			rewriteLocation(headers);
			res.writeHead(upstreamRes.statusCode, upstreamRes.statusMessage, headers);

			const resCapture = bodyCapture(maxBody);
			upstreamRes.on("data", (chunk) => resCapture.push(chunk));
			upstreamRes.on("end", () => {
				try {
					recorder.record({
						method: req.method,
						url: req.url,
						reqHeaders: req.headers,
						reqBody: reqCapture.body,
						reqTruncated: reqCapture.truncated,
						status: upstreamRes.statusCode,
						resHeaders: upstreamRes.headers,
						resBody: resCapture.body,
						resTruncated: resCapture.truncated
					});
				} catch (err) {
					onError(err);
				}
			});
			upstreamRes.on("error", () => res.destroy());
			upstreamRes.pipe(res);
		});

		upstreamReq.on("error", (err) => {
			if (res.headersSent) return res.destroy();
			res.writeHead(502, { "content-type": "application/json" });
			res.end(JSON.stringify({ error: `GranthAi agent could not reach ${targetUrl.origin}: ${err.message}` }));
		});
		// Client went away before the response finished: stop the upstream work too
		res.on("close", () => {
			if (!res.writableFinished) upstreamReq.destroy();
		});

		req.on("data", (chunk) => reqCapture.push(chunk));
		req.pipe(upstreamReq);
	}

	// WebSockets and other upgrades are tunnelled through untouched and not recorded
	function proxyUpgrade(req, socket, head) {
		// Upgrades need the Connection/Upgrade headers kept and a socket of their own
		const upstreamReq = client.request({ ...upstreamOptions(req), agent: false, headers: { ...req.headers, host: targetUrl.host } });

		upstreamReq.on("upgrade", (upstreamRes, upstreamSocket, upstreamHead) => {
			let response = `HTTP/1.1 ${upstreamRes.statusCode} ${upstreamRes.statusMessage}\r\n`;
			for (let i = 0; i < upstreamRes.rawHeaders.length; i += 2) {
				response += `${upstreamRes.rawHeaders[i]}: ${upstreamRes.rawHeaders[i + 1]}\r\n`;
			}
			socket.write(`${response}\r\n`);
			if (upstreamHead.length) socket.write(upstreamHead);
			if (head.length) upstreamSocket.write(head);
			upstreamSocket.pipe(socket).pipe(upstreamSocket);
			upstreamSocket.on("error", () => socket.destroy());
			socket.on("error", () => upstreamSocket.destroy());
		});
		// The app declined the upgrade: relay its plain HTTP answer
		upstreamReq.on("response", (upstreamRes) => {
			let response = `HTTP/1.1 ${upstreamRes.statusCode} ${upstreamRes.statusMessage}\r\n`;
			for (const [name, value] of Object.entries(forwardableHeaders(upstreamRes.headers))) {
				for (const item of [].concat(value)) response += `${name}: ${item}\r\n`;
			}
			socket.write(`${response}connection: close\r\n\r\n`);
			upstreamRes.pipe(socket);
		});
		upstreamReq.on("error", () => socket.destroy());
		socket.on("error", () => upstreamReq.destroy());
		upstreamReq.end();
	}

	const server = http.createServer(proxyRequest);
	server.on("upgrade", proxyUpgrade);
	server.on("close", () => {
		upstreamAgent.destroy();
		recorder.save();
	});

	return {
		server,
		spec: recorder.spec,
		target: targetUrl,
		prefix: base,
		save: recorder.save,
		listen(port, host) {
			return new Promise((resolve, reject) => {
				server.once("error", reject);
				server.listen(port, host, () => {
					server.off("error", reject);
					resolve(server.address());
				});
			});
		},
		close() {
			return new Promise((resolve) => {
				server.close(() => resolve());
				server.closeAllConnections?.();
			});
		}
	};
}

module.exports = { createAgent, parseTarget };
