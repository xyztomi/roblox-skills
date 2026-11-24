#!/usr/bin/env node
// Non-installing environment check. Run from the repo root.
//
//   node tools/doctor.mjs

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TEMPLATE = path.join(ROOT, "template");
const PESDE = existsSync(path.join(homedir(), ".pesde", "bin", "pesde")) ? path.join(homedir(), ".pesde", "bin", "pesde") : "pesde";
let problems = 0;

function run(command, args, cwd = ROOT) {
	const res = spawnSync(command, args, { cwd, encoding: "utf8", timeout: 20_000, maxBuffer: 4 * 1024 * 1024 });
	return { ok: res.status === 0 && !res.error, output: `${res.stdout ?? ""}${res.stderr ?? ""}`.trim(), error: res.error?.message };
}

function check(label, fn) {
	try {
		const result = fn();
		if (result === true) {
			process.stdout.write(`ok    ${label}\n`);
		} else {
			problems += 1;
			process.stdout.write(`fail  ${label}${result ? `: ${result}` : ""}\n`);
		}
	} catch (err) {
		problems += 1;
		process.stdout.write(`fail  ${label}: ${err.message}\n`);
	}
}

check("Node 22 or later", () => {
	const major = Number(process.versions.node.split(".")[0]);
	return major >= 22 || `found v${process.versions.node}`;
});

check("OpenCode 2.x", () => {
	const res = run("opencode", ["--version"]);
	if (!res.ok) return res.error ?? "opencode is not on PATH";
	return /\bv2\.\d/.test(res.output) || res.output;
});

check("local plugin is configured", () => {
	const config = JSON.parse(readFileSync(path.join(ROOT, "opencode.json"), "utf8"));
	return config.plugins?.includes("./plugins/roblox-dev") || "opencode.json does not load ./plugins/roblox-dev";
});

check("OpenCode sees roblox-dev", () => {
	const res = run("opencode", ["plugin", "list"]);
	if (!res.ok) return res.error ?? res.output.slice(0, 200);
	return res.output.includes("roblox-dev") || "roblox-dev is not in opencode plugin list";
});

check("Rokit", () => {
	const res = run("rokit", ["--version"], TEMPLATE);
	return res.ok ? true : res.error ?? res.output.slice(0, 200);
});

check("pesde", () => {
	const res = run(PESDE, ["--version"], TEMPLATE);
	return res.ok ? true : res.error ?? res.output.slice(0, 200);
});

for (const tool of ["rojo", "lune", "luau-lsp", "selene", "stylua"]) {
	check(tool, () => {
		const res = run(tool, ["--version"], TEMPLATE);
		return res.ok ? true : res.error ?? res.output.slice(0, 200);
	});
}

check("template project file", () => (existsSync(path.join(TEMPLATE, "default.project.json")) ? true : "missing template/default.project.json"));
check("template OpenCode config", () => (existsSync(path.join(TEMPLATE, ".opencode/opencode.json")) ? true : "missing template/.opencode/opencode.json"));
check("template instructions", () => (existsSync(path.join(TEMPLATE, "AGENTS.md")) ? true : "missing template/AGENTS.md"));
check("Roblox type definitions", () => (existsSync(path.join(TEMPLATE, "globalTypes.None.d.luau")) ? true : "run rojo/luau-lsp setup or download globalTypes.None.d.luau into template/"));

process.stdout.write(problems === 0 ? "\nenvironment is ready\n" : `\n${problems} check(s) failed\n`);
process.exit(problems === 0 ? 0 : 1);
