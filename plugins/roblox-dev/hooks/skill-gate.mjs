// PreToolUse gate on Luau file edits in a Rojo repo or a pesde workspace: denies the edit until
// the skills it needs are loaded, and says which ones. The deny reason goes back to the model,
// which loads them and retries, so nobody has to type the reminder. Edits to installed packages
// are denied outright.
//
// "Loaded" means loaded under this plugin's name (`roblox-dev:<skill>`) since the last
// compaction, or re-attached by it in full: compaction cuts a re-attached skill at 20,000
// characters and drops the oldest ones past its budget.

import { existsSync } from 'node:fs';
import { FILE_EDIT_TOOLS, listSkills, readState, runHook, stateFile, writeState } from './lib/hook-io.mjs';
import { loadedSkills, readEntries, toolCalls, transcriptPathFor } from './lib/transcript.mjs';
import { requiredSkillsForEdit } from './lib/gate.mjs';

// Denials in a row, with no gated call let through between them, after which the gate steps
// aside: by then it is likely failing to see a skill the agent did load.
const MAX_DENIAL_STREAK = 3;

runHook((input) => {
  const tool = input.tool_name;
  if (!FILE_EDIT_TOOLS.has(tool)) {
    return undefined;
  }
  const toolInput = input.tool_input ?? {};
  const check = requiredSkillsForEdit(tool, toolInput);
  if (check === undefined) {
    return undefined;
  }
  if (check.denyReason) {
    return deny(check.denyReason);
  }

  const transcript = transcriptPathFor(input);
  if (transcript === undefined || !existsSync(transcript)) {
    return undefined;
  }
  const entries = readEntries(transcript, { since: 'compaction' });
  const { required } = requiredSkillsForEdit(tool, toolInput, toolCalls(entries));
  const loaded = loadedSkills(entries);
  const missing = [...required].filter(([skill]) => !loaded.has(skill));

  const streakFile = stateFile(input.session_id, input.agent_id ?? 'main', 'gate');
  const streak = readState(streakFile, 0);
  if (missing.length === 0 || streak >= MAX_DENIAL_STREAK) {
    if (streak !== 0) {
      writeState(streakFile, 0);
    }
    return undefined;
  }
  writeState(streakFile, (Number.isInteger(streak) ? streak : 0) + 1);

  const reasons = missing.map(([skill, reason]) => `${listSkills([skill])} because ${reason}`).join('; ');
  return deny(
    `Load ${listSkills(missing.map(([skill]) => skill))} with the Skill tool, then retry this edit unchanged. ` +
    `Needed: ${reasons}. Only skills loaded under the \`roblox-dev:\` name count, and a skill that compaction cut ` +
    'short or dropped counts as not loaded.',
  );
});

function deny(reason) {
  return {
    hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason },
  };
}
