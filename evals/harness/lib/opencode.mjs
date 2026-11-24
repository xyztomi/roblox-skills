// OpenCode execution for the eval harness. Each trial and judge gets a private
// config directory and its own private server, so user plugins, skills, MCP
// servers, and project configuration never reach it.

import { spawn, spawnSync } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export const DEFAULT_MODEL = process.env.EVAL_MODEL ?? null;

export function opencodeBin() {
	return process.env.OPENCODE_BIN ?? "opencode";
}

// Shell commands a trial may run without a prompt. Everything else is denied.
export const TRIAL_SHELL_ALLOW = [
	"rojo sourcemap *",
	"luau-lsp analyze *",
	"selene *",
	"stylua *",
	"git status *",
	"git diff *",
	"git ls-files *",
	"git log *",
	"git show *",
	"git mv *",
	"git rm *",
];

// The environment for a trial's private server. OPENCODE_CONFIG_DIR keeps user
// configuration, plugins, skills, and MCP servers out; the Claude compatibility
// paths are disabled too. State variables from the launching session are dropped.
export function childEnv(configDir, base = process.env) {
	const env = {};
	for (const [key, value] of Object.entries(base)) {
		if (/^OPENCODE_/i.test(key)) continue;
		if (key === "AI_AGENT" || key === "CLAUDECODE" || /^CLAUDE_/i.test(key)) continue;
		env[key] = value;
	}
	env.OPENCODE_CONFIG_DIR = configDir;
	env.OPENCODE_DISABLE_CLAUDE_CODE = "1";
	env.OPENCODE_DISABLE_CLAUDE_CODE_PROMPT = "1";
	env.OPENCODE_DISABLE_CLAUDE_CODE_SKILLS = "1";
	env.OPENCODE_DISABLE_PROJECT_CONFIG = "1";
	env.OPENCODE_DISABLE_AUTOUPDATE = "1";
	env.NO_COLOR = "1";
	return env;
}

// The config written into each trial's private config directory.
export function trialConfig({ pluginDir = null } = {}) {
	const permissions = [
		{ action: "*", resource: "*", effect: "allow" },
		{ action: "external_directory", resource: "*", effect: "deny" },
		{ action: "shell", resource: "*", effect: "deny" },
		...TRIAL_SHELL_ALLOW.map((resource) => ({ action: "shell", resource, effect: "allow" })),
	];
	if (pluginDir) {
		permissions.push(
			{ action: "external_directory", resource: `${pluginDir}/*`, effect: "allow" },
			{ action: "read", resource: `${pluginDir}/*`, effect: "allow" },
		);
	}
	return {
		$schema: "https://opencode.ai/config.json",
		plugins: pluginDir ? [pluginDir] : [],
		mcp: { servers: {} },
		permissions,
	};
}

export function writeTrialConfig(configDir, options) {
	const config = trialConfig(options);
	mkdirSync(configDir, { recursive: true });
	writeFileSync(path.join(configDir, "opencode.json"), `${JSON.stringify(config, null, 2)}\n`);
	return config;
}

export function parseModel(ref) {
	if (!ref) return undefined;
	if (typeof ref === "object") return { variant: "default", ...ref };
	const slash = ref.indexOf("/");
	if (slash <= 0 || slash === ref.length - 1) throw new Error(`model must be provider/model or provider/model#variant: ${ref}`);
	const providerID = ref.slice(0, slash);
	const rest = ref.slice(slash + 1);
	const hash = rest.indexOf("#");
	const id = hash === -1 ? rest : rest.slice(0, hash);
	const variant = hash === -1 ? "default" : rest.slice(hash + 1);
	return { providerID, id, variant };
}

function killTree(child) {
	if (child.exitCode !== null) return;
	if (process.platform === "win32") {
		spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
	} else {
		child.kill("SIGKILL");
	}
}

// Runs one headless OpenCode session with a private server and streams its JSON
// events to transcriptPath. Never rejects: a spawn error or timeout is part of
// the outcome.
export function runOpencode({ prompt, cwd, configDir, model, transcriptPath, stderrPath, timeoutMs, agent = "build" }) {
	return new Promise((resolve) => {
		const started = new Date();
		const out = createWriteStream(transcriptPath);
		const err = createWriteStream(stderrPath);
		let timedOut = false;
		let settled = false;
		const finish = (outcome) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			const ended = new Date();
			let pending = 2;
			const done = () => {
				if (--pending === 0) {
					resolve({
						...outcome,
						timedOut,
						startedAt: started.toISOString(),
						endedAt: ended.toISOString(),
						wallMs: ended - started,
					});
				}
			};
			out.end(done);
			err.end(done);
		};

		let child;
		try {
			child = spawn(opencodeBin(), ["run", "--standalone", "--format", "json", "--agent", agent, "--model", model, prompt], {
				cwd,
				env: { ...childEnv(configDir), PWD: cwd },
				stdio: ["ignore", "pipe", "pipe"],
				windowsHide: true,
			});
		} catch (e) {
			finish({ exitCode: null, spawnError: e.message });
			return;
		}
		const timer = setTimeout(() => {
			timedOut = true;
			killTree(child);
		}, timeoutMs);
		child.stdout.pipe(out, { end: false });
		child.stderr.pipe(err, { end: false });
		child.on("error", (e) => finish({ exitCode: null, spawnError: e.message }));
		child.on("close", (code) => finish({ exitCode: code, spawnError: null }));
	});
}

// The session's full message history, read from the shared database by a private
// server using the trial's config. Gives skill messages, synthetic messages, and
// tool calls that the CLI event stream does not include.
export function readSessionContext({ sessionID, configDir, cwd }) {
	const res = spawnSync(opencodeBin(), ["api", "get", `/api/session/${sessionID}/context`, "--standalone"], {
		cwd,
		env: { ...childEnv(configDir), PWD: cwd },
		encoding: "utf8",
		timeout: 60_000,
		maxBuffer: 64 * 1024 * 1024,
	});
	if (res.error) throw new Error(`session context failed: ${res.error.message}`);
	if (res.status !== 0) throw new Error(`session context failed (${res.status}): ${(res.stderr ?? "").slice(0, 2000)}`);
	const parsed = JSON.parse(res.stdout);
	return parsed.data ?? parsed;
}

// Stateless generation with no tools and no session. Used for the blind judge and
// the description rewriter. It connects to the shared service, which has the
// user's model credentials; it never sees a trial project.
export function generateText({ prompt, model, timeoutMs = 300_000 }) {
	const ref = parseModel(model);
	if (!ref) throw new Error("a model is required (pass --model provider/model)");
	const env = {};
	for (const [key, value] of Object.entries(process.env)) {
		if (/^OPENCODE_(SESSION_ID|CONFIG_DIR|CONFIG_CONTENT|CONFIG|DB|SERVER|CLIENT)$/i.test(key)) continue;
		if (key === "AI_AGENT" || key === "CLAUDECODE" || /^CLAUDE_/i.test(key)) continue;
		env[key] = value;
	}
	const res = spawnSync(
		opencodeBin(),
		["api", "post", "/api/experimental/generate/text", "-d", JSON.stringify({ prompt, model: ref })],
		{ env, encoding: "utf8", timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 },
	);
	if (res.error) throw new Error(`generate text failed: ${res.error.message}`);
	if (res.status !== 0) throw new Error(`generate text failed (${res.status}): ${(res.stderr ?? res.stdout ?? "").slice(0, 2000)}`);
	const parsed = JSON.parse(res.stdout);
	if (typeof parsed?.data?.text !== "string") throw new Error("generate text returned no text");
	return parsed.data.text;
}

export function readPluginName(pluginDir) {
	const packageFile = path.join(pluginDir, "package.json");
	if (existsSync(packageFile)) {
		const parsed = JSON.parse(readFileSync(packageFile, "utf8"));
		if (typeof parsed.name === "string" && parsed.name.trim()) return parsed.name;
	}
	const manifest = path.join(pluginDir, ".claude-plugin", "plugin.json");
	const parsed = JSON.parse(readFileSync(manifest, "utf8"));
	if (typeof parsed.name !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(parsed.name)) {
		throw new Error(`plugin manifest ${manifest} has no valid "name"`);
	}
	return parsed.name;
}

export function pluginSkills(pluginDir) {
	const dir = path.join(pluginDir, "skills");
	if (!existsSync(dir)) return [];
	return readdirSync(dir, { withFileTypes: true })
		.filter((entry) => entry.isDirectory() && existsSync(path.join(dir, entry.name, "SKILL.md")))
		.map((entry) => entry.name)
		.sort();
}
