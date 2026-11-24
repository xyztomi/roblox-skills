#!/usr/bin/env node
// Aggregates a results folder into benchmark.json and benchmark.md: pass rate,
// time, tokens, and cost per setup, with the with-skill minus baseline delta,
// plus trial statuses, whether the target skill loaded, and the blind judge.
//
//   node evals/harness/aggregate.mjs --results <dir> [--skill-name <name>] [--skill-path <path>]
//     [--allow-contaminated]

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseArgs } from "./lib/args.mjs";
import { CONFIG_DIR } from "./lib/isolation.mjs";
import { readJson, writeJson } from "./lib/workspace.mjs";

const WITH = CONFIG_DIR["with-skill"];
const BASE = CONFIG_DIR.baseline;

export function stats(values) {
	if (values.length === 0) return { mean: 0, stddev: 0, min: 0, max: 0 };
	const n = values.length;
	const mean = values.reduce((a, b) => a + b, 0) / n;
	const stddev = n > 1 ? Math.sqrt(values.reduce((a, x) => a + (x - mean) ** 2, 0) / (n - 1)) : 0;
	const r = (x) => Math.round(x * 10000) / 10000;
	return { mean: r(mean), stddev: r(stddev), min: r(Math.min(...values)), max: r(Math.max(...values)) };
}

export function collectRuns(results) {
	const runs = [];
	for (const evalName of readdirSync(results).filter((d) => d.startsWith("eval-")).sort()) {
		for (const config of [WITH, BASE]) {
			const dir = path.join(results, evalName, config);
			if (!existsSync(dir)) continue;
			for (const run of readdirSync(dir).filter((d) => /^run-\d+$/.test(d))) {
				const file = path.join(dir, run, "run.json");
				const record = existsSync(file) ? readJson(file) : { status: "missing" };
				runs.push({ eval: evalName, config, run, ...record });
			}
		}
	}
	return runs;
}

export function harnessSummary(runs) {
	const byConfig = {};
	for (const config of [WITH, BASE]) {
		const mine = runs.filter((r) => r.config === config);
		const statuses = {};
		for (const r of mine) statuses[r.status ?? "missing"] = (statuses[r.status ?? "missing"] ?? 0) + 1;
		const withTarget = mine.filter((r) => r.target_skill);
		byConfig[config] = {
			trials: mine.length,
			statuses,
			target_skill_loaded: withTarget.length ? `${withTarget.filter((r) => r.target_skill_loaded).length}/${withTarget.length}` : null,
			pass_rate: stats(mine.map((r) => r.pass_rate ?? 0)),
			tokens: stats(mine.map((r) => r.tokens?.total_tokens ?? 0)),
			output_tokens: stats(mine.map((r) => r.tokens?.output_tokens ?? 0)),
			wall_seconds: stats(mine.map((r) => r.wall_seconds ?? 0)),
			cost_usd: stats(mine.map((r) => r.cost_usd ?? 0)),
			total_cost_usd: Math.round(mine.reduce((a, r) => a + (r.cost_usd ?? 0), 0) * 10000) / 10000,
		};
	}
	return byConfig;
}

export function buildBenchmark({ runs, harness, judge, skillName, skillPath }) {
	const models = [...new Set(runs.map((r) => r.model).filter(Boolean))];
	const runCounts = runs.reduce((acc, r) => ((acc[`${r.eval}/${r.config}`] = (acc[`${r.eval}/${r.config}`] ?? 0) + 1), acc), {});
	const delta = {};
	for (const key of ["pass_rate", "tokens", "output_tokens", "wall_seconds", "cost_usd"]) {
		delta[key] = Math.round(((harness[WITH]?.[key]?.mean ?? 0) - (harness[BASE]?.[key]?.mean ?? 0)) * 10000) / 10000;
	}
	return {
		metadata: {
			skill_name: skillName ?? null,
			skill_path: skillPath ?? null,
			executor_model: models.join(", ") || "unknown",
			analyzer_model: judge ? "judge: see judge-summary.json" : null,
			runs_per_configuration: Math.max(0, ...Object.values(runCounts)),
			generated_at: new Date().toISOString(),
			harness: "opencode",
		},
		configurations: { [WITH]: harness[WITH], [BASE]: harness[BASE] },
		delta,
		runs,
		judge: judge ?? null,
	};
}

function markdown(benchmark, runs) {
	const h = benchmark.configurations;
	const j = benchmark.judge;
	const lines = [
		"# Skill benchmark",
		"",
		`**Model**: ${benchmark.metadata.executor_model}`,
		`**Runs per configuration**: ${benchmark.metadata.runs_per_configuration}`,
		"",
		"## Trials",
		"",
		"| Setup | Trials | Statuses | Target skill loaded | Pass rate (mean ± sd) | Tokens (mean ± sd) | Wall s (mean ± sd) | Cost $ (mean, total) |",
		"|---|---|---|---|---|---|---|---|",
	];
	for (const config of [WITH, BASE]) {
		const c = h[config];
		lines.push(
			`| ${config} | ${c.trials} | ${Object.entries(c.statuses).map(([k, v]) => `${k} ${v}`).join(", ")} | ${c.target_skill_loaded ?? "n/a"} | ${c.pass_rate.mean} ± ${c.pass_rate.stddev} | ${Math.round(c.tokens.mean)} ± ${Math.round(c.tokens.stddev)} | ${c.wall_seconds.mean.toFixed(1)} ± ${c.wall_seconds.stddev.toFixed(1)} | ${c.cost_usd.mean.toFixed(4)}, ${c.total_cost_usd.toFixed(4)} |`,
		);
	}
	const d = benchmark.delta;
	lines.push(
		"",
		`**Delta (with-skill minus baseline)**: pass rate ${d.pass_rate >= 0 ? "+" : ""}${d.pass_rate}, tokens ${Math.round(d.tokens)}, wall ${d.wall_seconds.toFixed(1)} s, cost $${d.cost_usd.toFixed(4)}.`,
		"",
		"Tokens count input, output, reasoning, and cache reads and writes across every model step.",
		"",
		"## Per trial",
		"",
		"| Eval | Setup | Run | Status | Pass rate | Skills loaded | Tokens | Output tokens | Wall s | Cost $ |",
		"|---|---|---|---|---|---|---|---|---|---|",
	);
	for (const r of runs) {
		lines.push(
			`| ${r.eval} | ${r.config} | ${r.run} | ${r.status} | ${r.pass_rate ?? 0} | ${(r.skills_loaded ?? []).join(", ") || "none"} | ${r.tokens?.total_tokens ?? 0} | ${r.tokens?.output_tokens ?? 0} | ${r.wall_seconds ?? 0} | ${(r.cost_usd ?? 0).toFixed(4)} |`,
		);
	}
	if (j) {
		lines.push("", "## Blind judge", "", "| Eval | Pairs judged | with_skill wins | without_skill wins | Ties | Mean score with_skill | Mean score without_skill |", "|---|---|---|---|---|---|---|");
		for (const [name, e] of Object.entries(j.evals)) {
			lines.push(`| ${name} | ${e.judged}/${e.pairs} | ${e.wins[WITH]} | ${e.wins[BASE]} | ${e.wins.TIE} | ${e.mean_score[WITH] ?? "-"} | ${e.mean_score[BASE] ?? "-"} |`);
		}
		const t = j.totals;
		lines.push(`| **All** | ${t.judged}/${t.pairs} | ${t[WITH]} | ${t[BASE]} | ${t.TIE} | ${t.mean_score[WITH] ?? "-"} | ${t.mean_score[BASE] ?? "-"} |`);
	}
	return `${lines.join("\n")}\n`;
}

async function main() {
	const { flags } = parseArgs(process.argv.slice(2), { booleans: ["allow-contaminated"] });
	if (!flags.results) {
		console.error("usage: node evals/harness/aggregate.mjs --results <dir> [--skill-name <name>] [--skill-path <path>]");
		process.exit(2);
	}
	const results = path.resolve(flags.results);
	const runs = collectRuns(results);
	if (runs.length === 0) throw new Error(`no trials under ${results}`);
	const contaminated = runs.filter((r) => r.status === "contaminated");
	if (contaminated.length > 0 && !flags["allow-contaminated"]) {
		throw new Error(`${contaminated.length} contaminated trial(s); fix isolation and rerun, or pass --allow-contaminated`);
	}

	const harness = harnessSummary(runs);
	const judgeFile = path.join(results, "judge-summary.json");
	const judge = existsSync(judgeFile) ? readJson(judgeFile) : null;
	const benchmark = buildBenchmark({
		runs,
		harness,
		judge,
		skillName: flags["skill-name"],
		skillPath: flags["skill-path"],
	});
	writeJson(path.join(results, "benchmark.json"), benchmark);
	writeFileSync(path.join(results, "benchmark.md"), markdown(benchmark, runs));
	process.stdout.write(`Updated ${path.join(results, "benchmark.json")} and benchmark.md\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	main().catch((err) => {
		console.error(`aggregate: ${err.message}`);
		process.exit(1);
	});
}
