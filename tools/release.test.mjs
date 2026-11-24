import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readJson(file) {
	return JSON.parse(readFileSync(file, "utf8"));
}

const plugin = "roblox-dev";

test("the plugin package has a valid name and version", () => {
	const npm = readJson(path.join(ROOT, "plugins", plugin, "package.json"));
	assert.equal(npm.name, plugin);
	assert.match(npm.version, /^\d+\.\d+\.\d+$/);
});

test("the plugin package exports an OpenCode entrypoint and ships its skills and rules", () => {
	const dir = path.join(ROOT, "plugins", plugin);
	const npm = readJson(path.join(dir, "package.json"));
	const entry = npm.exports?.["."];
	assert.ok(entry, "exports an entrypoint");
	assert.ok(existsSync(path.join(dir, entry)), "entrypoint exists");
	for (const folder of ["opencode", "skills", "lib", "agents"]) {
		assert.ok(npm.files?.includes(folder), `packs ${folder}/`);
	}
});

test("SETUP.md names one release tag and README does not name another", () => {
	const setup = readFileSync(path.join(ROOT, "SETUP.md"), "utf8");
	const line = /^Release tag: `(v\d+\.\d+\.\d+)`$/m.exec(setup);
	assert.ok(line, "SETUP.md has the release tag line");
	const tag = line[1];
	const readme = readFileSync(path.join(ROOT, "README.md"), "utf8");
	const named = [...readme.matchAll(/#(v\d+\.\d+\.\d+)/g)].map((m) => m[1]);
	for (const other of named) assert.equal(other, tag, "README tag matches SETUP.md");
});

test("the repository loads only the roblox-dev plugin", () => {
	const config = readJson(path.join(ROOT, "opencode.json"));
	assert.deepEqual(config.plugins, ["./plugins/roblox-dev"]);
});

test("the template is a single root-place project", () => {
	assert.ok(existsSync(path.join(ROOT, "template", "default.project.json")));
	assert.ok(existsSync(path.join(ROOT, "template", "src")));
	assert.ok(!existsSync(path.join(ROOT, "template", "places.json")));
});
