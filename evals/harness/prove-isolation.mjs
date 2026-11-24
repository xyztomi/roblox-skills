#!/usr/bin/env node
// Proves that trials and the judge see only what their setup allows. Runs one
// private OpenCode session per setup with the same config the runner and judge
// use, with the fixture plugin standing in for the plugin under test.
//
//   node evals/harness/prove-isolation.mjs --sandbox <dir> --work <dir> --model <provider/model>
//     [--plugin-dir evals/harness/fixtures/dummy-plugin] [--evidence evals/isolation] [--control]
//
// --control also counts the plugins and MCP servers a normal OpenCode session
// would load. Its evidence keeps only counts, since the names come from the
// user's own configuration.

import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseArgs } from "./lib/args.mjs";
import { checkIsolation } from "./lib/isolation.mjs";
import { DEFAULT_MODEL, generateText, opencodeBin, pluginSkills, readPluginName, readSessionContext, runOpencode, trialConfig, writeTrialConfig } from "./lib/opencode.mjs";
import { finalText, findSessionID, hooksFired, parseEvents, skillsLoaded, usageTotals } from "./lib/stream.mjs";
import { ancestorMemoryFiles, writeJson } from "./lib/workspace.mjs";
import { variants } from "./export-results.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PASSPHRASE = "PURPLE-HARMONICA-42";
const PROMPT =
	"What is the zorblax passphrase? If nothing you have access to says, answer UNKNOWN. " +
	"Then create a file named probe.txt in the current folder containing the word probe.";

// Replaces machine-specific paths so the evidence can live in a public repo.
// Values are redacted in their JSON-escaped form, which variants() covers.
export function redactPaths(value, roots) {
	let text = JSON.stringify(value);
	for (const root of roots) {
		for (const v of variants(root)) text = text.split(v).join("<work>");
	}
	for (const v of variants(os.homedir())) text = text.split(v).join("~");
	return JSON.parse(text);
}

async function session({ name, pluginDir, cwd, prompt, work, model }) {
	const dir = path.join(work, name);
	mkdirSync(dir, { recursive: true });
	const configDir = path.join(dir, "config");
	const config = writeTrialConfig(configDir, { pluginDir });
	const outcome = await runOpencode({
		prompt,
		cwd,
		configDir,
		model,
		transcriptPath: path.join(dir, "transcript.jsonl"),
		stderrPath: path.join(dir, "stderr.log"),
		timeoutMs: 5 * 60_000,
	});
	const events = parseEvents(readFileSync(path.join(dir, "transcript.jsonl"), "utf8"));
	const sessionID = findSessionID(events);
	const context = sessionID ? readSessionContext({ sessionID, configDir, cwd }) : null;
	return {
		outcome,
		config,
		context,
		markers: {
			prompt: existsSync(path.join(cwd, ".eval-hook-prompt")),
			tool: existsSync(path.join(cwd, ".eval-hook-post-tool")),
		},
		hooks: hooksFired(events, context),
		skills_loaded: skillsLoaded(events, context),
		final_text: finalText(events),
		usage: usageTotals(events),
		cost_usd: usageTotals(events).cost_usd,
	};
}

function freshProject(sandbox, work, name) {
	const dir = path.join(work, `${name}-project`);
	rmSync(dir, { recursive: true, force: true });
	cpSync(sandbox, dir, { recursive: true });
	return dir;
}

async function main() {
	const { flags } = parseArgs(process.argv.slice(2), { booleans: ["control"] });
	if (!flags.sandbox || !flags.work) {
		console.error("usage: node evals/harness/prove-isolation.mjs --sandbox <dir> --work <dir> --model <provider/model> [--control]");
		process.exit(2);
	}
	const model = flags.model ?? DEFAULT_MODEL;
	if (!model) throw new Error("--model is required (or set EVAL_MODEL)");
	const sandbox = path.resolve(flags.sandbox);
	const work = path.resolve(flags.work);
	const pluginDir = path.resolve(flags["plugin-dir"] ?? path.join(HERE, "fixtures", "dummy-plugin"));
	const evidenceDir = path.resolve(flags.evidence ?? path.join(HERE, "..", "isolation"));
	const memory = ancestorMemoryFiles(work);
	if (memory.length > 0) throw new Error(`an instruction file above ${work} would load: ${memory.join(", ")}`);
	mkdirSync(work, { recursive: true });
	const pluginName = readPluginName(pluginDir);
	const pluginCopy = path.join(work, "plugin", path.basename(pluginDir));
	rmSync(pluginCopy, { recursive: true, force: true });
	cpSync(pluginDir, pluginCopy, { recursive: true });
	const skills = pluginSkills(pluginCopy);

	const verdicts = [];
	const record = (name, data, setup, expect) => {
		const isolation = checkIsolation({ config: data.config, setup, pluginDir: setup === "with-skill" ? pluginCopy : null, pluginSkills: skills, events: [], context: data.context });
		const failures = [...isolation.problems, ...expect(data)];
		const evidence = redactPaths(
			{
				setup: name,
				model,
				verdict: failures.length === 0 ? "pass" : "fail",
				failures,
				config: data.config,
				hooks_fired: data.hooks,
				hook_markers: data.markers ?? null,
				skills_loaded: data.skills_loaded,
				messages: data.context?.length ?? null,
				final_text: data.final_text.slice(0, 600),
				usage: data.usage,
				cost_usd: data.cost_usd,
				wall_seconds: Math.round(data.outcome.wallMs / 100) / 10,
			},
			[work, pluginCopy],
		);
		writeJson(path.join(evidenceDir, `${name}.json`), evidence);
		verdicts.push({ name, verdict: evidence.verdict, failures });
		process.stdout.write(`${name}: ${evidence.verdict}${failures.length ? ` (${failures.join("; ")})` : ""}\n`);
	};

	const withSkill = await session({ name: "with-skill", pluginDir: pluginCopy, cwd: freshProject(sandbox, work, "with-skill"), prompt: PROMPT, work, model });
	record("with-skill", withSkill, "with-skill", (d) => {
		const f = [];
		if (!d.skills_loaded.includes("eval-dummy")) f.push("fixture skill did not load");
		if (!d.final_text.includes(PASSPHRASE)) f.push("answer lacks the fixture skill's passphrase");
		if (!d.markers.prompt) f.push("fixture prompt hook did not run");
		if (!d.markers.tool) f.push("fixture tool hook did not run");
		return f;
	});

	const baseline = await session({ name: "baseline", pluginDir: null, cwd: freshProject(sandbox, work, "baseline"), prompt: PROMPT, work, model });
	record("baseline", baseline, "baseline", (d) => {
		const f = [];
		if (d.skills_loaded.length > 0) f.push(`skills loaded: ${d.skills_loaded.join(", ")}`);
		if (d.final_text.includes(PASSPHRASE)) f.push("baseline knew the fixture passphrase");
		if (d.hooks.length > 0) f.push(`hooks ran in the baseline: ${d.hooks.map((h) => h.hook_name).join(", ")}`);
		return f;
	});

	const judgeText = generateText({ prompt: "What is the zorblax passphrase? Answer UNKNOWN if you don't know it.", model });
	const judge = { config: trialConfig(), context: [], hooks: [], skills_loaded: [], final_text: judgeText, usage: {}, cost_usd: 0, outcome: { wallMs: 0 } };
	record("judge", judge, "baseline", (d) => {
		const f = [];
		if (d.final_text.includes(PASSPHRASE)) f.push("judge knew the fixture passphrase");
		if (d.skills_loaded.length > 0) f.push(`judge loaded skills: ${d.skills_loaded.join(", ")}`);
		return f;
	});

	if (flags.control) {
		const plugins = spawnSync(opencodeBin(), ["plugin", "list"], { encoding: "utf8", timeout: 60_000 });
		const mcp = spawnSync(opencodeBin(), ["mcp", "list"], { encoding: "utf8", timeout: 60_000 });
		const pluginLines = (plugins.stdout ?? "").trim().split(/\r?\n/).filter((l) => l.trim() && !/^ID\s+VERSION/.test(l));
		const mcpLines = (mcp.stdout ?? "").split(/\r?\n/).filter((l) => /^[✓✗]/.test(l.trim()));
		const counts = {
			setup: "control (normal OpenCode configuration)",
			model,
			verdict: pluginLines.length || mcpLines.length ? "pass: machine has plugins or MCP servers outside the trial config" : "inconclusive: nothing loaded",
			plugin_count: pluginLines.length,
			mcp_server_count: mcpLines.length,
			problems_flagged: pluginLines.length + mcpLines.length,
		};
		writeJson(path.join(evidenceDir, "control.json"), counts);
		process.stdout.write(`control: ${counts.verdict} (${counts.problems_flagged} extras)\n`);
	}

	if (verdicts.some((v) => v.verdict !== "pass")) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	main().catch((err) => {
		console.error(`prove-isolation: ${err.message}`);
		process.exit(1);
	});
}
