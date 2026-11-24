import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import { buildBenchmark, harnessSummary, stats } from "../aggregate.mjs";
import { buildGrading, runTaskChecks, trimEvidence } from "../lib/checks.mjs";
import { checkIsolation } from "../lib/isolation.mjs";
import { childEnv, parseModel, trialConfig } from "../lib/opencode.mjs";
import {
	finalText,
	findSessionID,
	hooksFired,
	parseEvents,
	skillFileReads,
	skillsLoaded,
	summarizeResult,
	toolCallCounts,
	usageTotals,
} from "../lib/stream.mjs";
import { loadTask, validateTask } from "../lib/task.mjs";
import { ancestorMemoryFiles, resolveInside } from "../lib/workspace.mjs";
import { keepFile, redact } from "../export-results.mjs";
import { assignLabels, buildJudgePrompt, fillTemplate, judgeInstruction, parseJudgeVerdict, renderFacts, scrub, summarizeJudgements } from "../judge.mjs";
import { redactPaths } from "../prove-isolation.mjs";
import { trialStatus } from "../run-trials.mjs";
import { replaceDescription, splitQueries, triggeredBeforeEdit } from "../trigger-eval.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const tmp = mkdtempSync(path.join(os.tmpdir(), "harness-test-"));
after(() => rmSync(tmp, { recursive: true, force: true }));

describe("stream parsing", () => {
	const lines = [
		JSON.stringify({ type: "step_start", sessionID: "ses_1", part: { type: "step-start" } }),
		"not json",
		JSON.stringify({ type: "tool_use", sessionID: "ses_1", part: { tool: "skill", state: { status: "completed", input: { id: "vide" } } } }),
		JSON.stringify({ type: "tool_use", sessionID: "ses_1", part: { tool: "read", state: { status: "completed", input: { path: "/p/skills/vide/SKILL.md" } } } }),
		JSON.stringify({ type: "tool_use", sessionID: "ses_1", part: { tool: "write", state: { status: "error", error: "Load `code-comments` with the skill tool, then retry this edit unchanged." } } }),
		JSON.stringify({ type: "tool_use", sessionID: "ses_1", part: { tool: "edit", state: { status: "completed", output: "ok\nLuau convention check on the lines this edit added" } } }),
		JSON.stringify({ type: "step_finish", sessionID: "ses_1", part: { tokens: { input: 10, output: 2, reasoning: 1, cache: { read: 3, write: 4 } }, cost: 0.01 } }),
		JSON.stringify({ type: "text", sessionID: "ses_1", part: { text: "final answer" } }),
		'{"type":"text","part":', // a trial killed mid-write
	].join("\n");
	const events = parseEvents(lines);
	const context = [
		{ type: "user", text: "do it" },
		{ type: "assistant", content: [{ type: "tool", name: "skill", state: { status: "completed", input: { id: "vide" } } }] },
		{ type: "synthetic", text: "Luau checks before this turn ends:\n\nstylua:\nDiff in src/A.luau" },
	];

	test("skips lines that aren't JSON", () => assert.equal(events.length, 7));
	test("finds the session id and tool uses", () => {
		assert.equal(findSessionID(events), "ses_1");
		assert.deepEqual(toolCallCounts(events), { skill: 1, read: 1, write: 1, edit: 1 });
	});
	test("finds Skill tool loads, SKILL.md reads, and context skill messages", () => {
		assert.deepEqual(skillsLoaded(events, context), ["vide"]);
		assert.deepEqual(skillFileReads(events), ["/p/skills/vide/SKILL.md"]);
	});
	test("derives hook evidence from the gate, lint, and verify messages", () => {
		const hooks = hooksFired(events, context);
		assert.deepEqual(hooks.map((h) => h.hook_name), ["skill-gate", "after-edit", "verify-gate"]);
	});
	test("sums tokens, reasoning, and cache across steps", () => {
		const usage = usageTotals(events);
		assert.equal(usage.total_tokens, 20);
		assert.equal(usage.input_tokens, 10);
		assert.equal(usage.output_tokens, 3);
		assert.equal(usage.cost_usd, 0.01);
	});
	test("summarizes the run and takes the last text as the answer", () => {
		const result = summarizeResult(events);
		assert.equal(result.is_error, false);
		assert.equal(result.num_turns, 1);
		assert.equal(finalText(events), "final answer");
	});
});

describe("isolation check", () => {
	const plugin = "/tmp/plugin";

	test("accepts a clean baseline and the plugin under test", () => {
		assert.deepEqual(checkIsolation({ config: trialConfig(), setup: "baseline" }), { ok: true, problems: [] });
		const config = trialConfig({ pluginDir: plugin });
		assert.equal(checkIsolation({ config, setup: "with-skill", pluginDir: plugin, pluginSkills: ["vide"] }).ok, true);
	});

	test("flags another plugin, an MCP server, or a skill outside the plugin", () => {
		const config = trialConfig({ pluginDir: plugin });
		config.plugins.push("/tmp/other");
		config.mcp.servers = { studio: { type: "local", command: ["x"] } };
		const res = checkIsolation({ config, setup: "with-skill", pluginDir: plugin, pluginSkills: ["vide"], events: [{ type: "tool_use", part: { tool: "skill", state: { status: "completed", input: { id: "roblox" } } } }] });
		assert.equal(res.ok, false);
		assert.ok(res.problems.some((p) => p.includes("/tmp/other")));
		assert.ok(res.problems.some((p) => p.includes("studio")));
		assert.ok(res.problems.some((p) => p.includes("skill outside")));
	});

	test("flags skills in the baseline", () => {
		const res = checkIsolation({ config: trialConfig(), setup: "baseline", events: [{ type: "tool_use", part: { tool: "skill", state: { status: "completed", input: { id: "vide" } } } }] });
		assert.equal(res.ok, false);
		assert.match(res.problems[0], /skills loaded in the baseline: vide/);
	});
});

describe("opencode configuration", () => {
	test("a trial config loads only its plugin and no MCP servers", () => {
		const config = trialConfig({ pluginDir: "/tmp/plugin" });
		assert.deepEqual(config.plugins, ["/tmp/plugin"]);
		assert.deepEqual(config.mcp.servers, {});
		assert.ok(config.permissions.some((r) => r.action === "shell" && r.resource === "*" && r.effect === "deny"));
		assert.ok(config.permissions.some((r) => r.action === "shell" && r.resource === "stylua *" && r.effect === "allow"));
		assert.ok(config.permissions.some((r) => r.resource === "/tmp/plugin/*" && r.effect === "allow"));
	});

	test("child sessions drop OpenCode and Claude state and use the private config", () => {
		const env = childEnv("/tmp/config", { PATH: "x", OPENCODE_SESSION_ID: "s", OPENCODE_CONFIG_DIR: "old", CLAUDECODE: "1", CLAUDE_CODE_SESSION_ID: "s", AI_AGENT: "a" });
		assert.equal(env.PATH, "x");
		assert.equal(env.OPENCODE_CONFIG_DIR, "/tmp/config");
		assert.equal(env.OPENCODE_DISABLE_CLAUDE_CODE, "1");
		assert.equal(env.OPENCODE_SESSION_ID, undefined);
		assert.equal(env.CLAUDECODE, undefined);
		assert.equal(env.AI_AGENT, undefined);
	});

	test("model references split into provider, model, and variant", () => {
		assert.deepEqual(parseModel("opencode-go/deepseek-v4.1-flash"), { providerID: "opencode-go", id: "deepseek-v4.1-flash", variant: "default" });
		assert.deepEqual(parseModel("anthropic/claude-sonnet-5-5#high"), { providerID: "anthropic", id: "claude-sonnet-5-5", variant: "high" });
		assert.throws(() => parseModel("opus"), /provider\/model/);
	});
});

describe("task files", () => {
	const base = { id: 1, name: "t", prompt: "Do it", rubric: ["Works"] };

	test("the smoke task is valid", () => {
		const task = loadTask(path.join(HERE, "..", "..", "smoke", "block-catalog.json"));
		assert.deepEqual(task.auto_checks, ["luau-lsp", "selene", "stylua"]);
	});

	test("rejects paths that leave the project", () => {
		assert.throws(() => validateTask({ ...base, checks: [{ type: "file_exists", path: "../outside.luau" }] }), /\.\./);
		assert.throws(() => validateTask({ ...base, checks: [{ type: "file_exists", path: "C:/Windows/x" }] }), /relative/);
		assert.throws(() => validateTask({ ...base, setup_files: [{ from: "/etc/passwd", to: "src/x" }] }), /relative/);
	});

	test("rejects shell strings, bad regexes, and missing rubrics", () => {
		assert.throws(() => validateTask({ ...base, checks: [{ type: "command", run: "rm -rf /" }] }), /array/);
		assert.throws(() => validateTask({ ...base, checks: [{ type: "file_matches", path: "a", pattern: "(" }] }));
		assert.throws(() => validateTask({ ...base, rubric: [] }), /rubric/);
		assert.throws(() => validateTask({ ...base, name: "Bad Name" }), /name/);
	});

	test("judge_facts defaults to none and keeps valid facts", () => {
		assert.deepEqual(validateTask(base).judge_facts, []);
		const facts = ["Charm.listen runs its callback once right away.", "x".repeat(600)];
		assert.deepEqual(validateTask({ ...base, judge_facts: facts }).judge_facts, facts);
		assert.equal(validateTask({ ...base, judge_facts: Array(12).fill("A fact.") }).judge_facts.length, 12);
	});

	test("judge_facts rejects non-arrays, too many facts, and bad entries", () => {
		assert.throws(() => validateTask({ ...base, judge_facts: "one fact" }), /judge_facts/);
		assert.throws(() => validateTask({ ...base, judge_facts: Array(13).fill("A fact.") }), /at most 12/);
		assert.throws(() => validateTask({ ...base, judge_facts: ["x".repeat(601)] }), /longer than 600/);
		assert.throws(() => validateTask({ ...base, judge_facts: ["  "] }), /judge_facts\[0\]/);
		assert.throws(() => validateTask({ ...base, judge_facts: [42] }), /judge_facts\[0\]/);
	});
});

describe("task checks", () => {
	const project = path.join(tmp, "project");
	mkdirSync(path.join(project, "src"), { recursive: true });
	writeFileSync(path.join(project, "src", "A.luau"), "return table.freeze({ Window = 1, Wood = 2 })\n");

	test("evaluates each check type", () => {
		const results = runTaskChecks({
			projectDir: project,
			checks: [
				{ type: "file_exists", path: "src/A.luau" },
				{ type: "file_absent", path: "src/B.luau" },
				{ type: "file_matches", path: "src/A.luau", pattern: "table\\.freeze" },
				{ type: "file_not_matches", path: "src/A.luau", pattern: "print" },
				{ type: "any_file_matches", dir: "src", ext: ".luau", pattern: "Wood" },
				{ type: "file_exists", path: "src/Missing.luau" },
			],
		});
		assert.deepEqual(
			results.map((r) => r.passed),
			[true, true, true, true, true, false],
		);
	});

	test("a check that escapes the project fails instead of reading outside it", () => {
		const [res] = runTaskChecks({ projectDir: project, checks: [{ type: "file_exists", path: "../../x" }] });
		assert.equal(res.passed, false);
		assert.match(res.evidence, /escapes/);
	});

	test("grading summary keeps the historical schema", () => {
		const g = buildGrading([{ text: "a", passed: true, evidence: "" }, { text: "b", passed: false, evidence: "" }], {});
		assert.deepEqual(g.summary, { passed: 1, failed: 1, total: 2, pass_rate: 0.5 });
	});

	test("evidence drops the trial's absolute path and log noise", () => {
		const out = trimEvidence("[INFO] loading\nc:\\work\\proj\\src\\A.luau(1,1): TypeError", "C:\\work\\proj");
		assert.equal(out, "\\src\\A.luau(1,1): TypeError");
	});
});

describe("paths", () => {
	test("resolveInside refuses to escape", () => {
		assert.throws(() => resolveInside(tmp, "../x"), /escapes/);
		assert.equal(resolveInside(tmp, "a/b"), path.join(tmp, "a", "b"));
	});

	test("finds instruction files above a results folder", () => {
		const parent = path.join(tmp, "parent");
		mkdirSync(path.join(parent, "child"), { recursive: true });
		writeFileSync(path.join(parent, "AGENTS.md"), "# x");
		writeFileSync(path.join(parent, "CLAUDE.md"), "# x");
		const found = ancestorMemoryFiles(path.join(parent, "child"));
		assert.ok(found.includes(path.join(parent, "AGENTS.md")));
		assert.ok(found.includes(path.join(parent, "CLAUDE.md")));
	});

	test("evidence redaction covers drive-letter case and JSON escaping", () => {
		const out = redactPaths({ a: "C:\\w\\x\\y", b: "c:\\w\\x", c: "C:/w/x/z" }, ["C:\\w\\x"]);
		assert.deepEqual(out, { a: "<work>\\y", b: "<work>", c: "<work>/z" });
	});

	test("export redacts the results folder and home folder", () => {
		const home = os.homedir();
		const text = JSON.stringify({ a: path.join(tmp, "eval-1"), b: path.join(home, "x") });
		const out = redact(text, tmp);
		assert.ok(!out.includes(home.replace(/\\/g, "\\\\")));
		assert.ok(out.includes("<results>"));
	});

	test("export redacts paths escaped twice, as in a tool error stored inside a JSON string", () => {
		const home = "C:\\Users\\someone";
		const inner = JSON.stringify({ stderr: "c:\\Users\\someone\\x.luau: Unknown require" });
		const out = redact(JSON.stringify({ result: inner }), tmp, home);
		assert.ok(!out.toLowerCase().includes("someone"), out);
	});

	test("export keeps verdicts and diffs by default, and everything but transcripts with --full", () => {
		for (const name of ["comparison.json", "changes.diff", "final-message.md", "benchmark.md"]) assert.ok(keepFile(name, 10), name);
		for (const name of ["prompt.md", "metrics.json", "Foo.luau", "transcript.jsonl"]) assert.ok(!keepFile(name, 10), name);
		assert.ok(keepFile("prompt.md", 10, { full: true }));
		assert.ok(!keepFile("stderr.log", 0, { full: true }));
		assert.ok(!keepFile("transcript.jsonl", 10, { full: true }));
		assert.ok(keepFile("transcript.jsonl", 10, { full: true, transcripts: true }));
	});
});

describe("trial status", () => {
	const ok = { ok: true, problems: [] };
	test("orders spawn errors, timeouts, contamination, and failures", () => {
		assert.equal(trialStatus({ outcome: { spawnError: "x" }, result: null, isolation: ok }), "failed");
		assert.equal(trialStatus({ outcome: { timedOut: true }, result: null, isolation: ok }), "timeout");
		assert.equal(trialStatus({ outcome: { exitCode: 0 }, result: {}, isolation: { ok: false } }), "contaminated");
		assert.equal(trialStatus({ outcome: { exitCode: 1 }, result: {}, isolation: ok }), "failed");
		assert.equal(trialStatus({ outcome: { exitCode: 0 }, result: { is_error: false }, isolation: ok }), "ok");
	});
});

describe("aggregate", () => {
	test("stats reports mean and stddev", () => {
		assert.deepEqual(stats([1, 2, 3]), { mean: 2, stddev: 1, min: 1, max: 3 });
	});
	test("harness summary counts statuses, skills, and tokens per setup", () => {
		const runs = [
			{ config: "with_skill", status: "ok", pass_rate: 1, target_skill: "vide", target_skill_loaded: true, tokens: { total_tokens: 100, output_tokens: 10 }, wall_seconds: 2, cost_usd: 0.1 },
			{ config: "without_skill", status: "ok", pass_rate: 0, target_skill: null, tokens: { total_tokens: 50, output_tokens: 5 }, wall_seconds: 1, cost_usd: 0.05 },
		];
		const summary = harnessSummary(runs);
		assert.equal(summary.with_skill.trials, 1);
		assert.equal(summary.with_skill.target_skill_loaded, "1/1");
		assert.equal(summary.without_skill.pass_rate.mean, 0);
	});
	test("benchmark keeps the delta and metadata", () => {
		const runs = [{ config: "with_skill", model: "m", eval: "e", run: "run-1", pass_rate: 1, tokens: { total_tokens: 10 }, wall_seconds: 1, cost_usd: 0 }];
		const harness = harnessSummary(runs);
		const benchmark = buildBenchmark({ runs, harness, judge: null, skillName: "vide", skillPath: "p" });
		assert.equal(benchmark.metadata.executor_model, "m");
		assert.equal(benchmark.metadata.skill_name, "vide");
		assert.equal(benchmark.delta.tokens, 10);
	});
});

describe("blind judge", () => {
	test("labels follow the coin flip", () => {
		const w = { id: "with" };
		const b = { id: "base" };
		assert.deepEqual(assignLabels(w, b, 0), { A: w, B: b });
		assert.deepEqual(assignLabels(w, b, 1), { A: b, B: w });
	});

	test("skill names are scrubbed from what the judge sees", () => {
		assert.equal(scrub("-- per roblox-dev:vide and roblox-dev:code-comments"), "-- per <skill> and <skill>");
	});

	test("template placeholders are filled", () => {
		assert.equal(fillTemplate("{{A}} and {{B}} and {{C}}", { A: "1", B: "$&" }), "1 and $& and {{C}}");
	});

	test("the judge prompt carries the JSON schema", () => {
		const instruction = judgeInstruction();
		assert.match(instruction, /Reply with only one JSON object/);
		assert.match(instruction, /"winner"/);
	});

	test("the judge verdict is parsed from plain or fenced JSON", () => {
		const verdict = { A: { overall_score: 8 }, B: { overall_score: 6 }, winner: "A", reasoning: "better" };
		assert.deepEqual(parseJudgeVerdict(JSON.stringify(verdict)), verdict);
		assert.deepEqual(parseJudgeVerdict("```json\n" + JSON.stringify(verdict) + "\n```"), verdict);
		assert.throws(() => parseJudgeVerdict("not json"), /no JSON/);
	});

	describe("judge facts in the prompt", () => {
		const template = "<facts>\n{{FACTS}}\n</facts>\n<task>{{TASK_PROMPT}}</task>\n{{RUBRIC}}\n{{OUTPUT_A}}|{{OUTPUT_B}}";
		const attempt = (diff) => ({ diff, checks: "- [pass] ok" });
		const meta = (extra = {}) => ({ prompt: "Do it", rubric: ["Works"], ...extra });

		test("a task without judge_facts gets only the global facts", () => {
			assert.equal(renderFacts("- Global fact.", undefined), "- Global fact.");
			assert.equal(renderFacts("- Global fact.", []), "- Global fact.");
			const prompt = buildJudgePrompt(template, "- Global fact.", meta(), attempt("a"), attempt("b"));
			assert.match(prompt, /<facts>\n- Global fact\.\n<\/facts>/);
			assert.doesNotMatch(prompt, /Facts for this task/);
		});

		test("task facts follow the global facts, one bullet each", () => {
			const facts = ["Charm.subscribe skips the first run.", "jest.fn returns\n  two values."];
			const prompt = buildJudgePrompt(template, "- Global fact.", meta({ judge_facts: facts }), attempt("a"), attempt("b"));
			const block = /<facts>\n([\s\S]*)\n<\/facts>/.exec(prompt)[1];
			assert.equal(
				block,
				"- Global fact.\n\nFacts for this task, verified against the same source:\n\n- Charm.subscribe skips the first run.\n- jest.fn returns two values.",
			);
			assert.match(prompt, /<task>Do it<\/task>\n1\. Works\na\|b$/);
		});

		test("placeholders inside facts and diffs stay literal", () => {
			const prompt = buildJudgePrompt(template, "- G", meta({ judge_facts: ["{{OUTPUT_A}} $&"] }), attempt("{{TASK_PROMPT}}"), attempt("b"));
			assert.match(prompt, /- \{\{OUTPUT_A\}\} \$&/);
			assert.match(prompt, /\{\{TASK_PROMPT\}\}\|b$/);
		});

		test("the real template has a FACTS placeholder", () => {
			const real = readFileSync(path.join(HERE, "..", "judge-prompt.md"), "utf8");
			const prompt = buildJudgePrompt(real, "- Global fact.", meta({ judge_facts: ["Task fact."] }), attempt("a"), attempt("b"));
			assert.match(prompt, /<library_facts>\n- Global fact\.\n\nFacts for this task[^\n]*\n\n- Task fact\.\n<\/library_facts>/);
		});
	});

	test("summaries count wins per setup", () => {
		const r = (winner, w, b) => ({ status: "ok", winner_config: winner, scores_by_config: { with_skill: w, without_skill: b }, tokens: 100, wall_seconds: 10 });
		const s = summarizeJudgements({ "eval-1": [r("with_skill", 8, 6), r("TIE", 7, 7), { status: "timeout", pair: 3 }] });
		assert.deepEqual(s.evals["eval-1"].wins, { with_skill: 1, without_skill: 0, TIE: 1 });
		assert.deepEqual(s.evals["eval-1"].mean_score, { with_skill: 7.5, without_skill: 6.5 });
		assert.equal(s.totals.judged, 2);
		assert.equal(s.totals.pairs, 3);
	});
});

describe("trigger evaluation", () => {
	test("replaces the description in SKILL.md frontmatter", () => {
		const before = "---\nname: vide\ndescription: old\n---\n\nbody\n";
		assert.match(replaceDescription(before, "new words"), /description: \|\n  new words/);
		assert.match(replaceDescription(before, "new words"), /body/);
	});

	test("counts a skill load before an edit", () => {
		const skill = { type: "tool_use", part: { tool: "skill", state: { status: "completed", input: { id: "vide" } } } };
		const edit = { type: "tool_use", part: { tool: "edit", state: { status: "completed", input: {} } } };
		const read = { type: "tool_use", part: { tool: "read", state: { status: "completed", input: { path: "/p/skills/vide/SKILL.md" } } } };
		assert.equal(triggeredBeforeEdit([skill, edit], "vide"), true);
		assert.equal(triggeredBeforeEdit([edit, skill], "vide"), false);
		assert.equal(triggeredBeforeEdit([read], "vide"), true);
	});

	test("splits queries deterministically into train and test", () => {
		const queries = Array.from({ length: 10 }, (_, i) => ({ query: `q${i}`, should_trigger: true }));
		const a = splitQueries(queries, 0.4, 42);
		const b = splitQueries(queries, 0.4, 42);
		assert.deepEqual(a, b);
		assert.equal(a.train.length + a.test.length, 10);
		assert.equal(a.test.length, 4);
	});
});
