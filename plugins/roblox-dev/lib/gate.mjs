// The skill gate's decision, used by the OpenCode plugin. Given a
// Luau file edit and what the session has already read, it names the skills the edit needs.

import { existsSync, readFileSync } from 'node:fs';
import { addsRequire, editText, isSpecPath, isStoryPath, isVideUiEdit, looksLikeCharm, looksLikeVide, readOf, scriptsRead } from './luau.mjs';
import { findRojoProject, instancePathOfFile, isInInstalledPackages, isWatchedLuauFile } from './rojo.mjs';

export const PACKAGE_EDIT_REASON =
  'Installed packages are generated: `pesde install` rewrites every file in `roblox_packages`, so an edit here ' +
  'is lost on the next install. Change the package at its source and update its version in pesde.toml. The ' +
  '`rojo-workflow` skill covers packages.';

// Adds the skills the Luau an edit writes calls for. `path` is the script's DataModel path when
// known; `isGameCode` is false for Luau outside the place (a Lune tool), which needs no
// architecture rules.
function luauSkills(need, { tool, input, path, added, replaced, calls, isGameCode }) {
  need('luau-style-guide', 'it changes Luau');
  need('code-comments', 'it changes Luau, and every Luau edit follows the comment rules');
  const reads = scriptsRead(calls);
  const read = readOf(reads, path);
  if (read.vide || looksLikeVide(added) || isStoryPath(path)) {
    need('vide', 'the script uses Vide');
    if (isVideUiEdit(tool, input, path, reads)) {
      need('vide-ui-labs', 'it is a Vide component, screen, or story, and every one gets a UI Labs story');
    }
    if (read.charm || looksLikeCharm(added)) {
      need('vide-charm', 'the UI uses Charm state');
    }
  }
  if (isSpecPath(path)) {
    need('roblox-testing', 'the script is a spec');
  }
  if (isGameCode && addsRequire(added, replaced)) {
    need('game-architecture', 'it adds a require between modules');
  }
}

function readFileOr(path, fallback) {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return fallback;
  }
}

// For a Luau file edit in a Rojo repo or pesde workspace: { required } skills (a Map of skill to
// reason), or { denyReason } for a file that must not be edited. Undefined for any other file.
// `calls` are earlier tool calls as { name, input, result }, in the shape the OpenCode
// call objects produce; an empty list is fine.
export function requiredSkillsForEdit(tool, input, calls = []) {
  const file = input.file_path;
  if (!isWatchedLuauFile(file)) {
    return undefined;
  }
  if (isInInstalledPackages(file)) {
    return { denyReason: PACKAGE_EDIT_REASON };
  }
  const project = findRojoProject(file);
  const instancePath = project ? instancePathOfFile(project, file) : undefined;
  const isGameCode = !project || instancePath !== undefined;
  const path = instancePath ?? String(file).replace(/\.(luau|lua)$/i, '').replace(/[\\/]/g, '.');
  const { added, replaced: edited } = editText(tool, input);
  const exists = existsSync(file);
  // A whole-file write counts every require it adds over the file's current text.
  const replaced = tool === 'Write' ? readFileOr(file, '') : edited;
  const required = new Map();
  const need = (skill, reason) => {
    if (!required.has(skill)) {
      required.set(skill, reason);
    }
  };
  luauSkills(need, { tool, input, path, added, replaced, calls, isGameCode });
  if (tool === 'Write' && !exists && instancePath !== undefined) {
    need('game-architecture', 'it creates a script');
  }
  return { required };
}
