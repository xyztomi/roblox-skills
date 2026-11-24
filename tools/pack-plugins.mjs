#!/usr/bin/env node
// Packs each plugin into dist/ with npm, the same artifact a package install uses.
// Use the tarballs to inspect what ships, or extract one for a local package test.

import { mkdirSync, readdirSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const plugins = path.join(root, "plugins");
const dist = path.join(root, "dist");
mkdirSync(dist, { recursive: true });

let failed = false;
for (const name of readdirSync(plugins, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)) {
	const dir = path.join(plugins, name);
	const res = spawnSync("npm", ["pack", "--pack-destination", dist], { cwd: dir, encoding: "utf8" });
	if (res.status !== 0) {
		failed = true;
		process.stderr.write(`${name}: ${res.stderr || res.stdout}\n`);
	} else {
		process.stdout.write(`${name}: ${res.stdout.trim().split("\n").at(-1)}\n`);
	}
}
process.exit(failed ? 1 : 0);
