// Minimal --flag value parser for the harness CLIs. Flags listed in `booleans`
// take no value; every other flag needs one.
export function parseArgs(argv, { booleans = [] } = {}) {
	const flags = {};
	const positional = [];
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (!arg.startsWith("--")) {
			positional.push(arg);
			continue;
		}
		const eq = arg.indexOf("=");
		const name = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
		if (booleans.includes(name)) {
			flags[name] = true;
		} else if (eq !== -1) {
			flags[name] = arg.slice(eq + 1);
		} else {
			if (i + 1 >= argv.length) throw new Error(`--${name} needs a value`);
			flags[name] = argv[++i];
		}
	}
	return { flags, positional };
}

export function intFlag(value, name, { min = 1, max = 1000, fallback }) {
	if (value === undefined) return fallback;
	const n = Number(value);
	if (!Number.isInteger(n) || n < min || n > max) throw new Error(`--${name} must be an integer from ${min} to ${max}`);
	return n;
}

export function listFlag(value) {
	if (!value) return [];
	return String(value)
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean);
}
