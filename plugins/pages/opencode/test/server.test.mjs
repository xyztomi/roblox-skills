// The pages OpenCode adapter keeps the page gate: new HTML pages need html-kit and the kit.

import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { createRuntime } from '../server.js';

const DIR = realpathSync(mkdtempSync(join(tmpdir(), 'opencode-pages-')));
after(() => rmSync(DIR, { recursive: true, force: true }));

function fakeContext(messages = []) {
  return {
    location: { directory: DIR },
    session: { context: async () => messages },
  };
}

const write = (sessionID, name, content) => ({
  tool: 'write',
  sessionID,
  id: 'call-1',
  input: { path: join(DIR, name), content },
});

test('denies a new page until html-kit is loaded', async () => {
  const runtime = createRuntime(fakeContext());
  await assert.rejects(runtime.gate(write('p1', 'plan.html', '<html><body>Plan</body></html>')), /html-kit/);
  runtime.handleEvent({ type: 'session.skill.activated', data: { sessionID: 'p1', id: 'html-kit' } });
  await assert.rejects(runtime.gate(write('p1', 'plan.html', '<html><body>Plan</body></html>')), /kit\/kit\.js/);
});

test('sees html-kit in the session messages', async () => {
  const messages = [{
    type: 'assistant',
    content: [{ type: 'tool', name: 'skill', state: { status: 'completed', input: { id: 'html-kit' } } }],
  }];
  const runtime = createRuntime(fakeContext(messages));
  await assert.rejects(runtime.gate(write('p2', 'plan.html', '<html><body>Plan</body></html>')), /kit\/kit\.js/);
});

test('accepts a page that loads the kit or opts out', async () => {
  const runtime = createRuntime(fakeContext());
  runtime.handleEvent({ type: 'session.skill.activated', data: { sessionID: 'p2', id: 'html-kit' } });
  assert.equal(await runtime.gate(write('p2', 'plan.html', '<script src="kit/kit.js"></script>')), undefined);
  assert.equal(await runtime.gate(write('p2', 'mock.html', '<html data-kit="off"></html>')), undefined);
});

test('leaves existing pages alone', async () => {
  const runtime = createRuntime(fakeContext());
  writeFileSync(join(DIR, 'old.html'), '<html></html>');
  assert.equal(await runtime.gate(write('p3', 'old.html', '<html></html>')), undefined);
});
