// The OpenCode server plugin for pages. It registers the html-kit skill and keeps the page gate:
// a new HTML page is denied until html-kit is loaded and the page loads the kit or opts out.

import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pageProblems } from '../hooks/lib/page.mjs';
import { registerSkills } from './skills.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILLS = resolve(HERE, '../skills');
const MAX_DENIAL_STREAK = 3;

class GateError extends Error {}

function warning(message) {
  process.stderr.write(`pages plugin: ${message}\n`);
}

// Skills loaded since the last compaction, from the session's messages. Mirrors the roblox-dev
// adapter: the durable Skill tool call is the reliable record.
function loadedFromContext(messages) {
  const loaded = new Set();
  let start = 0;
  for (let index = 0; index < messages.length; index += 1) {
    if (messages[index]?.type === 'compaction') {
      start = index + 1;
    }
  }
  for (const message of messages.slice(start)) {
    if (message?.type === 'skill' && typeof message.skill === 'string') {
      loaded.add(message.skill);
    }
    if (message?.type === 'assistant' && Array.isArray(message.content)) {
      for (const part of message.content) {
        if (part?.type === 'tool' && part.name === 'skill' && part.state?.status === 'completed') {
          const id = part.state.input?.id;
          if (typeof id === 'string') {
            loaded.add(id);
          }
        }
      }
    }
  }
  return loaded;
}

export function createRuntime(ctx) {
  const loaded = new Map();
  const streaks = new Map();
  const locations = new Map();
  const stateFor = (sessionID) => {
    if (!loaded.has(sessionID)) {
      loaded.set(sessionID, new Set());
    }
    return loaded.get(sessionID);
  };
  const hasSkill = async (sessionID) => {
    const skills = new Set(stateFor(sessionID));
    try {
      for (const skill of loadedFromContext(await ctx.session.context({ sessionID }))) {
        skills.add(skill);
      }
    } catch (error) {
      warning(`could not read the session's loaded skills: ${error?.message ?? error}`);
    }
    return skills.has('html-kit');
  };

  return {
    async gate(event) {
      try {
        if (event.tool !== 'write') {
          return;
        }
        const input = event.input ?? {};
        if (typeof input.path !== 'string' || typeof input.content !== 'string') {
          return;
        }
        const base = locations.get(event.sessionID) ?? ctx.location?.directory ?? process.cwd();
        const path = resolve(base, input.path);
        const problems = pageProblems({
          path,
          content: input.content,
          exists: existsSync(path),
          skillLoaded: await hasSkill(event.sessionID),
        });
        const streak = streaks.get(event.sessionID) ?? 0;
        if (problems.length === 0 || streak >= MAX_DENIAL_STREAK) {
          streaks.set(event.sessionID, 0);
          return;
        }
        streaks.set(event.sessionID, streak + 1);
        throw new GateError(`${problems.join(' ')} Then retry this write.`);
      } catch (error) {
        if (error instanceof GateError) {
          throw error;
        }
        warning(`page gate skipped: ${error?.message ?? error}`);
      }
    },
    handleEvent(event) {
      try {
        if (event.type === 'session.created' && typeof event.data.location?.directory === 'string') {
          locations.set(event.data.sessionID, event.data.location.directory);
        } else if (event.type === 'session.skill.activated') {
          stateFor(event.data.sessionID).add(event.data.id);
        } else if (event.type === 'session.compaction.started') {
          stateFor(event.data.sessionID).clear();
        } else if (event.type === 'session.deleted') {
          loaded.delete(event.data.sessionID);
          streaks.delete(event.data.sessionID);
          locations.delete(event.data.sessionID);
        }
      } catch (error) {
        warning(`event handling skipped: ${error?.message ?? error}`);
      }
    },
  };
}

export async function setup(ctx) {
  const runtime = createRuntime(ctx);
  await registerSkills(ctx, SKILLS);
  await ctx.tool.hook('execute.before', runtime.gate);

  const controller = new AbortController();
  void (async () => {
    try {
      for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
        runtime.handleEvent(event);
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
  id: 'pages',
  setup,
};
