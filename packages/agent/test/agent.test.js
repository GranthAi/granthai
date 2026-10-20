// End-to-end: a plain node:http app (no framework, standing in for any language) behind the agent
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const zlib = require("zlib");
const { createAgent } = require("../src");

const USER_ID = "3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b";
let upstream;
let agent;
let base;
let upstreamOrigin;
let specFile;

function json(res, status, body, headers = {}) {
	res.writeHead(status, { "content-type": "application/json", ...headers });
	res.end(JSON.stringify(body));
}

before(async () => {
	upstream = http.createServer((req, res) => {
		let raw = "";
		req.on("data", (chunk) => (raw += chunk));
		req.on("end", () => {
			const url = new URL(req.url, "http://x");
			const p = url.pathname;
			if (req.method === "GET" && p === "/api/projects") {
				return json(res, 200, [{ id: 1, name: "Alpha", owner: null }]);
			}
			if (req.method === "POST" && p === "/api/projects") {
				return json(res, 201, { id: 2, ...JSON.parse(raw) });
			}
			if (req.method === "GET" && /^\/api\/projects\/\d+$/.test(p)) {
				const id = Number(p.split("/").pop());
				return json(res, 200, id === 42 ? { id, name: "Answer", auth: req.headers.authorization || null } : { id, name: "Other", archived: true });
			}
			if (req.method === "DELETE" && /^\/api\/projects\/\d+$/.test(p)) {
				res.writeHead(204);
				return res.end();
			}
			if (p === `/api/users/${USER_ID}`) {
				const body = zlib.gzipSync(JSON.stringify({ id: USER_ID, email: "a@b.co" }));
				res.writeHead(200, { "content-type": "application/json; charset=utf-8", "content-encoding": "gzip" });
				return res.end(body);
			}
			if (p.startsWith("/files/")) return json(res, 200, { path: p.slice(7) });
			if (p === "/app.js") {
				res.writeHead(200, { "content-type": "text/javascript" });
				return res.end("console.log(1)");
			}
			if (p === "/old") {
				res.writeHead(302, { location: `${upstreamOrigin}/new?x=1` });
				return res.end();
			}
			json(res, 404, { error: "not found" });
		});
	});
	upstream.on("upgrade", (req, socket) => {
		socket.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: echo\r\nConnection: Upgrade\r\n\r\n");
		socket.pipe(socket);
	});
	await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
	upstreamOrigin = `http://127.0.0.1:${upstream.address().port}`;

	specFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "granthai-")), "spec.json");
	agent = createAgent({ target: upstreamOrigin, title: "Test API", specFile, routes: ["/files/{path*}"], onError: (err) => assert.fail(err) });
	const address = await agent.listen(0, "127.0.0.1");
	base = `http://127.0.0.1:${address.port}`;

	await fetch(`${base}/api/projects?page=2`);
	await fetch(`${base}/api/projects`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "New", tags: ["x"] }) });
	await fetch(`${base}/api/projects/42`);
	await fetch(`${base}/api/projects/7`);
	await fetch(`${base}/api/projects/42`, { method: "DELETE" });
	await fetch(`${base}/api/users/${USER_ID}`);
	await fetch(`${base}/files/docs/readme.md`);
	await fetch(`${base}/app.js`);
	await fetch(`${base}/does-not-exist`);
});

after(async () => {
	await agent.close();
	upstream.close();
});

test("forwards traffic unchanged", async () => {
	const res = await fetch(`${base}/api/projects/42`, { headers: { authorization: "Bearer t" } });
	assert.equal(res.status, 200);
	assert.deepEqual(await res.json(), { id: 42, name: "Answer", auth: "Bearer t" });
	const js = await fetch(`${base}/app.js`);
	assert.equal(await js.text(), "console.log(1)");
	const gz = await fetch(`${base}/api/users/${USER_ID}`);
	assert.equal((await gz.json()).email, "a@b.co");
});

test("templates paths without framework help", () => {
	const paths = Object.keys(agent.spec.paths).sort();
	assert.deepEqual(paths, ["/api/projects", "/api/projects/{projectId}", "/api/users/{userId}", "/files/{path}"]);
	const getOne = agent.spec.paths["/api/projects/{projectId}"].get;
	assert.deepEqual(getOne.parameters, [{ name: "projectId", in: "path", required: true, schema: { type: "integer" } }]);
	assert.equal(agent.spec.paths["/api/users/{userId}"].get.parameters[0].schema.format, "uuid");
});

test("records bodies, query params and merged schemas", () => {
	const list = agent.spec.paths["/api/projects"];
	assert.deepEqual(list.get.parameters, [{ name: "page", in: "query", schema: { type: "integer" } }]);
	assert.deepEqual(list.get.responses[200].content["application/json"].schema.items.properties.owner, { type: "null" });
	assert.deepEqual(list.post.requestBody.content["application/json"].schema.properties.tags, { type: "array", items: { type: "string" } });
	assert.ok(list.post.responses[201]);

	// /42 and /7 return different shapes: both fields are kept
	const props = agent.spec.paths["/api/projects/{projectId}"].get.responses[200].content["application/json"].schema.properties;
	assert.ok(props.archived && props.auth);
	assert.deepEqual(props.auth, { type: ["null", "string"] });
	assert.deepEqual(agent.spec.paths["/api/projects/{projectId}"].delete.responses[204], { description: "No Content" });
	// gzip responses are decoded before inference
	assert.equal(agent.spec.paths["/api/users/{userId}"].get.responses[200].content["application/json"].schema.properties.email.type, "string");
});

test("skips assets and unknown 404s", () => {
	assert.equal(agent.spec.paths["/app.js"], undefined);
	assert.equal(agent.spec.paths["/does-not-exist"], undefined);
});

test("rewrites redirects to the app's own origin", async () => {
	const res = await fetch(`${base}/old`, { redirect: "manual" });
	assert.equal(res.status, 302);
	assert.equal(res.headers.get("location"), "/new?x=1");
});

test("serves docs and the spec under the prefix", async () => {
	const docs = await fetch(`${base}/_granthai/api-docs`);
	assert.match(await docs.text(), /swagger-ui/);
	const spec = await (await fetch(`${base}/_granthai/openapi.json`)).json();
	assert.equal(spec.info.title, "Test API");
	assert.ok(spec.paths["/api/projects/{projectId}"]);
});

test("exposes the API as MCP tools that call the app", async () => {
	const rpc = (body, headers = {}) =>
		fetch(`${base}/_granthai/mcp`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) }).then((r) => r.json());

	const list = await rpc({ jsonrpc: "2.0", id: 1, method: "tools/list" });
	const names = list.result.tools.map((tool) => tool.name);
	assert.ok(names.includes("get_api_projects_projectId"));

	const call = await rpc(
		{ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "get_api_projects_projectId", arguments: { projectId: 42 } } },
		{ authorization: "Bearer mcp" }
	);
	assert.equal(call.result.isError, false);
	assert.match(call.result.content[0].text, /"auth":"Bearer mcp"/);
});

test("tunnels upgrade requests", async () => {
	const { port } = new URL(base);
	const echoed = await new Promise((resolve, reject) => {
		const req = http.request({ host: "127.0.0.1", port, path: "/ws", headers: { connection: "Upgrade", upgrade: "echo" } });
		req.on("upgrade", (res, socket) => {
			socket.once("data", (data) => {
				resolve(data.toString());
				socket.destroy();
			});
			socket.write("ping");
		});
		req.on("error", reject);
		req.end();
	});
	assert.equal(echoed, "ping");
});

test("saves the spec to disk", () => {
	agent.save();
	const saved = JSON.parse(fs.readFileSync(specFile, "utf8"));
	assert.ok(saved.paths["/api/projects"]);
});
