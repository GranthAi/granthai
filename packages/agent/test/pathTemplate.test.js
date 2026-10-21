const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createPathTemplater } = require("../src/pathTemplate");

const templateOf = (routes, path) => createPathTemplater(routes)(path).template;

test("detects identifiers without routes", () => {
	assert.equal(templateOf([], "/petclinic/api/owners/3/pets/7"), "/petclinic/api/owners/{ownerId}/pets/{petId}");
	assert.equal(templateOf([], "/categories/65a1f0c2e4b0a1b2c3d4e5f6"), "/categories/{categoryId}");
	assert.equal(templateOf([], "/v1/users/me"), "/v1/users/me");
});

test("full routes match the whole path", () => {
	assert.equal(templateOf(["/users/{username}"], "/users/ada"), "/users/{username}");
	assert.equal(templateOf(["/users/{username}"], "/users/ada/repos"), "/users/ada/repos");
	assert.equal(templateOf(["/files/{path*}"], "/files/a/b.txt"), "/files/{path}");
});

test("prefix routes template the rest heuristically", () => {
	const routes = ["/api/v1/repos/{owner}/{repo}/**"];
	assert.equal(templateOf(routes, "/api/v1/repos/ada/demo"), "/api/v1/repos/{owner}/{repo}");
	assert.equal(templateOf(routes, "/api/v1/repos/ada/demo/issues/3/comments"), "/api/v1/repos/{owner}/{repo}/issues/{issueId}/comments");
	assert.equal(templateOf(routes, "/api/v1/repos/ada"), "/api/v1/repos/ada");

	const { params } = createPathTemplater(routes)("/api/v1/repos/ada/demo/issues/3");
	assert.deepEqual(
		params.map((p) => [p.name, p.value, p.schema.type]),
		[
			["owner", "ada", "string"],
			["repo", "demo", "string"],
			["issueId", "3", "integer"]
		]
	);
});
