#!/usr/bin/env node
// Description trigger tests under an isolated OpenCode config. It runs one private OpenCode session
// per query, counts whether the target skill loaded before an edit, and can
// rewrite a description across train/test splits.
//
//   node evals/harness/trigger-eval.mjs eval --eval-set <queries.json> \
//       --plugin-dir plugins/roblox-dev --skill vide --model <provider/model> \
//       [--sandbox <dir>] [--runs-per-query 3] [--num-workers 5] [--timeout 120] [--out <file>]
//
//   node evals/harness/trigger-eval.mjs loop --eval-set <queries.json> \
//       --plugin-dir plugins/roblox-dev --skill vide --model <provider/model> \
//       [--sandbox <dir>] [--max-iterations 5] [--holdout 0.4] [--seed 42] [--out <file>]
//
// The eval set is [{"query": "...", "should_trigger": true}, ...].

import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { intFlag, parseArgs } from "./lib/args.mjs";
import { DEFAULT_MODEL, generateText, pluginSkills, runOpencode, writeTrialConfig } from "./lib/opencode.mjs";
import { runPool } from "./lib/pool.mjs";
import { parseEvents, toolUses } from "./lib/stream.mjs";

const EDIT_TOOLS = new Set(["edit", "write", "patch"]);
const MAX_TOOL_CALLS = 8;
const SKILL_FILE = /skills[\\/]+([^\\/]+)[\\/]+SKILL\.md$/i;

export function replaceDescription(skillMd, description) {
	const lines = skillMd.split("\n");
	if (!lines[0] || lines[0].trim() !== "---") throw new Error("SKILL.md has no frontmatter");
	const end = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
	if (end < 0) throw new Error("SKILL.md frontmatter is not closed");
	const out = [lines[0]];
	let replaced = false;
	let index = 1;
	while (index < end) {
		const line = lines[index];
		if (line.startsWith("description:")) {
			index += 1;
			while (index < end && (/^\s/.test(lines[index]) || lines[index].trim() === "")) index += 1;
			out.push("description: |");
			out.push(...description.split("\n").map((part) => `  ${part}`));
			replaced = true;
			continue;
		}
		out.push(line);
		index += 1;
	}
	if (!replaced) throw new Error("SKILL.md frontmatter has no description");
	return [...out, ...lines.slice(end)].join("\n");
}

export function triggeredBeforeEdit(events, skill) {
	let calls = 0;
	for (const use of toolUses(events)) {
		calls += 1;
		if (use.name === "skill" && use.status === "completed" && use.input.id === skill) return true;
		if (use.name === "read" && SKILL_FILE.exec(String(use.input.path ?? ""))?.[1] === skill) return true;
		if (EDIT_TOOLS.has(use.name) || calls >= MAX_TOOL_CALLS) return false;
	}
	return false;
}

async function runQuery({ query, skill, description, pluginDir, sandbox, model, timeoutMs, workRoot }) {
	const work = mkdtempSync(path.join(workRoot, "trigger-"));
	try {
		const pluginCopy = path.join(work, "plugin", path.basename(pluginDir));
		cpSync(pluginDir, pluginCopy, { recursive: true });
		const skillMd = path.join(pluginCopy, "skills", skill, "SKILL.md");
		const original = readFileSync(skillMd, "utf8");
		if (description) writeFileSync(skillMd, replaceDescription(original, description));
		const project = path.join(work, "project");
		if (sandbox) cpSync(sandbox, project, { recursive: true });
		else {
			mkdirSync(project, { recursive: true });
			writeFileSync(path.join(project, "README.md"), "# Trigger test\n");
		}
		const configDir = path.join(work, "config");
		writeTrialConfig(configDir, { pluginDir: pluginCopy });
		const outcome = await runOpencode({
			prompt: query,
			cwd: project,
			configDir,
			model,
			transcriptPath: path.join(work, "transcript.jsonl"),
			stderrPath: path.join(work, "stderr.log"),
			timeoutMs,
		});
		const events = parseEvents(readFileSync(path.join(work, "transcript.jsonl"), "utf8"));
		return {
			triggered: !outcome.timedOut && !outcome.spawnError && triggeredBeforeEdit(events, skill),
			error: outcome.spawnError ?? (outcome.timedOut ? "timeout" : null),
		};
	} finally {
		rmSync(work, { recursive: true, force: true });
	}
}

async function evaluate(queries, opts) {
	const jobs = [];
	const owners = [];
	for (const item of queries) {
		for (let run = 0; run < opts.runsPerQuery; run++) {
			owners.push(item);
			jobs.push(() => runQuery({ ...item, ...opts }));
		}
	}
	const results = await runPool(jobs, opts.workers);
	const byQuery = new Map();
	results.forEach((result, index) => {
		const item = owners[index];
		const entry = byQuery.get(item.query) ?? { query: item.query, should_trigger: item.should_trigger, triggers: 0, runs: 0, errors: [] };
		entry.runs += 1;
		if (result.error) entry.errors.push(result.error);
		else if (result.triggered) entry.triggers += 1;
		byQuery.set(item.query, entry);
	});
	const rows = [...byQuery.values()].map((entry) => {
		const rate = entry.runs === 0 ? 0 : entry.triggers / entry.runs;
		const pass = entry.should_trigger ? rate >= opts.threshold : rate <= 1 - opts.threshold;
		return { ...entry, trigger_rate: Math.round(rate * 10000) / 10000, pass };
	});
	const summary = { total: rows.length, passed: rows.filter((r) => r.pass).length, failed: rows.filter((r) => !r.pass).length };
	return { results: rows, summary };
}

function mulberry32(seed) {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

export function splitQueries(queries, holdout, seed = 42) {
	const random = mulberry32(seed);
	const shuffled = [...queries];
	for (let i = shuffled.length - 1; i > 0; i--) {
		const j = Math.floor(random() * (i + 1));
		[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
	}
	const testCount = Math.max(1, Math.min(shuffled.length - 1, Math.round(shuffled.length * holdout))) || 0;
	return { train: shuffled.slice(testCount), test: shuffled.slice(0, testCount) };
}

export function rewritePrompt({ skill, description, results }) {
	const misses = results
		.filter((r) => !r.pass)
		.map((r) => `- ${r.should_trigger ? "should trigger" : "should not trigger"} (rate ${r.trigger_rate}): ${r.query}`)
		.join("\n");
	return [
		`Rewrite the description for the skill "${skill}". It is the text a model sees when deciding`,
		"whether to load the skill, so it must make the trigger cases clear without advertising unrelated work.",
		"",
		"Current description:",
		description,
		"",
		"These queries did not trigger as intended:",
		misses || "(none)",
		"",
		"Reply with only the new description, with no surrounding quotes or code fence. Keep the same",
		"facts and level of detail; change the wording and examples that affect triggering.",
	].join("\n");
}

function cleanDescription(text) {
	return String(text ?? "")
		.trim()
		.replace(/^```(?:text)?\s*/i, "")
		.replace(/\s*```$/, "")
		.replace(/^["']|["']$/g, "")
		.trim();
}

async function loop(queries, opts) {
	const { train, test } = splitQueries(queries, opts.holdout, opts.seed);
	let description = opts.description;
	let best = null;
	const iterations = [];
	for (let iteration = 1; iteration <= opts.maxIterations; iteration++) {
		const trainResult = await evaluate(train, { ...opts, description });
		const testResult = await evaluate(test, { ...opts, description });
		const record = { iteration, description, train: trainResult.summary, test: testResult.summary };
		iterations.push(record);
		process.stdout.write(`iteration ${iteration}: train ${trainResult.summary.passed}/${trainResult.summary.total}, test ${testResult.summary.passed}/${testResult.summary.total}\n`);
		if (best === null || testResult.summary.passed > best.test.passed || (testResult.summary.passed === best.test.passed && trainResult.summary.passed > best.train.passed)) {
			best = { description, train: trainResult.summary, test: testResult.summary };
		}
		if (trainResult.summary.failed === 0) break;
		const next = cleanDescription(
			generateText({ prompt: rewritePrompt({ skill: opts.skill, description, results: trainResult.results }), model: opts.model, timeoutMs: opts.timeoutMs }),
		);
		if (!next || next === description) break;
		description = next;
	}
	return { skill_name: opts.skill, initial_description: opts.description, best_description: best.description, best, iterations };
}

async function main() {
	const { flags, positional } = parseArgs(process.argv.slice(2), { booleans: [] });
	const mode = positional[0];
	if (!["eval", "loop"].includes(mode) || !flags["eval-set"] || !flags["plugin-dir"] || !flags.skill) {
		console.error("usage: node evals/harness/trigger-eval.mjs eval|loop --eval-set <file> --plugin-dir <dir> --skill <name> --model <provider/model>");
		process.exit(2);
	}
	const model = flags.model ?? DEFAULT_MODEL;
	if (!model) throw new Error("--model is required (or set EVAL_MODEL)");
	const pluginDir = path.resolve(flags["plugin-dir"]);
	const modelOptions = {
		pluginDir,
		sandbox: flags.sandbox ? path.resolve(flags.sandbox) : null,
		model,
		timeoutMs: Number(flags.timeout ?? 120) * 1000,
		workRoot: os.tmpdir(),
		skill: flags.skill,
		runsPerQuery: intFlag(flags["runs-per-query"], "runs-per-query", { max: 20, fallback: 3 }),
		threshold: flags["trigger-threshold"] ? Number(flags["trigger-threshold"]) : 0.5,
		workers: intFlag(flags["num-workers"], "num-workers", { max: 20, fallback: 5 }),
	};
	const evalSet = JSON.parse(readFileSync(flags["eval-set"], "utf8"));
	if (!Array.isArray(evalSet) || !evalSet.every((e) => typeof e?.query === "string" && typeof e?.should_trigger === "boolean")) {
		throw new Error("eval set must be a list of {query: string, should_trigger: boolean}");
	}
	const skills = pluginSkills(pluginDir);
	if (!skills.includes(flags.skill)) throw new Error(`${flags.skill} is not a skill in ${pluginDir}`);
	const skillMd = readFileSync(path.join(pluginDir, "skills", flags.skill, "SKILL.md"), "utf8");
	const description = flags.description ?? /^description:\s*(.+)$/m.exec(skillMd)?.[1] ?? "";
	let output;
	if (mode === "eval") {
		const result = await evaluate(evalSet, { ...modelOptions, description });
		output = {
			skill_name: flags.skill,
			description,
			results: result.results,
			summary: result.summary,
		};
	} else {
		output = await loop(evalSet, {
			...modelOptions,
			description,
			maxIterations: intFlag(flags["max-iterations"], "max-iterations", { max: 20, fallback: 5 }),
			holdout: flags.holdout ? Number(flags.holdout) : 0.4,
			seed: flags.seed ? Number(flags.seed) : 42,
		});
	}
	const text = `${JSON.stringify(output, null, 2)}\n`;
	if (flags.out) writeFileSync(flags.out, text);
	process.stdout.write(text);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	main().catch((err) => {
		console.error(`trigger-eval: ${err.message}`);
		process.exit(1);
	});
}
