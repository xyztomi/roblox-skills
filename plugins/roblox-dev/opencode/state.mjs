// Session state for the OpenCode plugin: loaded skills, edited Luau files, and the skill hints
// waiting for the next model request.

const BLOCK_HEADING = 'Luau checks before this turn ends:';

export function createStore() {
  const sessions = new Map();
  const parents = new Map();
  const locations = new Map();

  const get = (id) => {
    let state = sessions.get(id);
    if (state === undefined) {
      state = {
        loaded: new Set(),
        beforeCompaction: new Set(),
        pending: [],
        edits: new Set(),
        streak: 0,
        verifyBlocked: false,
      };
      sessions.set(id, state);
    }
    return state;
  };

  return { sessions, parents, locations, get };
}

// Updates state from one server event. Values are kept in memory for this plugin runtime, which
// is the same lifetime a skill load and a turn live in.
export function handleEvent(store, event) {
  const { type, data } = event;
  switch (type) {
    case 'session.created':
      if (typeof data.parentID === 'string') {
        store.parents.set(data.sessionID, data.parentID);
      }
      if (typeof data.location?.directory === 'string') {
        store.locations.set(data.sessionID, data.location.directory);
      }
      break;
    case 'session.skill.activated':
      store.get(data.sessionID).loaded.add(data.id);
      break;
    case 'session.compaction.started': {
      const state = store.get(data.sessionID);
      state.beforeCompaction = new Set(state.loaded);
      state.loaded.clear();
      break;
    }
    case 'session.compaction.ended': {
      const state = store.get(data.sessionID);
      if (state.beforeCompaction.size > 0) {
        state.pending.push(
          `Compaction cut short or dropped these skills that were loaded before it: ` +
          `${[...state.beforeCompaction].map((skill) => `\`${skill}\``).join(', ')}. ` +
          'Reload the ones the remaining work needs with the skill tool; the skill gate treats them as not loaded.',
        );
      }
      state.beforeCompaction.clear();
      break;
    }
    case 'session.execution.started': {
      const state = store.get(data.sessionID);
      state.edits.clear();
      state.verifyBlocked = false;
      break;
    }
    case 'session.deleted':
      store.sessions.delete(data.sessionID);
      store.parents.delete(data.sessionID);
      store.locations.delete(data.sessionID);
      for (const [child, parent] of store.parents) {
        if (parent === data.sessionID) {
          store.parents.delete(child);
        }
      }
      break;
    default:
      break;
  }
}

// Every session ID at or below `id`, including `id`.
export function descendants(store, id) {
  const found = new Set([id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const [child, parent] of store.parents) {
      if (found.has(parent) && !found.has(child)) {
        found.add(child);
        changed = true;
      }
    }
  }
  return found;
}

// Skills the session has loaded since the last compaction, read from its messages. The Skill
// messages are durable, so this is authoritative even when an event arrives after the next edit.
export function skillsFromContext(messages) {
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
    if (message?.type === 'user' && Array.isArray(message.skills)) {
      for (const skill of message.skills) {
        if (typeof skill?.id === 'string') {
          loaded.add(skill.id);
        }
      }
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

// The Luau files edited in this turn by the session and its subagents.
export function collectEditedFiles(store, sessionID) {
  const files = new Set();
  for (const id of descendants(store, sessionID)) {
    const state = store.get(id);
    for (const file of state.edits) {
      files.add(file);
    }
  }
  return [...files];
}

export function heading() {
  return BLOCK_HEADING;
}

// The message that continues the turn with the checks' findings.
export function verifyMessage(findings, notes) {
  const sections = findings.map((finding) => `${finding.tool}:\n${finding.lines.join('\n')}`);
  const skipped = notes.length > 0 ? `\n\nSkipped checks:\n${notes.map((note) => `- ${note}`).join('\n')}` : '';
  return `${BLOCK_HEADING}\n\n${sections.join('\n\n')}\n\n` +
    'Fix these in the files you edited, then finish. If a finding is a false match or lies outside this task, ' +
    `say so in your reply instead; the next stop goes through.${skipped}`;
}
