// OpenCode execution for the packaged-plugin check.

import { spawn, spawnSync } from "node:child_process";
import { createWriteStream, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

// Shell commands the live check may run without a prompt.
const SHELL_ALLOW = [
	"rojo sourcemap *",
	"luau-lsp analyze *",
	"selene *",
	"stylua *",
	"git status *",
	"git diff *",
	"git ls-files *",
	"git log *",
	"git show *",
];

export function childEnv(configDir, base = process.env) {
	const env = {};
	for (const [key, value] of Object.entries(base)) {
		if (/^OPENCODE_/i.test(key)) continue;
		if (key === "AI_AGENT" || key === "CLAUDECODE" || /^CLAUDE_/i.test(key)) continue;
		env[key] = value;
	}
	env.OPENCODE_CONFIG_DIR = configDir;
	env.OPENCODE_DISABLE_CLAUDE_CODE = "1";
	env.OPENCODE_DISABLE_PROJECT_CONFIG = "1";
	env.OPENCODE_DISABLE_AUTOUPDATE = "1";
	env.NO_COLOR = "1";
	return env;
}

export function trialConfig({ pluginDir = null } = {}) {
	const permissions = [
		{ action: "*", resource: "*", effect: "allow" },
		{ action: "external_directory", resource: "*", effect: "deny" },
		{ action: "shell", resource: "*", effect: "deny" },
		...SHELL_ALLOW.map((resource) => ({ action: "shell", resource, effect: "allow" })),
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

function killTree(child) {
	if (child.exitCode !== null) return;
	if (process.platform === "win32") {
		spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
	} else {
		child.kill("SIGKILL");
	}
}

// One headless OpenCode session with a private server. The prompt is passed as
// an argument; current task prompts are well below ARG_MAX.
export function runOpencode({ prompt, cwd, configDir, model, transcriptPath, stderrPath, timeoutMs }) {
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
			child = spawn(process.env.OPENCODE_BIN ?? "opencode", ["run", "--standalone", "--format", "json", "--agent", "build", "--model", model, prompt], {
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
