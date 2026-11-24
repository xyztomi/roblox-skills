// Translates OpenCode's edit, write, and patch calls into the shapes the shared Luau rules
// expect, and turns those rules into OpenCode gate decisions and hints.

import { isAbsolute, resolve } from 'node:path';
import { requiredSkillsForEdit } from '../hooks/lib/gate.mjs';
import { buildsVideUi, isSpecPath, isStoryPath, looksLikeCharm, looksLikeVide } from '../hooks/lib/luau.mjs';
import { findRojoProject, instancePathOfFile, isWatchedLuauFile } from '../hooks/lib/rojo.mjs';

const EDIT_TOOLS = new Set(['edit', 'write', 'patch']);

// Tool paths arrive relative to the session's folder, while the shared rules resolve paths from
// the server process. Give every path an absolute form first.
function absolute(path, base) {
  if (typeof path !== 'string' || path === '' || isAbsolute(path)) {
    return path;
  }
  return resolve(base ?? process.cwd(), path);
}

export function isEditTool(name) {
  return EDIT_TOOLS.has(name);
}

// One `*** Update File:` or `*** Add File:` section of OpenCode's patch format, as a write.
function patchEdits(patchText, base) {
  const edits = [];
  let current;
  const push = () => {
    if (current) {
      edits.push({ tool: 'Write', args: { file_path: current.path, content: current.lines.join('\n') } });
      current = undefined;
    }
  };
  for (const line of String(patchText ?? '').split(/\r?\n/)) {
    const header = /^\*\*\* (?:Add|Update) File: (.+)$/.exec(line);
    if (header) {
      push();
      current = { path: absolute(header[1].trim(), base), lines: [] };
      continue;
    }
    if (/^\*\*\* (?:Delete File|Move to|End Patch):?/.test(line)) {
      push();
      continue;
    }
    if (!current || line.startsWith('@@')) {
      continue;
    }
    if (line.startsWith('+') || line.startsWith(' ')) {
      current.lines.push(line.slice(1));
    } else if (!line.startsWith('-')) {
      current.lines.push(line);
    }
  }
  push();
  return edits;
}

// The edit as the shared rules see it: Claude's tool names and argument fields.
export function normalizedEdits(tool, input, base) {
  switch (tool) {
    case 'edit':
      return [{
        tool: 'Edit',
        args: {
          file_path: absolute(input.path, base),
          old_string: input.oldString ?? '',
          new_string: input.newString ?? '',
        },
      }];
    case 'write':
      return [{ tool: 'Write', args: { file_path: absolute(input.path, base), content: input.content ?? '' } }];
    case 'patch':
      return patchEdits(input.patchText, base);
    default:
      return [];
  }
}

// The files an edit call touches, for the verify gate.
export function editedFiles(tool, input, base) {
  return normalizedEdits(tool, input, base)
    .map((edit) => edit.args.file_path)
    .filter((path) => typeof path === 'string');
}

// The skills every touched Luau file needs, or a reason the call must be denied.
export function requiredForEdits(tool, input, base) {
  const required = new Map();
  for (const edit of normalizedEdits(tool, input, base)) {
    const check = requiredSkillsForEdit(edit.tool, edit.args);
    if (check === undefined) {
      continue;
    }
    if (check.denyReason) {
      return { denyReason: check.denyReason };
    }
    for (const [skill, reason] of check.required) {
      if (!required.has(skill)) {
        required.set(skill, reason);
      }
    }
  }
  return required.size > 0 ? { required } : undefined;
}

export function listSkills(names) {
  const shown = names.map((name) => `\`${name}\``);
  if (shown.length === 1) {
    return shown[0];
  }
  return `${shown.slice(0, -1).join(', ')} and ${shown.at(-1)}`;
}

// The hint a Read of a Luau file earns, or undefined when nothing is missing.
export function readHint(input, text, loaded, base) {
  const file = absolute(input.path, base);
  if (!isWatchedLuauFile(file)) {
    return undefined;
  }
  const project = findRojoProject(file);
  const path = project ? instancePathOfFile(project, file) : undefined;
  if (path === undefined) {
    return undefined;
  }
  const spec = isSpecPath(path);
  const needed = [];
  if (looksLikeVide(text) || isStoryPath(path)) {
    needed.push('vide');
    if ((buildsVideUi(text) || isStoryPath(path)) && !spec) {
      needed.push('vide-ui-labs');
    }
    if (looksLikeCharm(text)) {
      needed.push('vide-charm');
    }
  }
  if (spec) {
    needed.push('roblox-testing');
  }
  const missing = needed.filter((skill) => !loaded.has(skill));
  if (missing.length === 0) {
    return undefined;
  }
  return `${path} is ${spec ? 'a spec' : 'Vide code'}. Load ${listSkills(missing)} before editing it; ` +
    'the skill gate requires them.';
}

const PROMPT_HINTS = [
  { pattern: /\b(vide|ui|gui|hud|screens?|menus?|buttons?|panels?|stor(y|ies)|ui labs)\b/i, skills: ['vide', 'vide-ui-labs', 'game-ui-design'], topic: 'UI' },
  { pattern: /\bcharm\b/i, skills: ['vide-charm'], topic: 'Charm state' },
  { pattern: /\bfigma\b/i, skills: ['figma-to-roblox'], topic: 'a Figma design' },
  { pattern: /\b(lag\w*|fps|stutter\w*|slow\w*|optimi[sz]\w*|perf|performance|profil\w*|memory|ping|benchmark\w*)\b/i, skills: ['roblox-performance'], topic: 'performance' },
  { pattern: /\b(specs?|jest|unit tests?|tdd|test-first|regression tests?)\b/i, skills: ['roblox-testing'], topic: 'specs' },
  { pattern: /\b(new (system|module|service|script)s?|module ?loader|cyclic|relocat\w*)\b/i, skills: ['game-architecture'], topic: 'module structure' },
  { pattern: /\b(rojo|pesde|syncback)\b/i, skills: ['rojo-workflow'], topic: 'the Rojo workflow' },
];

const UI_PERFORMANCE_HINT = { skills: ['vide-performance'], topic: 'UI performance' };

// Subagent reports and background-task notices arrive as prompts too; only the user's own
// wording says what the task is.
const NOT_FROM_USER = /<agent-message\b|<task-notification>|\[SYSTEM NOTIFICATION/;

// A soft reminder from the prompt's wording, naming only the skills not loaded yet.
export function promptHint(text, loaded) {
  const prompt = String(text ?? '');
  if (NOT_FROM_USER.test(prompt.slice(0, 500))) {
    return undefined;
  }
  const matched = PROMPT_HINTS.filter((hint) => hint.pattern.test(prompt));
  if (matched.length === 0) {
    return undefined;
  }
  const topics = new Set(matched.map((hint) => hint.topic));
  if (topics.has('UI') && topics.has('performance')) {
    matched.push(UI_PERFORMANCE_HINT);
  }
  const parts = matched
    .map((hint) => ({ ...hint, skills: hint.skills.filter((skill) => !loaded.has(skill)) }))
    .filter((hint) => hint.skills.length > 0)
    .map((hint) => `${hint.topic}: ${listSkills(hint.skills)}`);
  if (parts.length === 0) {
    return undefined;
  }
  return `Skill hint from this prompt's wording (${parts.join('; ')}). If the task touches Luau game ` +
    'code, load the ones that apply before planning it.';
}
