#!/usr/bin/env node
// Release consistency check. Run after tagging, before or after publishing:
//
//   npm run check:release
//
// It verifies that the tag named in SETUP.md exists, points at HEAD, and matches
// the README and every plugin package version.

import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let problems = 0;
const ok = (message) => process.stdout.write(`ok    ${message}\n`);
const fail = (message) => {
	problems += 1;
	process.stdout.write(`fail  ${message}\n`);
};

function git(args) {
	const res = spawnSync("git", args, { cwd: ROOT, encoding: "utf8" });
	return { ok: res.status === 0, output: `${res.stdout ?? ""}${res.stderr ?? ""}`.trim() };
}

const setup = readFileSync(path.join(ROOT, "SETUP.md"), "utf8");
const tag = /^Release tag: `(v\d+\.\d+\.\d+)`$/m.exec(setup)?.[1];
if (!tag) {
	fail("SETUP.md has no release tag line");
	process.exit(1);
}
ok(`release tag ${tag}`);

const readme = readFileSync(path.join(ROOT, "README.md"), "utf8");
const named = [...readme.matchAll(/#(v\d+\.\d+\.\d+)/g)].map((match) => match[1]);
if (named.length === 0) fail("README has no pinned release tag");
for (const other of named) {
	if (other !== tag) fail(`README names ${other}, SETUP names ${tag}`);
}
if (named.length > 0 && named.every((value) => value === tag)) ok("README tags match SETUP");

const head = git(["rev-parse", "HEAD"]);
const tagged = git(["rev-parse", `${tag}^{}`]);
if (!tagged.ok) {
	fail(`tag ${tag} does not exist`);
} else if (tagged.output !== head.output) {
	fail(`tag ${tag} points at ${tagged.output.slice(0, 12)}, HEAD is ${head.output.slice(0, 12)}`);
} else {
	ok(`tag ${tag} points at HEAD`);
}

const template = git(["cat-file", "-e", `${tag}:template/default.project.json`]);
if (!template.ok) fail(`tag ${tag} has no template/default.project.json`);
else ok("tag includes the root-place template");

const packageFile = JSON.parse(readFileSync(path.join(ROOT, "plugins/roblox-dev/package.json"), "utf8"));
if (packageFile.version !== tag.slice(1)) fail(`plugin version ${packageFile.version} does not match ${tag}`);
else ok(`plugin version ${packageFile.version} matches ${tag}`);

process.stdout.write(problems === 0 ? "\nrelease is consistent\n" : `\n${problems} problem(s)\n`);
process.exit(problems === 0 ? 0 : 1);
