// Infers JSON Schema (2020-12, as used by OpenAPI 3.1) from sample values, and merges the
// schemas of successive samples so optional and nullable fields accumulate instead of the
// latest response overwriting everything seen before
function inferSchema(data) {
	if (data === null) return { type: "null" };
	if (Array.isArray(data)) {
		const items = data.reduce((merged, item) => mergeSchema(merged, inferSchema(item)), undefined);
		return items ? { type: "array", items } : { type: "array" };
	}
	switch (typeof data) {
		case "object": {
			const properties = {};
			for (const key in data) properties[key] = inferSchema(data[key]);
			return { type: "object", properties };
		}
		case "number":
			return { type: Number.isInteger(data) ? "integer" : "number" };
		case "string":
		case "boolean":
			return { type: typeof data };
		default:
			return {};
	}
}

function typesOf(schema) {
	return schema.type === undefined ? [] : [].concat(schema.type);
}

function mergeSchema(a, b) {
	// {} means "nothing known yet", so the other side wins
	if (!a || Object.keys(a).length === 0) return b;
	if (!b || Object.keys(b).length === 0) return a;

	let types = [...new Set([...typesOf(a), ...typesOf(b)])];
	if (types.includes("number")) types = types.filter((type) => type !== "integer");
	const merged = { type: types.length === 1 ? types[0] : types };

	if (types.includes("object")) {
		const properties = { ...a.properties };
		for (const key in b.properties) properties[key] = mergeSchema(properties[key], b.properties[key]);
		merged.properties = properties;
	}
	if (types.includes("array")) {
		const items = mergeSchema(a.items, b.items);
		if (items) merged.items = items;
	}
	if (a.format && a.format === b.format) merged.format = a.format;
	return merged;
}

module.exports = { inferSchema, mergeSchema };
