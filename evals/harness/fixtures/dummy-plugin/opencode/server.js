// The fixture's OpenCode adapter. It registers the two skills and leaves two
// observable markers so prove-isolation can see that OpenCode ran the hooks.

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILLS = join(HERE, "..", "skills");

function parseSkill(text, path) {
	const block = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
	const fields = {};
	let key;
	for (const line of (block?.[1] ?? "").split(/\r?\n/)) {
		const pair = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
		if (pair) {
			key = pair[1];
			fields[key] = pair[2].trim();
		} else if (key && /^\s+\S/.test(line)) {
			fields[key] = `${fields[key]} ${line.trim()}`.trim();
		}
	}
	return {
		id: basename(dirname(path)),
		name: fields.name ?? basename(dirname(path)),
		description: fields.description ?? "",
		path,
		content: block ? text.slice(block[0].length) : text,
	};
}

export async function setup(ctx) {
	const dir = ctx.location?.directory ?? process.cwd();
	await ctx.skill.transform((editor) => {
		for (const entry of readdirSync(SKILLS, { withFileTypes: true })) {
			if (!entry.isDirectory() || editor.get(entry.name)) continue;
			const path = join(SKILLS, entry.name, "SKILL.md");
			const skill = parseSkill(readFileSync(path, "utf8"), path);
			if (skill.description) editor.add(skill);
		}
	});
	await ctx.session.hook("prompt", (event) => {
		event.prompt.text = `${event.prompt.text}\n\nEVAL_DUMMY_HOOK_FIRED:UserPromptSubmit`;
		writeFileSync(join(dir, ".eval-hook-prompt"), "UserPromptSubmit\n");
	});
	await ctx.tool.hook("execute.after", (event) => {
		if (event.status !== "completed" || !["edit", "write", "patch"].includes(event.tool)) return;
		writeFileSync(join(dir, ".eval-hook-post-tool"), "PostToolUse\n");
		const marker = "\nEVAL_DUMMY_HOOK_FIRED:PostToolUse";
		if (typeof event.result?.content === "string") event.result = { ...event.result, content: `${event.result.content}${marker}` };
		else event.result = { ...event.result, content: [...(event.result?.content ?? []), { type: "text", text: marker }] };
	});
}

export default { id: "roblox-dev", setup };
