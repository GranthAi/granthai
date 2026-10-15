// Infers a JSON Schema (2020-12, as used by OpenAPI 3.1) from a sample value
function generateSchema(data) {
	if (data === null) {
		return { type: "null" };
	}
	if (Array.isArray(data)) {
		// An empty array tells us nothing about its items, so leave them unconstrained
		return data.length > 0 ? { type: "array", items: generateSchema(data[0]) } : { type: "array" };
	}

	switch (typeof data) {
		case "object": {
			const properties = {};
			for (const key in data) {
				if (data[key] !== undefined) {
					properties[key] = generateSchema(data[key]);
				}
			}
			return { type: "object", properties };
		}
		case "number":
			return { type: Number.isInteger(data) ? "integer" : "number" };
		case "string":
		case "boolean":
			return { type: typeof data };
		default:
			// undefined, functions, etc. have no JSON representation
			return {};
	}
}

// Normalize through JSON first so Dates, Mongoose documents and other toJSON() values
// are described the way res.json() actually serializes them
module.exports = function (data) {
	const json = JSON.stringify(data);
	return generateSchema(json === undefined ? undefined : JSON.parse(json));
};
