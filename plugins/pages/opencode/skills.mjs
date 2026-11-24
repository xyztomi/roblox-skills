// Registers this plugin's SKILL.md files with OpenCode. The skill files stay in `skills/`, one
// source shared with the Claude Code plugin, and OpenCode discovers them through this transform.

import { readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

function unquote(value) {
  const match = /^(['"])([\s\S]*)\1$/.exec(value);
  return match ? match[2] : value;
}

// The frontmatter fields OpenCode uses, plus the body without the frontmatter block.
export function parseSkill(text, path) {
  const block = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  const meta = block ? block[1] : '';
  const fields = {};
  let key;
  for (const line of meta.split(/\r?\n/)) {
    const pair = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
    if (pair) {
      key = pair[1];
      fields[key] = pair[2].trim();
    } else if (key && /^\s+\S/.test(line)) {
      fields[key] = `${fields[key]} ${line.trim()}`.trim();
    }
  }
  return {
    id: basename(dirname(path)),
    name: unquote(fields.name ?? ''),
    description: unquote(fields.description ?? ''),
    path,
    content: block ? text.slice(block[0].length) : text,
  };
}

export function discoverSkills(root) {
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .flatMap((entry) => {
      const path = join(root, entry.name, 'SKILL.md');
      try {
        return [parseSkill(readFileSync(path, 'utf8'), path)];
      } catch {
        return [];
      }
    })
    .filter((skill) => skill.description !== '');
}

export function registerSkills(ctx, root) {
  const skills = discoverSkills(root);
  return ctx.skill.transform((editor) => {
    for (const skill of skills) {
      // A user or project source with the same ID wins; skip it rather than shadow it.
      if (editor.get(skill.id)) {
        continue;
      }
      editor.add({
        id: skill.id,
        name: skill.name === '' ? skill.id : skill.name,
        description: skill.description,
        path: skill.path,
        content: skill.content,
      });
    }
  });
}
