// Drives a realistic Worklenz workflow through its REST API (sign up, create a project,
// file tasks, comment, browse boards) so GranthAi has traffic to learn endpoints from.
// Saves the session cookie + CSRF token to .session.json for the MCP steps.
//
//   node scripts/traffic.mjs
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const API = process.env.WORKLENZ_URL || "http://localhost:3000";
const EMAIL = process.env.WORKLENZ_EMAIL || "ada@example.com";
const PASSWORD = process.env.WORKLENZ_PASSWORD || "Granth@i-Demo-2026";

let cookie = "";
let csrfToken = "";

async function call(method, path, body) {
	const headers = { accept: "application/json" };
	if (cookie) headers.cookie = cookie;
	if (csrfToken) headers["x-csrf-token"] = csrfToken;
	if (body !== undefined) headers["content-type"] = "application/json";

	const res = await fetch(API + path, {
		method,
		headers,
		body: body === undefined ? undefined : JSON.stringify(body),
		redirect: "manual"
	});
	const setCookie = res.headers.getSetCookie().find((c) => c.startsWith("worklenz.sid="));
	if (setCookie) cookie = setCookie.split(";")[0];

	const text = await res.text();
	let json;
	try {
		json = JSON.parse(text);
	} catch {
		json = undefined;
	}
	console.log(`${method.padEnd(6)} ${path.padEnd(48)} ${res.status}${json && json.done === false ? `  (${json.message})` : ""}`);
	return json;
}

// Auth: signup is a no-op redirect if the account already exists, then log in
await call("POST", "/secure/signup", { name: "Ada Lovelace", email: EMAIL, password: PASSWORD, team_name: "Analytical Engines", timezone: "UTC" });
await call("POST", "/secure/login", { email: EMAIL, password: PASSWORD });
csrfToken = (await call("GET", "/csrf-token")).token;
if (!cookie) throw new Error("Login failed: no session cookie returned");

// Workspace look-around, the same calls the web app makes on load
await call("GET", "/api/v1/teams");
await call("GET", "/api/v1/team-members?index=1&size=10");
const statuses = await call("GET", "/api/v1/project-statuses");
await call("GET", "/api/v1/project-healths");
await call("GET", "/api/v1/project-categories");
await call("GET", "/api/v1/task-priorities");
await call("GET", "/api/v1/job-titles?index=1&size=10");
await call("GET", "/api/v1/notifications/unread-count");

// A project with a few tasks, like filing a sprint's worth of tickets
const project = await call("POST", "/api/v1/projects", { name: `Engine v2 #${Date.now().toString(36)}`, color_code: "#154c9b", status_id: statuses.body[0].id, notes: "Created by the GranthAi example" });
const projectId = project.body.id;
await call("GET", `/api/v1/projects/${projectId}`);
const boardStatuses = await call("GET", `/api/v1/statuses?project=${projectId}`);
await call("GET", `/api/v1/task-phases?id=${projectId}`);

const tasks = [];
for (const name of ["Design the mill", "Punch-card reader", "Bernoulli number program"]) {
	const task = await call("POST", "/api/v1/tasks", { name, project_id: projectId, status_id: boardStatuses.body[0].id, description: `<p>${name}</p>`, total_hours: 4 });
	tasks.push(task.body.task);
}

await call("POST", "/api/v1/task-comments", { task_id: tasks[0].id, content: "First draft of the mill is ready for review", mentions: [], attachments: [] });
await call("GET", `/api/v1/task-comments/${tasks[0].id}`);
await call("GET", `/api/v1/tasks/info?task_id=${tasks[0].id}&team_id=${tasks[0].team_id ?? ""}`);
await call("GET", `/api/v1/sub-tasks/${tasks[0].id}`);
await call("POST", "/api/v1/labels", { name: `backend-${Date.now().toString(36)}`, color: "#154c9b" });
await call("GET", "/api/v1/labels");

// Boards and lists
await call("GET", `/api/v1/tasks/kanban/${projectId}`);
await call("GET", `/api/v1/tasks/list/columns/${projectId}`);
await call("GET", `/api/v1/tasks/list/v2/${projectId}?group=status`);
await call("GET", "/api/v1/projects?index=1&size=10&field=name&order=ascend");
await call("GET", "/api/v1/home/tasks?group_by=0&current_tab=All&is_calendar_view=false");

const sessionFile = fileURLToPath(new URL("../.session.json", import.meta.url));
writeFileSync(sessionFile, JSON.stringify({ cookie, csrfToken, projectId, taskId: tasks[0].id }, null, 2));
console.log(`\nSession saved to .session.json (project ${projectId})`);
