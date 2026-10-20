// Folds observed request/response exchanges into an OpenAPI 3.1 document and keeps it
// saved on disk, so the spec survives agent restarts. Only schemas are stored, never values.
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const { STATUS_CODES } = require("http");
const { inferSchema, mergeSchema } = require("./schema");
const { createPathTemplater, classifySegment } = require("./pathTemplate");

const SAVE_DELAY_MS = 1000;
const NON_API_TYPES = /^(text\/(html|css|javascript|event-stream)|application\/(javascript|wasm)|image\/|font\/|audio\/|video\/)/;

function baseType(contentType) {
	return (contentType || "").split(";")[0].trim().toLowerCase();
}

function isJsonType(type) {
	return type === "application/json" || type.endsWith("+json");
}

function decodeBody(buffer, encoding) {
	switch ((encoding || "").trim().toLowerCase()) {
		case "":
		case "identity":
			return buffer;
		case "gzip":
		case "x-gzip":
			return zlib.gunzipSync(buffer);
		case "deflate":
			return zlib.inflateSync(buffer);
		case "br":
			return zlib.brotliDecompressSync(buffer);
		default:
			throw new Error(`Unsupported content-encoding ${encoding}`);
	}
}

function bodySchema(buffer, type) {
	if (isJsonType(type)) return inferSchema(JSON.parse(buffer.toString("utf8")));
	if (type === "application/x-www-form-urlencoded") {
		const properties = {};
		for (const key of new URLSearchParams(buffer.toString("utf8")).keys()) properties[key] = { type: "string" };
		return { type: "object", properties };
	}
	if (type === "multipart/form-data") return { type: "object" };
	if (type.startsWith("text/")) return { type: "string" };
	return { type: "string", format: "binary" };
}

// Static assets, pages and streams pass through the proxy but are not API operations
function isApiExchange({ method, status, resType }) {
	if (method === "HEAD" || method === "OPTIONS" || status === 101) return false;
	if (isJsonType(resType)) return true;
	if (NON_API_TYPES.test(resType)) return false;
	return method !== "GET";
}

function widenParamSchema(existing, incoming) {
	if (existing.type === incoming.type && existing.format === incoming.format) return existing;
	if (existing.type === "integer" && incoming.type === "integer") return existing;
	return { type: "string" };
}

function upsertParam(operation, param) {
	const existing = operation.parameters.find((p) => p.name === param.name && p.in === param.in);
	if (existing) {
		existing.schema = widenParamSchema(existing.schema, param.schema);
	} else {
		operation.parameters.push(param);
	}
}

function emptySpec(title = "API Documentation") {
	return { openapi: "3.1.0", info: { title, version: "1.0.0" }, paths: {} };
}

function loadSpec(file, title) {
	try {
		const spec = JSON.parse(fs.readFileSync(file, "utf8"));
		if (spec && spec.openapi && spec.paths) return spec;
		console.warn(`[granthai] ${file} is not an OpenAPI document, starting with an empty spec`);
	} catch (err) {
		if (err.code !== "ENOENT") console.warn(`[granthai] Could not read ${file} (${err.message}), starting with an empty spec`);
	}
	return emptySpec(title);
}

function createRecorder({ title, specFile, routes = [], publicUrl } = {}) {
	const spec = specFile ? loadSpec(specFile, title) : emptySpec(title);
	if (title) spec.info.title = title;
	if (publicUrl) spec.servers = [{ url: publicUrl }];
	const templatePath = createPathTemplater(routes);
	let saveTimer = null;

	function saveNow() {
		clearTimeout(saveTimer);
		saveTimer = null;
		if (!specFile) return;
		const tmp = `${specFile}.tmp`;
		fs.mkdirSync(path.dirname(path.resolve(specFile)), { recursive: true });
		fs.writeFileSync(tmp, JSON.stringify(spec, null, 2));
		fs.renameSync(tmp, specFile);
	}

	function scheduleSave() {
		if (!specFile || saveTimer) return;
		saveTimer = setTimeout(() => {
			try {
				saveNow();
			} catch (err) {
				console.warn(`[granthai] Could not save ${specFile}: ${err.message}`);
			}
		}, SAVE_DELAY_MS);
		saveTimer.unref();
	}

	// exchange: { method, url, reqHeaders, reqBody, reqTruncated, status, resHeaders, resBody, resTruncated }
	function record(exchange) {
		const method = exchange.method.toUpperCase();
		const status = exchange.status;
		const reqType = baseType(exchange.reqHeaders["content-type"]);
		const resType = baseType(exchange.resHeaders["content-type"]);
		if (!isApiExchange({ method, status, resType })) return false;

		const url = new URL(exchange.url, "http://granthai.local");
		const { template, params } = templatePath(url.pathname);
		const key = method.toLowerCase();

		// A 404/405 must not invent new endpoints (scanners, typos), only describe known ones
		const known = spec.paths[template] && spec.paths[template][key];
		if (!known && (status === 404 || status === 405)) return false;

		spec.paths[template] = spec.paths[template] || {};
		const operation = (spec.paths[template][key] = known || { summary: "", parameters: [], responses: {} });

		for (const param of params) {
			upsertParam(operation, { name: param.name, in: "path", required: true, schema: param.schema });
		}
		for (const name of new Set(url.searchParams.keys())) {
			const values = url.searchParams.getAll(name);
			const allIntegers = values.every((value) => classifySegment(value)?.type === "integer");
			upsertParam(operation, { name, in: "query", schema: { type: allIntegers ? "integer" : "string" } });
		}

		if (exchange.reqBody && exchange.reqBody.length > 0 && reqType && !exchange.reqTruncated) {
			try {
				const schema = bodySchema(decodeBody(exchange.reqBody, exchange.reqHeaders["content-encoding"]), reqType);
				operation.requestBody = operation.requestBody || { required: false, content: {} };
				const media = operation.requestBody.content[reqType];
				operation.requestBody.content[reqType] = { schema: mergeSchema(media && media.schema, schema) };
			} catch (err) {
				// Bodies that don't parse as their declared type are left out of the spec
			}
		}

		const response = (operation.responses[status] = operation.responses[status] || { description: STATUS_CODES[status] || "" });
		if (exchange.resBody && exchange.resBody.length > 0 && resType && !exchange.resTruncated) {
			try {
				const schema = bodySchema(decodeBody(exchange.resBody, exchange.resHeaders["content-encoding"]), resType);
				response.content = response.content || {};
				const media = response.content[resType];
				response.content[resType] = { schema: mergeSchema(media && media.schema, schema) };
			} catch (err) {
				// Same as request bodies: skip what can't be parsed
			}
		}

		scheduleSave();
		return true;
	}

	return { spec, record, save: saveNow };
}

module.exports = { createRecorder };
