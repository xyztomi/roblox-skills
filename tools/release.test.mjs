import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readJson(file) {
	return JSON.parse(readFileSync(file, "utf8"));
}

const plugins = readdirSync(path.join(ROOT, "plugins"), { withFileTypes: true })
	.filter((entry) => entry.isDirectory())
	.map((entry) => entry.name);

test("each plugin's npm and Claude manifests agree on a version", () => {
	for (const name of plugins) {
		const npm = readJson(path.join(ROOT, "plugins", name, "package.json"));
		const claude = readJson(path.join(ROOT, "plugins", name, ".claude-plugin", "plugin.json"));
		assert.equal(npm.name, name, `${name} package.json name`);
		assert.match(npm.version, /^\d+\.\d+\.\d+$/, `${name} version`);
		assert.equal(npm.version, claude.version, `${name} versions agree`);
	}
});

test("each plugin package exports an OpenCode entrypoint and ships its skills", () => {
	for (const name of plugins) {
		const dir = path.join(ROOT, "plugins", name);
		const npm = readJson(path.join(dir, "package.json"));
		const entry = npm.exports?.["."];
		assert.ok(entry, `${name} exports an entrypoint`);
		assert.ok(existsSync(path.join(dir, entry)), `${name} entrypoint exists`);
		assert.ok(npm.files?.includes("opencode"), `${name} packs opencode/`);
		assert.ok(npm.files?.includes("skills"), `${name} packs skills/`);
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

test("the repository loads both local plugins from opencode.json", () => {
	const config = readJson(path.join(ROOT, "opencode.json"));
	for (const name of ["roblox-dev", "pages"]) {
		assert.ok(config.plugins.includes(`./plugins/${name}`), `${name} is loaded`);
	}
});
