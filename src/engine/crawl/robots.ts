interface Rule {
  path: string;
  allow: boolean;
}
/** URI comparison preserves escaped reserved characters and decodes escaped unreserved bytes. */
function normalized(value: string) {
  return value.replace(/%[\da-f]{2}|[^\x00-\x7f]/giu, (part) => {
    if (!part.startsWith('%')) return encodeURIComponent(part);
    const character = String.fromCharCode(parseInt(part.slice(1), 16));
    return /^[\w.~-]$/.test(character) ? character : part.toUpperCase();
  });
}
function matches(pattern: string, path: string, budget: { left: number }) {
  const anchored = pattern.endsWith('$');
  if (anchored) pattern = pattern.slice(0, -1);
  let at = 0,
    position = 0,
    star = -1,
    retry = 0;
  while (position < path.length) {
    if (--budget.left < 0) throw new Error('Robots matching exceeded its work limit.');
    if (at === pattern.length && !anchored) return true;
    if (pattern[at] === '*') {
      star = at++;
      retry = position;
    } else if (pattern[at] === path[position]) {
      at++;
      position++;
    } else if (star >= 0) {
      at = star + 1;
      position = ++retry;
    } else return false;
  }
  while (pattern[at] === '*') at++;
  return at === pattern.length;
}
export function robotsPolicy(text: string) {
  if (text.length > 512 * 1024) throw new Error('Robots policy exceeds 512 KiB.');
  const groups: { agents: string[]; rules: Rule[] }[] = [];
  let group: (typeof groups)[number] | undefined;
  for (const line of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const entry = /^\s*([^:#]+)\s*:\s*([^#]*)/.exec(line);
    if (!entry) continue;
    const key = entry[1]!.trim().toLowerCase(),
      value = entry[2]!.trim();
    if (key === 'user-agent') {
      if (!group || group.rules.length) {
        group = { agents: [], rules: [] };
        groups.push(group);
      }
      group.agents.push(value.toLowerCase());
    } else if (group && (key === 'allow' || key === 'disallow') && value.startsWith('/')) {
      if (value.length > 2048) throw new Error('A robots rule exceeds its path limit.');
      group.rules.push({ path: normalized(value), allow: key === 'allow' });
    }
    if (
      groups.length > 1000 ||
      groups.reduce((sum, item) => sum + item.rules.length + item.agents.length, 0) > 4096
    )
      throw new Error('Robots policy exceeds its rule limit.');
  }
  const exact = groups.filter((item) => item.agents.includes('flux'));
  const rules = (exact.length ? exact : groups.filter((item) => item.agents.includes('*'))).flatMap(
    (item) => item.rules,
  );
  return (input: string) => {
    const path = normalized(input),
      budget = { left: 200000 };
    let best = -1,
      allowed = true;
    for (const rule of rules) {
      const specificity = rule.path.replace(/\*/g, '').replace(/\$$/, '').length;
      if (specificity < best || !matches(rule.path, path, budget)) continue;
      if (specificity > best || rule.allow) {
        best = specificity;
        allowed = rule.allow;
      }
    }
    return allowed;
  };
}
