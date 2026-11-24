// The OpenCode adapter keeps the Claude Code hooks' decisions. These tests drive its handlers
// with the same fake repo shape: a project file, a watched Luau script, and session state.

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { normalizedEdits } from '../edits.mjs';
import { createRuntime, setup } from '../server.js';

const DIR = realpathSync(mkdtempSync(join(tmpdir(), 'opencode-roblox-dev-')));
const REPO = join(DIR, 'game');
const SHOP = join(REPO, 'src/ServerScriptService/Shop.server.luau');
mkdirSync(join(REPO, 'src/ServerScriptService'), { recursive: true });
writeFileSync(join(REPO, 'default.project.json'), JSON.stringify({
  tree: { ServerScriptService: { $path: 'src/ServerScriptService' } },
}));
writeFileSync(SHOP, 'local x = 1\n');
after(() => rmSync(DIR, { recursive: true, force: true }));

function fakeContext(messages = []) {
  const skills = [];
  const hooks = { tool: {}, session: {} };
  return {
    skills,
    hooks,
    location: { directory: REPO },
    skill: {
      transform: async (callback) => callback({
        get: (id) => skills.find((skill) => skill.id === id),
        add: (skill) => skills.push(skill),
      }),
    },
    tool: { hook: async (name, handler) => { hooks.tool[name] = handler; } },
    session: {
      hook: async (name, handler) => { hooks.session[name] = handler; },
      context: async () => messages,
      synthetic: async () => {},
    },
    event: { subscribe: async function* () {} },
  };
}

const edit = (sessionID, input) => ({ tool: 'edit', sessionID, id: 'call-1', input });
const skillMessage = (id) => ({
  type: 'assistant',
  content: [{ type: 'tool', name: 'skill', state: { status: 'completed', input: { id } } }],
});

test('registers every skill with its description', async () => {
  const ctx = fakeContext();
  const cleanup = await setup(ctx);
  cleanup();
  assert.equal(ctx.skills.length, 13);
  for (const skill of ctx.skills) {
    assert.equal(typeof skill.description, 'string');
    assert.ok(skill.description.length > 0, skill.id);
    assert.ok(!skill.content.startsWith('---'), skill.id);
  }
  assert.ok(ctx.skills.some((skill) => skill.id === 'vide'));
});

test('denies a Luau edit until its skills are loaded', async () => {
  const runtime = createRuntime(fakeContext());
  const input = { path: SHOP, oldString: 'local x = 1', newString: 'local x = 1\nlocal y = 2' };
  await assert.rejects(runtime.before(edit('s1', input)), /Load `luau-style-guide` and `code-comments`/);

  for (const id of ['luau-style-guide', 'code-comments']) {
    runtime.handleEvent({ type: 'session.skill.activated', data: { sessionID: 's1', id } });
  }
  assert.equal(await runtime.before(edit('s1', input)), undefined);
});

test('reads loaded skills from the session messages', async () => {
  const ctx = fakeContext([skillMessage('luau-style-guide'), skillMessage('code-comments')]);
  const runtime = createRuntime(ctx);
  const input = { path: SHOP, oldString: 'local x = 1', newString: 'local x = 1\nlocal y = 2' };
  assert.equal(await runtime.before(edit('s6', input)), undefined);

  // A compaction message drops everything before it.
  const compacted = fakeContext([skillMessage('luau-style-guide'), { type: 'compaction' }]);
  await assert.rejects(
    createRuntime(compacted).before(edit('s7', input)),
    /Load `luau-style-guide` and `code-comments`/,
  );
});

test('requires the Vide skills for a Vide edit', async () => {
  const runtime = createRuntime(fakeContext());
  for (const id of ['luau-style-guide', 'code-comments']) {
    runtime.handleEvent({ type: 'session.skill.activated', data: { sessionID: 's2', id } });
  }
  const input = {
    path: SHOP,
    oldString: '',
    newString: 'local Vide = require(game.ReplicatedStorage.Packages.Vide)\nVide.create("Frame") {}',
  };
  await assert.rejects(runtime.before(edit('s2', input)), /`vide`/);
  runtime.handleEvent({ type: 'session.skill.activated', data: { sessionID: 's2', id: 'vide' } });
  await assert.rejects(runtime.before(edit('s2', input)), /`vide-ui-labs`/);
});

test('denies edits to installed packages', async () => {
  const runtime = createRuntime(fakeContext());
  const file = join(REPO, 'roblox_packages', 'some-package', 'init.luau');
  await assert.rejects(
    runtime.before(edit('s3', { path: file, oldString: '', newString: 'return {}' })),
    /Installed packages are generated/,
  );
});

test('reports new convention problems after an edit', async () => {
  const runtime = createRuntime(fakeContext());
  const event = {
    tool: 'edit',
    sessionID: 's4',
    id: 'call-2',
    status: 'completed',
    input: { path: SHOP, oldString: 'local x = 1', newString: 'local x = 1\n-- a -- b' },
    result: { content: [{ type: 'text', text: 'ok' }] },
  };
  await runtime.after(event);
  assert.match(event.result.content.at(-1).text, /used as a dash/);
});

test('injects a skill hint before the next model request', () => {
  const runtime = createRuntime(fakeContext());
  runtime.prompt({ sessionID: 's5', prompt: { text: 'Build a HUD menu' } });
  const context = { sessionID: 's5', system: [] };
  runtime.context(context);
  assert.match(context.system[0].text, /Skill hint from this prompt's wording/);
  assert.match(context.system[0].text, /`game-ui-design`/);
});

test('reads a patch as one write per file', () => {
  const edits = normalizedEdits('patch', {
    patchText: [
      '*** Begin Patch',
      '*** Update File: src/ServerScriptService/Shop.server.luau',
      '@@',
      '-local x = 1',
      '+local x = 2',
      '*** End Patch',
    ].join('\n'),
  }, REPO);
  assert.equal(edits.length, 1);
  assert.equal(edits[0].tool, 'Write');
  assert.equal(edits[0].args.file_path, join(REPO, 'src/ServerScriptService/Shop.server.luau'));
  assert.match(edits[0].args.content, /local x = 2/);
});
