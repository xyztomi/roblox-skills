#!/usr/bin/env node
// Checks a plugin as it ships: npm pack, extract the tarball, load the extracted
// package in a private OpenCode config, and run one live session that loads its
// skill. With roblox-dev it also tries a Luau edit and reports whether the skill
// gate denied it. This is the packaged-artifact test, not a test of the checkout.
//
//   node tools/test-plugin-package.mjs --model <provider/model> [--plugin roblox-dev] [--skill <id>]

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { parseArgs } from "../evals/harness/lib/args.mjs";
import { runOpencode, writeTrialConfig } from "../evals/harness/lib/opencode.mjs";
import { finalText, findError, hooksFired, parseEvents, skillsLoaded } from "../evals/harness/lib/stream.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULTS = { "roblox-dev": "luau-style-guide", pages: "html-kit" };

function pack(pluginDir, dest) {
	const res = spawnSync("npm", ["pack", "--pack-destination", dest], { cwd: pluginDir, encoding: "utf8" });
	if (res.status !== 0) throw new Error(`npm pack failed: ${res.stderr || res.stdout}`);
	const name = res.stdout.trim().split("\n").at(-1);
	if (!name) throw new Error("npm pack printed no tarball name");
	return path.join(dest, name);
}

function extract(tarball, dest) {
	mkdirSync(dest, { recursive: true });
	const res = spawnSync("tar", ["-xzf", tarball, "-C", dest], { encoding: "utf8" });
	if (res.status !== 0) throw new Error(`tar failed: ${res.stderr}`);
	return path.join(dest, "package");
}

async function main() {
	const { flags } = parseArgs(process.argv.slice(2));
	const model = flags.model ?? process.env.EVAL_MODEL;
	if (!model) throw new Error("--model is required (or set EVAL_MODEL)");
	const plugin = flags.plugin ?? "roblox-dev";
	const skill = flags.skill ?? DEFAULTS[plugin];
	if (!skill) throw new Error(`unknown plugin ${plugin}; pass --skill`);
	const pluginDir = path.join(ROOT, "plugins", plugin);
	const work = mkdtempSync(path.join(os.tmpdir(), "plugin-package-"));
	try {
		const tarball = pack(pluginDir, work);
		const packageDir = extract(tarball, path.join(work, "extract"));
		const project = path.join(work, "project");
		mkdirSync(path.join(project, "src", "ServerScriptService"), { recursive: true });
		writeFileSync(path.join(project, "default.project.json"), JSON.stringify({ tree: { ServerScriptService: { $path: "src/ServerScriptService" } } }));
		const configDir = path.join(work, "config");
		writeTrialConfig(configDir, { pluginDir: packageDir });

		const skillRun = path.join(work, "skill");
		mkdirSync(skillRun, { recursive: true });
		const skillOutcome = await runOpencode({
			prompt: `Load the \`${skill}\` skill with the skill tool, then reply with the first heading line of the skill.`,
			cwd: project,
			configDir,
			model,
			transcriptPath: path.join(skillRun, "transcript.jsonl"),
			stderrPath: path.join(skillRun, "stderr.log"),
			timeoutMs: 180_000,
		});
		const skillEvents = parseEvents(readFileSync(path.join(skillRun, "transcript.jsonl"), "utf8"));
		const loaded = skillsLoaded(skillEvents);
		const text = finalText(skillEvents);
		const errors = findError(skillEvents);

		let gate = "not run";
		if (plugin === "roblox-dev") {
			const editRun = path.join(work, "edit");
			mkdirSync(editRun, { recursive: true });
			rmSync(path.join(project, "src", "ServerScriptService", "PackageCheck.server.luau"), { force: true });
			await runOpencode({
				prompt: "Do not load any skills. Create src/ServerScriptService/PackageCheck.server.luau containing exactly: local x = 1",
				cwd: project,
				configDir,
				model,
				transcriptPath: path.join(editRun, "transcript.jsonl"),
				stderrPath: path.join(editRun, "stderr.log"),
				timeoutMs: 180_000,
			});
			const editEvents = parseEvents(readFileSync(path.join(editRun, "transcript.jsonl"), "utf8"));
			gate = hooksFired(editEvents).some((h) => h.hook_name === "skill-gate") ? "denied once" : "no denial (model may have loaded a skill first)";
		}

		const ok = !errors && loaded.includes(skill) && text.trim() !== "";
		process.stdout.write(`package: ${path.basename(tarball)}\n`);
		process.stdout.write(`skill:   ${loaded.includes(skill) ? "loaded" : "missing"} (${loaded.join(", ") || "none"})\n`);
		process.stdout.write(`gate:    ${gate}\n`);
		if (errors) process.stdout.write(`error:   ${errors.message ?? errors.type}\n`);
		if (!ok) process.exitCode = 1;
	} finally {
		rmSync(work, { recursive: true, force: true });
	}
}

main().catch((err) => {
	console.error(`test-plugin-package: ${err.message}`);
	process.exit(1);
});
