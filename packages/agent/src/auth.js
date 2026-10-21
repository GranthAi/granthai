// Detects how an API authenticates from the traffic flowing through the agent: which credential
// each request carries (bearer, basic, API key, session cookie), which endpoints need one, and
// how users obtain one (password login, login page, OTP, OAuth). Credential values are never
// stored; issued tokens are only kept as short-lived hashes to link a login to the scheme it feeds.
const crypto = require("crypto");

const JWT = /^eyJ[\w-]+\.[\w-]+\.[\w-]*$/;
const TOKEN_KEYS = /^(access[_-]?token|id[_-]?token|auth[_-]?token|session[_-]?token|token|jwt|api[_-]?key)$/i;
const PASSWORD_KEYS = /^(password|passwd|pwd|pass|user[_-]?password)$/i;
const IDENTIFIER_KEYS = /^(email|username|user[_-]?name|login|user|identifier|phone|mobile)$/i;
const PHONE_KEYS = /^(phone|mobile|msisdn|phone[_-]?number|mobile[_-]?number)$/i;
const OTP_KEYS = /^(otp|code|otp[_-]?code|verification[_-]?code|pin|totp)$/i;
const AUTH_PATH = /(^|[/_.-])(auth|login|logon|signin|sign-in|session|sessions|token|otp|verify|oauth|sso)([/_.-]|$)/i;
const API_KEY_HEADER = /^((x-)?api[-_]?key|[a-z0-9-]+-api-key|(x-)?(auth|access|session)[-_]?token|x-token)$/i;
const API_KEY_QUERY = /^(api[_-]?key|apikey|access[_-]?token|auth[_-]?token)$/i;
const SESSION_COOKIE_NAME = /(sess|sid|auth|token|jwt|remember|login)/i;
const NOT_SESSION_COOKIE = /csrf|xsrf|^_ga|^_gid|^_gcl|^_fbp|^_hj|^ajs_|^mp_|amplitude|intercom|consent|^lang|locale|theme|redirect_to/i;
const MAX_TRACKED_TOKENS = 1000;

const SIGNUP_PATH = /(^|[/_.-])(sign-?up|register|registration|join)([/_.-]|$)/i;

const LOGIN_LABELS = {
	password: "password login",
	signup: "creates an account and signs in",
	form: "login form",
	"otp-request": "sends a one-time code",
	"otp-verify": "verifies a one-time code",
	"oauth-callback": "OAuth callback"
};

function hash(value) {
	return crypto.createHash("sha256").update(value).digest("hex");
}

function safeKey(value) {
	return value.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function parseBody(text, type) {
	if (!text) return null;
	try {
		if (type === "application/json" || type.endsWith("+json")) return JSON.parse(text);
		if (type === "application/x-www-form-urlencoded") return Object.fromEntries(new URLSearchParams(text));
	} catch (err) {
		// Not parseable: nothing to learn from it
	}
	return null;
}

// Field names (and, for OTP codes, value shapes) of a login-like body, one level deep
function bodyFields(body) {
	const fields = { password: false, identifier: false, phone: false, otp: false };
	if (!body || typeof body !== "object" || Array.isArray(body)) return fields;
	const visit = (object, depth) => {
		for (const [key, value] of Object.entries(object)) {
			if (value && typeof value === "object" && !Array.isArray(value) && depth === 0) visit(value, 1);
			if (PASSWORD_KEYS.test(key)) fields.password = true;
			if (IDENTIFIER_KEYS.test(key)) fields.identifier = true;
			if (PHONE_KEYS.test(key)) fields.phone = true;
			if (OTP_KEYS.test(key) && /^\d{4,8}$/.test(String(value))) fields.otp = true;
		}
	};
	visit(body, 0);
	return fields;
}

function findToken(value, depth = 0, field = "") {
	if (typeof value === "string") {
		if (JWT.test(value)) return { field, value, jwt: true };
		if (TOKEN_KEYS.test(field.split(".").pop()) && value.length >= 16) return { field, value, jwt: false };
		return null;
	}
	if (!value || typeof value !== "object" || Array.isArray(value) || depth > 2) return null;
	for (const [key, child] of Object.entries(value)) {
		const found = findToken(child, depth + 1, field ? `${field}.${key}` : key);
		if (found) return found;
	}
	return null;
}

function cookieNames(header) {
	return (header || "")
		.split(";")
		.map((part) => part.split("=")[0].trim())
		.filter(Boolean);
}

// Cookies a response sets, minus ones it deletes (logout) and ones that are never credentials
function setCookies(header) {
	const result = [];
	for (const cookie of [].concat(header || [])) {
		const name = cookie.split("=")[0].trim();
		const attributes = cookie.toLowerCase();
		const deleted = /max-age=0\b/.test(attributes) || /expires=thu, 01 jan 1970/.test(attributes);
		if (name && !deleted && !NOT_SESSION_COOKIE.test(name)) result.push({ name, httpOnly: attributes.includes("httponly") });
	}
	return result;
}

function createAuthDetector(spec) {
	spec.components = spec.components || {};
	const schemes = (spec.components.securitySchemes = spec.components.securitySchemes || {});
	const state = (spec["x-granthai-auth"] = spec["x-granthai-auth"] || {});
	state.sessionCookies = state.sessionCookies || [];
	state.loginPages = state.loginPages || [];
	state.logins = state.logins || {};
	state.oauth = state.oauth || {};
	state.csrfHeaders = state.csrfHeaders || [];
	const issuedTokens = new Map();

	function addScheme(key, scheme) {
		// describe() drops the empty containers from the spec, so re-attach them on first use
		spec.components = spec.components || {};
		spec.components.securitySchemes = schemes;
		if (!schemes[key]) schemes[key] = scheme;
		else if (scheme.bearerFormat && !schemes[key].bearerFormat) schemes[key].bearerFormat = scheme.bearerFormat;
		return key;
	}

	function linkIssuedToken(key, value) {
		const login = issuedTokens.get(hash(value));
		if (!login) return;
		const issuedBy = (schemes[key]["x-granthai-issued-by"] = schemes[key]["x-granthai-issued-by"] || []);
		if (!issuedBy.includes(login)) issuedBy.push(login);
	}

	// Security scheme keys for every credential the request carries
	function credentialsOf(headers, url) {
		const found = [];
		const authorization = headers.authorization;
		if (authorization) {
			const [rawScheme, ...rest] = authorization.trim().split(/\s+/);
			const value = rest.join(" ");
			const scheme = rawScheme.toLowerCase();
			let key;
			if (scheme === "bearer") {
				key = addScheme("bearerAuth", { type: "http", scheme: "bearer", ...(JWT.test(value) ? { bearerFormat: "JWT" } : {}) });
			} else if (scheme === "basic") {
				key = addScheme("basicAuth", { type: "http", scheme: "basic" });
			} else if (value) {
				key = addScheme(safeKey(`authorization_${scheme}`), {
					type: "apiKey",
					in: "header",
					name: "Authorization",
					description: `Send \`Authorization: ${rawScheme} <token>\``
				});
			}
			if (key) {
				found.push(key);
				if (value) linkIssuedToken(key, value);
			}
		}

		for (const name of Object.keys(headers)) {
			if (name === "authorization" || /csrf|xsrf/i.test(name) || !API_KEY_HEADER.test(name)) continue;
			const key = addScheme(safeKey(`apiKey_${name}`), { type: "apiKey", in: "header", name });
			found.push(key);
			linkIssuedToken(key, String(headers[name]));
		}

		for (const name of new Set(url.searchParams.keys())) {
			if (API_KEY_QUERY.test(name)) found.push(addScheme(safeKey(`apiKeyQuery_${name}`), { type: "apiKey", in: "query", name }));
		}

		for (const name of cookieNames(headers.cookie)) {
			if (NOT_SESSION_COOKIE.test(name)) continue;
			if (!state.sessionCookies.includes(name) && !SESSION_COOKIE_NAME.test(name)) continue;
			found.push(addScheme(safeKey(`cookie_${name}`), { type: "apiKey", in: "cookie", name }));
		}
		return found;
	}

	// ex: { method, url, template, status, reqHeaders, resHeaders, reqType, resType, reqText, resText }
	function analyze(ex) {
		const method = ex.method.toUpperCase();
		const ok = ex.status < 400;
		const url = new URL(ex.url, "http://granthai.local");
		const credentials = credentialsOf(ex.reqHeaders, url);
		const opKey = `${method} ${ex.template}`;

		for (const name of Object.keys(ex.reqHeaders)) {
			if (/^x-(csrf|xsrf)-token$/i.test(name) && !state.csrfHeaders.includes(name)) state.csrfHeaders.push(name);
		}

		const cookies = setCookies(ex.resHeaders["set-cookie"]);
		for (const cookie of cookies) {
			if (cookie.httpOnly && !state.sessionCookies.includes(cookie.name)) state.sessionCookies.push(cookie.name);
		}

		// A page with a password field is where people sign in through the browser
		if (ok && method === "GET" && ex.resType === "text/html" && /<input[^>]*type=["']?password/i.test(ex.resText || "")) {
			if (!state.loginPages.includes(ex.template)) state.loginPages.push(ex.template);
		}

		const location = ex.resHeaders.location;
		if (ex.status >= 300 && ex.status < 400 && location) {
			try {
				const target = new URL(location, url);
				const params = target.searchParams;
				if (target.origin !== url.origin && params.get("client_id") && (params.get("redirect_uri") || params.get("response_type"))) {
					state.oauth[opKey] = {
						provider: target.host,
						authorizationUrl: `${target.origin}${target.pathname}`,
						scopes: (params.get("scope") || "").split(/[\s+]+/).filter(Boolean)
					};
				}
			} catch (err) {
				// Unparseable redirect: ignore
			}
		}

		let login = null;
		if (ok) {
			const fields = bodyFields(parseBody(ex.reqText, ex.reqType));
			const token = findToken(parseBody(ex.resText, ex.resType));
			const sessionSet = cookies.length > 0;
			const redirect = ex.status >= 300;
			const looksLikeAuth = AUTH_PATH.test(ex.template);

			if (method !== "GET" && fields.password && (fields.identifier || looksLikeAuth) && (token || sessionSet || redirect)) {
				const kind = SIGNUP_PATH.test(ex.template) ? "signup" : token || ex.reqType === "application/json" ? "password" : "form";
				login = { kind };
			} else if (method !== "GET" && fields.otp && (token || sessionSet)) {
				login = { kind: "otp-verify" };
			} else if (method !== "GET" && fields.phone && !fields.password && !token && looksLikeAuth) {
				login = { kind: "otp-request" };
			} else if (method === "GET" && url.searchParams.get("code") && url.searchParams.get("state") && (token || sessionSet || redirect)) {
				login = { kind: "oauth-callback" };
			}

			if (login) {
				if (token) {
					login.returns = "token";
					login.tokenField = token.field;
					if (token.jwt) login.jwt = true;
					if (issuedTokens.size >= MAX_TRACKED_TOKENS) issuedTokens.delete(issuedTokens.keys().next().value);
					issuedTokens.set(hash(token.value), opKey);
				} else if (sessionSet) {
					login.returns = "cookie";
					login.cookies = cookies.map((cookie) => cookie.name);
					for (const cookie of cookies) {
						if (!state.sessionCookies.includes(cookie.name)) state.sessionCookies.push(cookie.name);
						const key = addScheme(safeKey(`cookie_${cookie.name}`), { type: "apiKey", in: "cookie", name: cookie.name });
						const issuedBy = (schemes[key]["x-granthai-issued-by"] = schemes[key]["x-granthai-issued-by"] || []);
						if (!issuedBy.includes(opKey)) issuedBy.push(opKey);
					}
				}
				state.logins[opKey] = { ...state.logins[opKey], ...login };
			}
		}

		return { credentials, login: login || (state.logins[opKey] ? state.logins[opKey] : null) };
	}

	function applyToOperation(operation, analysis, status) {
		if (analysis.login) {
			operation["x-granthai-login"] = analysis.login.kind;
			operation.tags = ["Authentication"];
			operation.security = [];
			delete operation["x-granthai-auth"];
			return;
		}

		const seen = (operation["x-granthai-auth"] = operation["x-granthai-auth"] || { schemes: [], public: false, rejectsAnonymous: false });
		if (status < 400) {
			if (analysis.credentials.length === 0) seen.public = true;
			for (const key of analysis.credentials) if (!seen.schemes.includes(key)) seen.schemes.push(key);
		} else if ((status === 401 || status === 403) && analysis.credentials.length === 0) {
			seen.rejectsAnonymous = true;
		}

		const required = seen.schemes.length > 0 ? seen.schemes : seen.rejectsAnonymous ? Object.keys(schemes) : [];
		if (required.length > 0) {
			// {} marks auth as optional: the endpoint also answered without credentials
			operation.security = [...(seen.public ? [{}] : []), ...required.map((key) => ({ [key]: [] }))];
		} else {
			delete operation.security;
		}
	}

	// Human-readable summary at the top of the docs, regenerated as more traffic is seen
	function describe() {
		const lines = [];
		for (const [key, scheme] of Object.entries(schemes)) {
			let line;
			if (scheme.type === "http" && scheme.scheme === "bearer") line = `**Bearer token** in \`Authorization: Bearer <token>\`${scheme.bearerFormat ? " (JWT)" : ""}`;
			else if (scheme.type === "http" && scheme.scheme === "basic") line = "**Basic auth** with username and password in `Authorization: Basic <base64>`";
			else if (scheme.in === "cookie") line = `**Session cookie** \`${scheme.name}\``;
			else if (scheme.in === "query") line = `**API key** in the \`${scheme.name}\` query parameter`;
			else if (scheme.name === "Authorization") line = `**Token** in \`Authorization\`: ${scheme.description.replace(/^Send /, "")}`;
			else line = `**API key** in the \`${scheme.name}\` header`;
			const issuedBy = scheme["x-granthai-issued-by"];
			if (issuedBy && issuedBy.length) line += `, issued by ${issuedBy.map((op) => `\`${op}\``).join(", ")}`;
			lines.push(`- ${line} (\`${key}\`)`);
		}
		for (const [op, login] of Object.entries(state.logins)) {
			const returns = login.returns === "token" ? ` returns a token in \`${login.tokenField}\`` : login.returns === "cookie" ? " sets the session cookie" : "";
			lines.push(`- \`${op}\`: ${LOGIN_LABELS[login.kind] || login.kind}${returns ? `,${returns}` : ""}`);
		}
		for (const header of state.csrfHeaders) lines.push(`- **CSRF protection**: requests also send the \`${header}\` header`);
		for (const page of state.loginPages) lines.push(`- **Login page** at \`${page}\` (sign in through the browser)`);
		for (const [op, oauth] of Object.entries(state.oauth)) {
			lines.push(`- **OAuth sign-in** with \`${oauth.provider}\`, started at \`${op}\`${oauth.scopes.length ? ` (scopes: ${oauth.scopes.join(", ")})` : ""}`);
		}

		const block = lines.length
			? `<!-- granthai:auth -->\n\n## Authentication\n\n_Detected by GranthAi from live traffic._\n\n${lines.join("\n")}\n\nEndpoints with a lock need one of these credentials.\n\n<!-- /granthai:auth -->`
			: "";
		const current = (spec.info.description || "").replace(/<!-- granthai:auth -->[\s\S]*<!-- \/granthai:auth -->/, "").trim();
		const description = [current, block].filter(Boolean).join("\n\n");
		if (description) spec.info.description = description;
		else delete spec.info.description;
		if (spec.components && Object.keys(schemes).length === 0) delete spec.components.securitySchemes;
		if (spec.components && Object.keys(spec.components).length === 0) delete spec.components;
	}

	return { analyze, applyToOperation, describe };
}

module.exports = { createAuthDetector };
