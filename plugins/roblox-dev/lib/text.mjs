// Small text helpers shared by the OpenCode adapter and the Luau rules.

// One spelling for a DataModel path: bracket-quoted segments become dotted ones and a leading
// "game" is dropped, so `game.A["B.spec"]` and `A.B.spec` compare equal. The whole place is "".
export function normalizePath(path) {
  if (typeof path !== 'string') {
    return '';
  }
  return path.trim().replace(/\[\s*(["'])(.*?)\1\s*\]/g, '.$2').replace(/^game(\.|$)/, '');
}

// All text inside a tool result, whatever shape it arrives in.
export function responseText(response) {
  if (typeof response === 'string') {
    return response;
  }
  const parts = [];
  const visit = (value) => {
    if (typeof value === 'string') {
      parts.push(value);
    } else if (Array.isArray(value)) {
      value.forEach(visit);
    } else if (value && typeof value === 'object') {
      if (typeof value.text === 'string') {
        parts.push(value.text);
      } else {
        Object.values(value).forEach(visit);
      }
    }
  };
  visit(response);
  return parts.join('\n');
}
