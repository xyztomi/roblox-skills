// Parses the OpenCode `run --format json` event stream used by the packaged check.

export function parseEvents(text) {
	const events = [];
	for (const line of text.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed.startsWith("{")) continue;
		try {
			events.push(JSON.parse(trimmed));
		} catch {
			// A killed session can leave a partial last line.
		}
	}
	return events;
}

export function toolUses(events) {
	const uses = [];
	for (const event of events) {
		if (event.type !== "tool_use") continue;
		const state = event.part?.state ?? {};
		uses.push({
			name: event.part?.tool ?? "",
			input: state.input ?? {},
			status: state.status ?? null,
			output: typeof state.output === "string" ? state.output : "",
			error: typeof state.error === "string" ? state.error : "",
		});
	}
	return uses;
}

export function skillsLoaded(events) {
	return toolUses(events)
		.filter((use) => use.name === "skill" && use.status === "completed" && typeof use.input.id === "string")
		.map((use) => use.input.id);
}

export function hooksFired(events) {
	const found = [];
	for (const use of toolUses(events)) {
		if (use.status === "error" && /with the skill tool/i.test(use.error)) {
			found.push({ hook_name: "skill-gate", evidence: use.error.slice(0, 300) });
		}
		if (/Luau convention check/i.test(use.output)) {
			found.push({ hook_name: "after-edit", evidence: use.output.slice(0, 300) });
		}
	}
	return found;
}

export function findError(events) {
	return events.find((event) => event.type === "error")?.error ?? null;
}

export function finalText(events) {
	let text = "";
	for (const event of events) {
		if (event.type === "text" && typeof event.part?.text === "string") text = event.part.text;
	}
	return text;
}
