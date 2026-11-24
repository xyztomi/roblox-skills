// The OpenCode server plugin for roblox-dev. It registers the plugin's skills and reproduces the
// Claude Code hooks: the skill gate, the after-edit convention check, skill hints, and the verify
// gate that runs luau-lsp, selene, and stylua before a turn ends.
//
// Every handler fails open. The only errors that reach the model are the gate denials, which are
// deliberate.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { responseText } from '../hooks/lib/hook-io.mjs';
import { editLintContext } from '../hooks/lib/lint.mjs';
import { projectRoot } from '../hooks/lib/project.mjs';
import { filesInRoot, findTool, runChecks } from '../hooks/lib/verify.mjs';
import { editedFiles, isEditTool, listSkills, normalizedEdits, promptHint, readHint, requiredForEdits } from './edits.mjs';
import { registerSkills } from './skills.mjs';
import { collectEditedFiles, createStore, handleEvent, skillsFromContext, verifyMessage } from './state.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILLS = resolve(HERE, '../skills');
const MAX_DENIAL_STREAK = 3;
const TOOLS = ['luau-lsp', 'selene', 'stylua'];

class GateError extends Error {}

function gate(reason) {
  return new GateError(reason);
}

function appendText(result, text) {
  if (result === undefined || result === null) {
    return { content: [{ type: 'text', text }] };
  }
  if (typeof result.content === 'string') {
    return { ...result, content: `${result.content}\n\n${text}` };
  }
  return { ...result, content: [...(result.content ?? []), { type: 'text', text }] };
}

function warning(message) {
  process.stderr.write(`roblox-dev plugin: ${message}\n`);
}

// Loaded skills from the session's messages, plus the event stream's view. The messages are the
// durable record, so an edit that follows a Skill tool call sees it even when the event is late.
async function loadedSkills(ctx, store, sessionID) {
  const loaded = new Set(store.get(sessionID).loaded);
  try {
    for (const skill of skillsFromContext(await ctx.session.context({ sessionID }))) {
      loaded.add(skill);
    }
  } catch (error) {
    warning(`could not read the session's loaded skills: ${error?.message ?? error}`);
  }
  return loaded;
}

// The original text of a file about to be written, so the after-edit check can tell new lines
// from lines the write carried along.
function storeOriginal(originals, event, base) {
  if (event.tool !== 'write' || typeof event.input?.path !== 'string') {
    return;
  }
  try {
    originals.set(event.id, readFileSync(resolve(base, event.input.path), 'utf8'));
  } catch {
    originals.set(event.id, '');
  }
}

function toolBefore(ctx, store, originals, fallback) {
  return async (event) => {
    try {
      if (!isEditTool(event.tool)) {
        return;
      }
      const base = store.locations.get(event.sessionID) ?? fallback;
      storeOriginal(originals, event, base);
      const check = requiredForEdits(event.tool, event.input ?? {}, base);
      if (check === undefined) {
        return;
      }
      const state = store.get(event.sessionID);
      if (check.denyReason) {
        throw gate(check.denyReason);
      }
      const loaded = await loadedSkills(ctx, store, event.sessionID);
      const missing = [...check.required].filter(([skill]) => !loaded.has(skill));
      if (missing.length === 0 || state.streak >= MAX_DENIAL_STREAK) {
        state.streak = 0;
        return;
      }
      state.streak += 1;
      const reasons = missing.map(([skill, reason]) => `\`${skill}\` because ${reason}`).join('; ');
      throw gate(
        `Load ${listSkills(missing.map(([skill]) => skill))} with the skill tool, then retry this edit unchanged. ` +
        `Needed: ${reasons}.`,
      );
    } catch (error) {
      if (error instanceof GateError) {
        throw error;
      }
      warning(`skill gate skipped: ${error?.message ?? error}`);
    }
  };
}

function toolAfter(ctx, store, originals, fallback) {
  return async (event) => {
    try {
      if (event.status !== 'completed') {
        return;
      }
      const base = store.locations.get(event.sessionID) ?? fallback;
      if (isEditTool(event.tool)) {
        const state = store.get(event.sessionID);
        for (const file of editedFiles(event.tool, event.input ?? {}, base)) {
          state.edits.add(file);
        }
        const original = originals.get(event.id);
        originals.delete(event.id);
        const warnings = normalizedEdits(event.tool, event.input ?? {}, base)
          .map((edit) => editLintContext(edit.tool, edit.args, { originalFile: original }))
          .filter(Boolean);
        if (warnings.length > 0) {
          event.result = appendText(event.result, warnings.join('\n\n'));
        }
        return;
      }
      if (event.tool === 'read') {
        const loaded = await loadedSkills(ctx, store, event.sessionID);
        const hint = readHint(event.input ?? {}, responseText(event.result), loaded, base);
        if (hint !== undefined) {
          event.result = appendText(event.result, hint);
        }
      }
    } catch (error) {
      warning(`after-edit skipped: ${error?.message ?? error}`);
    }
  };
}

function sessionPrompt(store) {
  return (event) => {
    try {
      const state = store.get(event.sessionID);
      const hint = promptHint(event.prompt?.text, state.loaded);
      if (hint !== undefined) {
        state.pending.push(hint);
      }
    } catch (error) {
      warning(`skill hint skipped: ${error?.message ?? error}`);
    }
  };
}

function sessionContext(store) {
  return (event) => {
    try {
      const state = store.get(event.sessionID);
      if (state.pending.length === 0) {
        return;
      }
      const text = state.pending.join('\n\n');
      state.pending = [];
      event.system.push({ type: 'text', text });
    } catch (error) {
      warning(`skill hint injection skipped: ${error?.message ?? error}`);
    }
  };
}

function sessionIdle(ctx, store) {
  return async (event) => {
    try {
      const { sessionID, background = [] } = event;
      if (store.parents.has(sessionID) || background.some((item) => item.kind === 'subagent')) {
        return;
      }
      const state = store.get(sessionID);
      if (state.verifyBlocked) {
        return;
      }
      let directory = store.locations.get(sessionID) ?? ctx.location?.directory;
      try {
        const session = await ctx.session.get({ sessionID });
        directory = session.location?.directory ?? directory;
      } catch (error) {
        warning(`could not read the session folder: ${error?.message ?? error}`);
      }
      const root = projectRoot(directory);
      if (root === undefined) {
        return;
      }
      const files = filesInRoot(root, collectEditedFiles(store, sessionID));
      if (files.length === 0) {
        return;
      }
      const tools = Object.fromEntries(TOOLS.map((name) => [name, findTool(name)]));
      const { findings, notes } = runChecks({ root, files, tools });
      if (findings.length === 0) {
        if (notes.length > 0) {
          warning(`verify-gate:\n${notes.map((note) => `- ${note}`).join('\n')}`);
        }
        return;
      }
      state.verifyBlocked = true;
      await ctx.session.synthetic({ sessionID, text: verifyMessage(findings, notes) });
    } catch (error) {
      warning(`verify gate skipped: ${error?.message ?? error}`);
    }
  };
}

export function createRuntime(ctx) {
  const store = createStore();
  const originals = new Map();
  const base = ctx.location?.directory ?? process.cwd();
  return {
    store,
    before: toolBefore(ctx, store, originals, base),
    after: toolAfter(ctx, store, originals, base),
    prompt: sessionPrompt(store),
    context: sessionContext(store),
    idle: sessionIdle(ctx, store),
    handleEvent: (event) => handleEvent(store, event),
  };
}

export async function setup(ctx) {
  const runtime = createRuntime(ctx);

  await registerSkills(ctx, SKILLS);
  await ctx.tool.hook('execute.before', runtime.before);
  await ctx.tool.hook('execute.after', runtime.after);
  await ctx.session.hook('prompt', runtime.prompt);
  await ctx.session.hook('context', runtime.context);
  await ctx.session.hook('experimental.idle', runtime.idle);

  const controller = new AbortController();
  void (async () => {
    try {
      for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
        try {
          runtime.handleEvent(event);
        } catch (error) {
          warning(`event handling skipped: ${error?.message ?? error}`);
        }
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        warning(`event stream stopped: ${error?.message ?? error}`);
      }
    }
  })();

  return () => controller.abort();
}

export default {
  id: 'roblox-dev',
  setup,
};
