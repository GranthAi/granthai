const generateSchema = require("./schemaGenerator");
const swaggerTemplate = require("./swaggerTemplate");
const handleMcpRequest = require("./mcpServer");
const fs = require("fs");
const { STATUS_CODES } = require("http");

var Mixpanel = require("mixpanel");
var mixpanel = Mixpanel.init("f33b80a16f963e03c771000a4477972a");

var jsonData = {
	openapi: "3.1.0",
	info: {
		title: "Example API",
		version: "1.0.0"
	},
	servers: [],
	paths: {}
};

var FUNC_REGISTERED = false;

function safeDecode(segment) {
	try {
		return decodeURIComponent(segment);
	} catch (err) {
		return segment;
	}
}

function GranthAi({ docTitle, baseUrl, key, mcp = true, mcpAllowedOrigins = [] }) {
	if (!baseUrl || baseUrl.length < 5) {
		console.error("[GranthAi] Server baseUrl key not provided!...");
	}

	jsonData.info.title = docTitle || "API Documentation";
	if (baseUrl && baseUrl.length > 0) {
		jsonData.servers.push({ url: baseUrl, description: `${docTitle} server` });
	}

	if (!FUNC_REGISTERED) {
		console.log("[GranthAi] Please help us improve the service by signing up here - https://granthai.com/");
		FUNC_REGISTERED = true;
	}

	return async function (req, res, next) {
		const send = res.json;
		let firstpass = false;

		if (req.path.includes("/api-docs")) {
			return res.send(swaggerTemplate(jsonData));
		}

		if (mcp && (req.path === "/mcp-server" || req.path === "/mcp-server/")) {
			return handleMcpRequest(req, res, { spec: jsonData, baseUrl, allowedOrigins: mcpAllowedOrigins });
		}

		mixpanel.track("granthai-node-middleware", {
			distinct_id: baseUrl || req.get("host"),
			route: req.originalUrl
		});

		res.json = function (body) {
			if (!firstpass) {
				firstpass = true;
				const status = res.statusCode;
				const paramsLength = Object.keys(req.params).length;
				let path = req.originalUrl.split("?")[0];

				if (paramsLength > 0) {
					path = path.split("/");
					const params = req.params;
					for (let i = 0; i < path.length; i++) {
						for (const obj in params) {
							if (path[i] === params[obj] || safeDecode(path[i]) === params[obj]) {
								path[i] = "{" + obj + "}";
							}
						}
					}
					path = path.join("/");
				}

				if (!jsonData.paths[path]) {
					jsonData.paths[path] = {};
				}
				const method = req.method.toLowerCase();
				if (!jsonData.paths[path][method]) {
					jsonData.paths[path][method] = {
						summary: "",
						parameters: [],
						responses: {}
					};
				}
				if (req.params) {
					const params = req.params;
					for (const obj in params) {
						const p = {
							name: obj,
							in: "path",
							required: true,
							schema: {
								type: "string"
							}
						};
						if (/^-?\d+$/.test(params[obj])) {
							p.schema.type = "integer";
						}
						let found = false;
						for (const a of jsonData.paths[path][method].parameters) {
							if (a.name === p.name && a.in === "path") {
								found = true;
							}
						}
						if (!found) {
							jsonData.paths[path][method].parameters.push(p);
						}
					}
				}
				if (req.query) {
					const params = req.query;
					for (const obj in params) {
						const p = {
							name: obj,
							in: "query",
							schema: {
								type: "string"
							},
							description: ""
						};
						if (/^-?\d+$/.test(params[obj])) {
							p.schema.type = "integer";
						}
						let found = false;
						for (const a of jsonData.paths[path][method].parameters) {
							if (a.name === p.name && a.in === "query") {
								found = true;
							}
						}
						if (!found) {
							jsonData.paths[path][method].parameters.push(p);
						}
					}
				}

				const reqContentType = (req.headers["content-type"] || "").split(";")[0].trim();
				const data = req.body;

				if ((method === "post" || method === "put" || method === "patch") && reqContentType && data !== undefined) {
					const operation = jsonData.paths[path][method];
					if (!operation.requestBody) {
						operation.requestBody = { required: false, content: {} };
					}
					operation.requestBody.content[reqContentType] = {
						schema: generateSchema(data)
					};
				}

				if (!jsonData.paths[path][method].responses[status]) {
					jsonData.paths[path][method].responses[status] = {
						description: STATUS_CODES[status] || "",
						content: {}
					};
				}
				// res.json() always sends JSON, whatever the type of body
				jsonData.paths[path][method].responses[status].content["application/json"] = {
					schema: generateSchema(body)
				};

				fs.writeFile("./openapi.json", JSON.stringify(jsonData), (err) => {
					//console.log("Written data");
				});
			}
			send.call(this, body);
		};
		next();
	};
}

module.exports = GranthAi;
