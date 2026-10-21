// Minimal MCP client for the agent's MCP endpoint, shared by every example.
//
//   node ../mcp.mjs watch                      # print tools as the agent discovers them
//   node ../mcp.mjs tools                      # list every tool
//   node ../mcp.mjs call <tool> '<json args>'  # call one, e.g. call get_petclinic_api_owners_ownerId '{"ownerId":1}'
//
// MCP_URL   agent MCP endpoint (default http://localhost:4000/_granthai/mcp)
// MCP_AUTH  value for the Authorization header, forwarded by the agent to the app
const MCP_URL = process.env.MCP_URL || "http://localhost:4000/_granthai/mcp";

let nextId = 1;
async function rpc(method, params) {
	const headers = { "content-type": "application/json", accept: "application/json, text/event-stream" };
	if (process.env.MCP_AUTH) headers.authorization = process.env.MCP_AUTH;

	const res = await fetch(MCP_URL, { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, params }) });
	const message = await res.json();
	if (message.error) throw new Error(`${method}: ${message.error.message}`);
	return message.result;
}

const [command = "tools", ...rest] = process.argv.slice(2);

const init = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "granthai-example", version: "1.0.0" } });

if (command === "tools") {
	const { tools } = await rpc("tools/list");
	for (const tool of tools) {
		const args = Object.keys(tool.inputSchema.properties || {}).join(", ");
		console.log(`${tool.name.padEnd(60)} ${args}`);
	}
	console.log(`\n${tools.length} tools from ${init.serverInfo.name}`);
} else if (command === "watch") {
	console.log(`Watching ${MCP_URL} (${init.serverInfo.name}). Run traffic.sh or use the app; Ctrl+C to stop.\n`);
	const seen = new Set();
	for (;;) {
		const { tools } = await rpc("tools/list");
		for (const tool of tools) {
			if (seen.has(tool.name)) continue;
			seen.add(tool.name);
			console.log(`${new Date().toLocaleTimeString()}  +${String(seen.size).padStart(3)}  ${tool.name.padEnd(60)} ${tool.description}`);
		}
		await new Promise((resolve) => setTimeout(resolve, 1000));
	}
} else if (command === "call") {
	const [name, json = "{}"] = rest;
	if (!name) throw new Error("Usage: node mcp.mjs call <tool> '<json args>'");
	const result = await rpc("tools/call", { name, arguments: JSON.parse(json) });
	for (const item of result.content) console.log(item.text);
	process.exitCode = result.isError ? 1 : 0;
} else {
	console.error(`Unknown command ${command}. Use tools, watch or call.`);
	process.exitCode = 1;
}
