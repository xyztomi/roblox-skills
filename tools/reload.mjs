#!/usr/bin/env node
// Restarts the shared OpenCode service. Config and plugin files usually reload on
// their own; a local plugin whose dependency did not reload needs this. It is the
// native restart command, not a workaround.

import { spawnSync } from "node:child_process";

const res = spawnSync("opencode", ["service", "restart"], { stdio: "inherit" });
if (res.error) {
	console.error(`reload: ${res.error.message}`);
	process.exit(1);
}
process.exit(res.status ?? 1);
