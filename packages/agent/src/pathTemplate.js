// Turns concrete request paths into OpenAPI path templates without any help from the
// framework: /api/projects/42/tasks/9f1c...-uuid -> /api/projects/{projectId}/tasks/{taskId}.
// Explicit --route templates win; otherwise segments that look like identifiers become params.

const PARAM_PATTERNS = [
	{ test: /^-?\d+$/, schema: { type: "integer" } },
	{ test: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, schema: { type: "string", format: "uuid" } },
	{ test: /^[^@/]+@[^@/]+\.[^@/]+$/, schema: { type: "string", format: "email" } },
	// Mongo ObjectIds, hashes and other long hex ids
	{ test: /^(?=.*\d)[0-9a-f]{16,}$/i, schema: { type: "string" } },
	// ULIDs, nanoids, base64url tokens: long, mixed letters and digits
	{ test: /^(?=.*\d)(?=.*[a-z])[a-z0-9_-]{20,}$/i, schema: { type: "string" } }
];

function safeDecode(segment) {
	try {
		return decodeURIComponent(segment);
	} catch (err) {
		return segment;
	}
}

function classifySegment(segment) {
	const match = PARAM_PATTERNS.find((pattern) => pattern.test.test(segment));
	return match ? match.schema : null;
}

// "projects" -> "projectId", "task-lists" -> "taskListId", "categories" -> "categoryId"
function paramNameFor(previousSegment) {
	if (!previousSegment || !/^[a-z][a-z0-9_-]*$/i.test(previousSegment)) return "id";
	const camel = previousSegment.replace(/[-_]+([a-z0-9])/gi, (_, char) => char.toUpperCase());
	const singular = camel.replace(/ies$/, "y").replace(/(ss|us|is)$/, "$1").replace(/([^s])s$/, "$1");
	return `${singular}Id`;
}

// "/repos/{owner}/{repo}/**" templates the prefix and leaves the rest of the path to the heuristics
function compileRoute(route) {
	const names = [];
	const prefix = route.endsWith("/**");
	const template = prefix ? route.slice(0, -3) : route;
	const source = template
		.split("/")
		.map((segment) =>
			segment.replace(/[.*+?^$()|[\]\\]|\{(\w+)(\*)?\}/g, (token, name, wildcard) => {
				if (!name) return `\\${token}`;
				names.push(name);
				return wildcard ? "(.+)" : "([^/]+)";
			})
		)
		.join("/");
	return {
		template: template.replace(/\{(\w+)\*\}/g, "{$1}"),
		names,
		prefix,
		regex: new RegExp(prefix ? `^${source}(/.*)?$` : `^${source}/?$`)
	};
}

// Replaces identifier-looking segments with {params} named after the segment before them
function templateSegments(rawPath, params, used, previous = "") {
	return rawPath
		.split("/")
		.map((segment, i, all) => {
			const value = safeDecode(segment);
			const schema = value && classifySegment(value);
			if (!schema) return segment;

			let name = paramNameFor(safeDecode(i > 0 ? all[i - 1] : previous));
			for (let n = 2; used.has(name); n++) name = `${name.replace(/\d+$/, "")}${n}`;
			used.add(name);
			params.push({ name, value, schema });
			return `{${name}}`;
		})
		.join("/");
}

function createPathTemplater(routes = []) {
	const compiled = routes.map(compileRoute);

	return function templatePath(rawPath) {
		for (const route of compiled) {
			const match = route.regex.exec(rawPath);
			if (!match) continue;
			const params = route.names.map((name, i) => {
				const value = safeDecode(match[i + 1]);
				return { name, value, schema: classifySegment(value) || { type: "string" } };
			});
			const rest = route.prefix ? match[route.names.length + 1] || "" : "";
			if (!rest) return { template: route.template, params };

			const previous = route.template.split("/").pop();
			const restTemplate = templateSegments(rest, params, new Set(route.names), /^\{/.test(previous) ? "" : previous);
			return { template: route.template + restTemplate, params };
		}

		const params = [];
		const template = templateSegments(rawPath, params, new Set());
		return { template: template || "/", params };
	};
}

module.exports = { createPathTemplater, classifySegment };
