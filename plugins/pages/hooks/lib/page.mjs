// The page gate's content rules, shared by the Claude Code hook and the OpenCode plugin.

const HTML_FILE = /\.html?$/i;
const LOADS_KIT = /<script\b[^>]*\bsrc\s*=\s*["']?[^"'\s>]*kit\/kit\.js\b/i;
const OPTED_OUT = /<html\b[^>]*\bdata-kit\s*=\s*["']?off\b/i;
const SKILL_NAME = /^\/?(?:pages:)?html-kit$/;

export function isHtmlKitSkill(name) {
  return SKILL_NAME.test(String(name ?? ''));
}

// Problems with a new HTML page. `exists` is whether the path already exists (older pages pass).
// `skillLoaded` says whether the html-kit skill is loaded in this session.
export function pageProblems({ path, content, exists, skillLoaded }) {
  if (typeof path !== 'string' || typeof content !== 'string' || !HTML_FILE.test(path) || exists) {
    return [];
  }
  const problems = [];
  if (!skillLoaded) {
    problems.push('Load the `html-kit` skill with the skill tool first: it sets up the kit folder and lists the components.');
  }
  if (!LOADS_KIT.test(content) && !OPTED_OUT.test(content)) {
    problems.push(
      'New pages are written with the html-kit: start the file with the first line the skill gives, which loads ' +
      'kit/kit.js, and write the content as kit components. A page that has to be freeform (a game-UI mockup) ' +
      'adds data-kit="off" to its <html> tag instead.',
    );
  }
  return problems;
}
