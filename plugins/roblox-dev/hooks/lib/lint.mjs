// The after-edit convention check, shared by the Claude Code hook and the OpenCode plugin.
// Reports new lines that break the mechanical comment and style conventions.

import { editText, lintLuau, newLines } from './luau.mjs';
import { isWatchedLuauFile } from './rojo.mjs';

const MAX_FINDINGS = 8;

// The new lines of a Luau file edit in a Rojo repo or pesde workspace, or undefined for any
// other file. A Write's old text comes from `response.originalFile` when it carries one.
export function fileEditLines(tool, args, response) {
  if (!isWatchedLuauFile(args.file_path)) {
    return undefined;
  }
  const { added, replaced } = editText(tool, args);
  const original = typeof response?.originalFile === 'string' ? response.originalFile : '';
  return newLines(added, tool === 'Write' ? original : replaced);
}

export function lintContext(target, lines) {
  const findings = lintLuau(lines);
  if (findings.length === 0) {
    return undefined;
  }
  const shown = findings.slice(0, MAX_FINDINGS).map((finding) => `- ${finding}`);
  if (findings.length > MAX_FINDINGS) {
    shown.push(`- and ${findings.length - MAX_FINDINGS} more`);
  }
  return `Luau convention check on the lines this edit added to ${target}:\n${shown.join('\n')}\n` +
    'Fix them with a follow-up edit, unless a finding is a false match (for example, text the user asked for verbatim).';
}

// The warning for a tool call that edited a Luau file, else undefined.
export function editLintContext(tool, args, response) {
  const lines = fileEditLines(tool, args, response);
  return lines && lintContext(args.file_path, lines);
}
