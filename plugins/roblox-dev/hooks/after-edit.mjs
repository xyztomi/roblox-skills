// PostToolUse on Luau file edits in a Rojo repo or pesde workspace: reports new lines that break
// the mechanical comment and style conventions back to the model as context. It never blocks,
// since the edit already landed.

import { FILE_EDIT_TOOLS, runHook } from './lib/hook-io.mjs';
import { editLintContext } from './lib/lint.mjs';

runHook((input) => {
  if (!FILE_EDIT_TOOLS.has(input.tool_name)) {
    return undefined;
  }
  const context = editLintContext(input.tool_name, input.tool_input ?? {}, input.tool_response);
  return context ? { hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: context } } : undefined;
});
