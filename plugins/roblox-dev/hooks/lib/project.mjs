// The project root a hook's checks run in.

import { statSync } from 'node:fs';
import { resolve } from 'node:path';
import { findRojoProject } from './rojo.mjs';

export function isDirectory(path) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

// The project root the checks run in: the Rojo repo holding the session's folder, else that
// folder itself (a pesde workspace).
export function projectRoot(cwd) {
  if (typeof cwd !== 'string' || cwd === '' || !isDirectory(cwd)) {
    return undefined;
  }
  return findRojoProject(cwd)?.root ?? resolve(cwd);
}
