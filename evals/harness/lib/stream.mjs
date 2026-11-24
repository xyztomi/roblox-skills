// Parses OpenCode's `run --format json` event stream and the session context the
// API returns. One JSON object per line; tool_use events carry the full tool state.

export function parseEvents(text) {
	const events = [];
	for (const line of text.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed.startsWith("{")) continue;
		try {
			events.push(JSON.parse(trimmed));
		} catch {
			// A trial killed mid-write can leave a partial last line.
		}
	}
	return events;
}

export function findSessionID(events) {
	return events.find((e) => typeof e.sessionID === "string")?.sessionID ?? null;
}

export function findError(events) {
	return events.find((e) => e.type === "error")?.error ?? null;
}

export function toolUses(events) {
	const uses = [];
	for (const e of events) {
		if (e.type !== "tool_use") continue;
		const part = e.part ?? {};
		uses.push({
			name: part.tool ?? "",
			input: part.state?.input ?? {},
			status: part.state?.status ?? null,
			output: typeof part.state?.output === "string" ? part.state.output : "",
			error: typeof part.state?.error === "string" ? part.state.error : "",
		});
	}
	return uses;
}

export function skillsFromContext(messages) {
	const loaded = new Set();
	let start = 0;
	for (let index = 0; index < messages.length; index += 1) {
		if (messages[index]?.type === "compaction") start = index + 1;
	}
	for (const message of messages.slice(start)) {
		if (message?.type === "skill" && typeof message.skill === "string") loaded.add(message.skill);
		if (message?.type === "user" && Array.isArray(message.skills)) {
			for (const skill of message.skills) if (typeof skill?.id === "string") loaded.add(skill.id);
		}
		if (message?.type === "assistant" && Array.isArray(message.content)) {
			for (const part of message.content) {
				if (part?.type === "tool" && part.name === "skill" && part.state?.status === "completed") {
					const id = part.state.input?.id;
					if (typeof id === "string") loaded.add(id);
				}
			}
		}
	}
	return loaded;
}

export function skillsLoaded(events, context = null) {
	const loaded = new Set(
		toolUses(events)
			.filter((u) => u.name === "skill" && u.status === "completed" && typeof u.input.id === "string")
			.map((u) => u.input.id),
	);
	if (Array.isArray(context)) {
		for (const skill of skillsFromContext(context)) loaded.add(skill);
	}
	return [...loaded];
}

// Reading a SKILL.md with the read tool also loads a skill's instructions.
export function skillFileReads(events) {
	return toolUses(events)
		.filter((u) => u.name === "read" && /SKILL\.md$/i.test(String(u.input.path ?? "")))
		.map((u) => u.input.path);
}

export function toolCallCounts(events) {
	const counts = {};
	for (const u of toolUses(events)) counts[u.name] = (counts[u.name] ?? 0) + 1;
	return counts;
}

// Evidence that the plugin's hooks ran, derived from the events and the session's
// messages. OpenCode has no hook event stream, so each hook's own effect is the proof.
export function hooksFired(events, context = null) {
	const found = [];
	for (const use of toolUses(events)) {
		if (use.status === "error" && /with the skill tool/i.test(use.error)) {
			found.push({ hook_name: "skill-gate", evidence: use.error.slice(0, 300) });
		}
		if (/Luau convention check/i.test(use.output)) {
			found.push({ hook_name: "after-edit", evidence: use.output.slice(0, 300) });
		}
	}
	if (Array.isArray(context)) {
		for (const message of context) {
			if (message?.type === "synthetic" && /Luau checks before this turn ends/i.test(String(message.text ?? ""))) {
				found.push({ hook_name: "verify-gate", evidence: String(message.text).slice(0, 300) });
			}
		}
	}
	return found;
}

// Totals across every model step the session ran.
export function usageTotals(events) {
	const totals = {
		input_tokens: 0,
		output_tokens: 0,
		cache_read_input_tokens: 0,
		cache_creation_input_tokens: 0,
		total_tokens: 0,
	};
	let cost = 0;
	for (const e of events) {
		if (e.type !== "step_finish") continue;
		const t = e.part?.tokens ?? {};
		const cache = t.cache ?? {};
		totals.input_tokens += t.input ?? 0;
		totals.output_tokens += (t.output ?? 0) + (t.reasoning ?? 0);
		totals.cache_read_input_tokens += cache.read ?? 0;
		totals.cache_creation_input_tokens += cache.write ?? 0;
		cost += e.part?.cost ?? 0;
	}
	totals.total_tokens =
		totals.input_tokens +
		totals.output_tokens +
		totals.cache_read_input_tokens +
		totals.cache_creation_input_tokens;
	return { ...totals, cost_usd: Math.round(cost * 10000) / 10000 };
}

export function summarizeResult(events) {
	const error = findError(events);
	const steps = events.filter((e) => e.type === "step_start").length;
	const usage = usageTotals(events);
	const empty = steps === 0 && finalText(events).trim() === "";
	return {
		is_error: error !== null || empty,
		error: error ? (error.message ?? error.type ?? "error") : empty ? "the session produced no steps or text" : null,
		num_turns: steps,
		cost_usd: usage.cost_usd,
	};
}

// The last text part is the assistant's final answer.
export function finalText(events) {
	let text = "";
	for (const e of events) {
		if (e.type === "text" && typeof e.part?.text === "string") text = e.part.text;
	}
	return text;
}

// A short summary of what the session loaded, for metrics.json.
export function summarizeSession({ sessionID, model, config, context = null, skills = [] }) {
	return {
		sessionID,
		model,
		plugins: (config?.plugins ?? []).map((plugin) => ({ name: plugin, source: "config" })),
		skills,
		messages: Array.isArray(context) ? context.length : null,
	};
}
