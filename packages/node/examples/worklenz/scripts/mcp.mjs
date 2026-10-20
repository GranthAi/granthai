// Minimal MCP client for GranthAi's /mcp-server, authenticated with the session saved by traffic.mjs.
//
//   node scripts/mcp.mjs watch                      # print tools as GranthAi discovers them
//   node scripts/mcp.mjs tools                      # list every tool
//   node scripts/mcp.mjs call <tool> '<json args>'  # call one, e.g. call get_api_v1_projects_id '{"id":"..."}'
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const MCP_URL = process.env.MCP_URL || "http://localhost:3000/mcp-server";
const sessionFile = fileURLToPath(new URL("../.session.json", import.meta.url));
const session = existsSync(sessionFile) ? JSON.parse(readFileSync(sessionFile, "utf8")) : {};

let nextId = 1;
async function rpc(method, params) {
	const headers = { "content-type": "application/json", accept: "application/json, text/event-stream" };
	// GranthAi forwards these to Worklenz, so tool calls run as the logged-in user
	if (session.cookie) headers.cookie = session.cookie;
	if (session.csrfToken) headers["x-csrf-token"] = session.csrfToken;

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
		console.log(`${tool.name.padEnd(56)} ${args}`);
	}
	console.log(`\n${tools.length} tools from ${init.serverInfo.name}`);
} else if (command === "watch") {
	console.log(`Watching ${MCP_URL} (${init.serverInfo.name}). Use the app or run traffic.mjs; Ctrl+C to stop.\n`);
	const seen = new Set();
	for (;;) {
		const { tools } = await rpc("tools/list");
		for (const tool of tools) {
			if (seen.has(tool.name)) continue;
			seen.add(tool.name);
			console.log(`${new Date().toLocaleTimeString()}  +${String(seen.size).padStart(3)}  ${tool.name.padEnd(56)} ${tool.description}`);
		}
		await new Promise((resolve) => setTimeout(resolve, 1000));
	}
} else if (command === "call") {
	const [name, json = "{}"] = rest;
	if (!name) throw new Error("Usage: node scripts/mcp.mjs call <tool> '<json args>'");
	const result = await rpc("tools/call", { name, arguments: JSON.parse(json) });
	for (const item of result.content) console.log(item.text);
	process.exitCode = result.isError ? 1 : 0;
} else {
	throw new Error(`Unknown command "${command}" (expected tools, watch or call)`);
}
