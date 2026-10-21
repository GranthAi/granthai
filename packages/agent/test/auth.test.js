// Auth detection end-to-end: one app with every common login style behind the agent
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");
const { createAgent } = require("../src");

const JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhZGEifQ.c2lnbmF0dXJlLXNpZ25hdHVyZQ";
const OTP_TOKEN = "otp_tok_0123456789abcdef";
let upstream;
let agent;
let base;
let errors = [];

function json(res, status, body, headers = {}) {
	res.writeHead(status, { "content-type": "application/json", ...headers });
	res.end(JSON.stringify(body));
}

const signedIn = (req) =>
	req.headers.authorization === `Bearer ${JWT}` || req.headers.authorization === `Bearer ${OTP_TOKEN}` || /sid=s1/.test(req.headers.cookie || "");

before(async () => {
	upstream = http.createServer((req, res) => {
		let raw = "";
		req.on("data", (chunk) => (raw += chunk));
		req.on("end", () => {
			const url = new URL(req.url, "http://x");
			const route = `${req.method} ${url.pathname}`;
			switch (route) {
				case "GET /login":
					res.writeHead(200, { "content-type": "text/html", "set-cookie": "_ga=GA1.1; Path=/" });
					return res.end('<form method="post" action="/login"><input name="email"><input type="password" name="password"></form>');
				case "POST /login":
					res.writeHead(302, { location: "/dashboard", "set-cookie": ["sid=s1; Path=/; HttpOnly", "csrf=abc; Path=/"] });
					return res.end();
				case "POST /api/auth/register":
					return json(res, 201, { id: 2, token: JWT });
				case "POST /api/auth/login":
					return json(res, 200, { user: { id: 1 }, access_token: JWT, expires_in: 3600 });
				case "POST /api/otp/send":
					return json(res, 200, { sent: true });
				case "POST /api/otp/verify":
					return json(res, 200, { data: { token: OTP_TOKEN } });
				case "GET /auth/google":
					res.writeHead(302, {
						location: "https://accounts.google.com/o/oauth2/v2/auth?client_id=abc&redirect_uri=http%3A%2F%2Fx%2Fauth%2Fcallback&response_type=code&scope=openid%20email"
					});
					return res.end();
				case "GET /auth/callback":
					res.writeHead(302, { location: "/dashboard", "set-cookie": "sid=s1; Path=/; HttpOnly" });
					return res.end();
				case "GET /api/me":
					return signedIn(req) ? json(res, 200, { id: 1, name: "Ada" }) : json(res, 401, { error: "unauthorized" });
				case "GET /api/reports":
					return req.headers["x-api-key"] === "k_123" ? json(res, 200, []) : json(res, 401, { error: "bad key" });
				case "GET /api/health":
					return json(res, 200, { ok: true });
				case "PUT /api/profile":
					return json(res, 200, { phone: JSON.parse(raw).phone });
				default:
					return json(res, 404, { error: "not found" });
			}
		});
	});
	await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
	agent = createAgent({ target: `http://127.0.0.1:${upstream.address().port}`, onError: (err) => errors.push(err) });
	const address = await agent.listen(0, "127.0.0.1");
	base = `http://127.0.0.1:${address.port}`;

	const post = (path, body, type = "application/json", headers = {}) =>
		fetch(base + path, {
			method: "POST",
			redirect: "manual",
			headers: { "content-type": type, ...headers },
			body: type === "application/json" ? JSON.stringify(body) : new URLSearchParams(body).toString()
		});

	// Browser: login page, form post, then the session cookie on API calls
	await fetch(`${base}/login`);
	await post("/login", { email: "ada@example.com", password: "secret" }, "application/x-www-form-urlencoded");
	await fetch(`${base}/api/me`, { headers: { cookie: "sid=s1; csrf=abc; _ga=GA1.1" } });
	// API clients: JSON login returning a JWT, then a bearer call
	await post("/api/auth/login", { email: "ada@example.com", password: "secret" });
	await fetch(`${base}/api/me`, { headers: { authorization: `Bearer ${JWT}`, "x-csrf-token": "t" } });
	await post("/api/auth/register", { email: "bob@example.com", password: "secret" });
	await fetch(`${base}/api/me`);
	// Mobile: OTP request and verification
	await post("/api/otp/send", { phone: "+15550100" });
	await post("/api/otp/verify", { phone: "+15550100", code: "123456" });
	// OAuth
	await fetch(`${base}/auth/google`, { redirect: "manual" });
	await fetch(`${base}/auth/callback?code=xyz&state=st`, { redirect: "manual" });
	// API key, public endpoint, and a phone field that is not a login
	await fetch(`${base}/api/reports`, { headers: { "x-api-key": "k_123" } });
	await fetch(`${base}/api/reports`);
	await fetch(`${base}/api/health`);
	await fetch(`${base}/api/profile`, { method: "PUT", headers: { "content-type": "application/json", "x-api-key": "k_123" }, body: '{"phone":"+1555"}' });
});

after(async () => {
	await agent.close();
	upstream.close();
});

test("records no errors", () => {
	assert.deepEqual(errors, []);
});

test("detects credential schemes", () => {
	const schemes = agent.spec.components.securitySchemes;
	assert.deepEqual(schemes.bearerAuth, { type: "http", scheme: "bearer", bearerFormat: "JWT", "x-granthai-issued-by": ["POST /api/auth/login"] });
	assert.equal(schemes["apiKey_x-api-key"].in, "header");
	assert.deepEqual(schemes.cookie_sid["x-granthai-issued-by"], ["POST /login", "GET /auth/callback"]);
	// CSRF and analytics cookies are never credentials
	assert.equal(schemes.cookie_csrf, undefined);
	assert.equal(schemes.cookie__ga, undefined);
});

test("classifies login flows", () => {
	const auth = agent.spec["x-granthai-auth"];
	assert.deepEqual(auth.loginPages, ["/login"]);
	assert.equal(auth.logins["POST /login"].kind, "form");
	assert.deepEqual(auth.logins["POST /login"].cookies, ["sid"]);
	assert.deepEqual(auth.logins["POST /api/auth/login"], { kind: "password", returns: "token", tokenField: "access_token", jwt: true });
	assert.equal(auth.logins["POST /api/otp/send"].kind, "otp-request");
	assert.equal(auth.logins["POST /api/otp/verify"].kind, "otp-verify");
	assert.equal(auth.logins["POST /api/otp/verify"].tokenField, "data.token");
	assert.equal(auth.logins["GET /auth/callback"].kind, "oauth-callback");
	assert.equal(auth.logins["POST /api/auth/register"].kind, "signup");
	assert.deepEqual(auth.oauth["GET /auth/google"], {
		provider: "accounts.google.com",
		authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth",
		scopes: ["openid", "email"]
	});
	// A profile update with a phone number is not an OTP login
	assert.equal(auth.logins["PUT /api/profile"], undefined);
});

test("marks which endpoints need credentials", () => {
	const paths = agent.spec.paths;
	assert.deepEqual(paths["/api/me"].get.security, [{ cookie_sid: [] }, { bearerAuth: [] }]);
	assert.deepEqual(paths["/api/reports"].get.security, [{ "apiKey_x-api-key": [] }]);
	assert.equal(paths["/api/health"].get.security, undefined);
	assert.deepEqual(paths["/api/auth/login"].post.security, []);
	assert.deepEqual(paths["/api/auth/login"].post.tags, ["Authentication"]);
	// Form logins are documented even though they answer with a redirect
	assert.ok(paths["/login"].post.responses[302]);
});

test("summarises auth at the top of the docs", () => {
	const description = agent.spec.info.description;
	assert.match(description, /## Authentication/);
	assert.match(description, /\*\*Bearer token\*\* .*\(JWT\), issued by `POST \/api\/auth\/login`/);
	assert.match(description, /\*\*Login page\*\* at `\/login`/);
	assert.match(description, /\*\*OAuth sign-in\*\* with `accounts.google.com`/);
	assert.match(description, /`POST \/api\/otp\/send`: sends a one-time code/);
	assert.match(description, /\*\*CSRF protection\*\*: requests also send the `x-csrf-token` header/);
});

test("keeps logins out of MCP tools and explains auth", async () => {
	const res = await fetch(`${base}/_granthai/mcp`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" })
	});
	const { tools } = (await res.json()).result;
	const names = tools.map((tool) => tool.name);
	assert.ok(!names.some((name) => /login|otp|callback/.test(name)), names.join(", "));
	assert.equal(tools.find((tool) => tool.name === "get_api_me").description, "GET /api/me (requires the sid session cookie or a Bearer token)");
	assert.equal(tools.find((tool) => tool.name === "get_api_health").description, "GET /api/health");
});
