import { skillsLoaded } from "./stream.mjs";

export const SETUPS = ["with-skill", "baseline"];

// The results format keeps these folder names, with "with_skill" before
// "without_skill", so the delta reads as with-skill minus baseline.
export const CONFIG_DIR = { "with-skill": "with_skill", baseline: "without_skill" };

// Checks one trial's private config and observed behavior against its setup. The
// config directory is the isolation boundary: user plugins, skills, MCP servers,
// and project config never enter it.
export function checkIsolation({ config, setup, pluginDir = null, pluginSkills = [], events = [], context = null }) {
	const problems = [];
	if (!config) return { ok: false, problems: ["no trial config"] };
	if (setup === "with-skill" && !pluginDir) {
		throw new Error("with-skill isolation check needs the plugin directory");
	}

	const expected = setup === "with-skill" ? [pluginDir] : [];
	const actual = config.plugins ?? [];
	if (actual.length !== expected.length || expected.some((p) => !actual.includes(p))) {
		problems.push(`config plugins are ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
	}
	if (Object.keys(config.mcp?.servers ?? {}).length > 0) {
		problems.push(`config has MCP servers: ${Object.keys(config.mcp.servers).join(", ")}`);
	}

	const loaded = skillsLoaded(events, context);
	if (setup === "baseline") {
		if (loaded.length > 0) problems.push(`skills loaded in the baseline: ${loaded.join(", ")}`);
	} else {
		const allowed = new Set(pluginSkills);
		for (const skill of loaded) {
			if (!allowed.has(skill)) problems.push(`skill outside the plugin under test: ${skill}`);
		}
	}
	return { ok: problems.length === 0, problems };
}
