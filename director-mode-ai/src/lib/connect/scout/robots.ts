/**
 * robots.txt — pure parser + matcher (Google semantics: the most specific
 * user-agent group applies; within it the longest matching rule wins and
 * Allow wins a tie; `*` wildcards and `$` anchors are supported).
 */

export type RobotsRule = { allow: boolean; path: string };
export type RobotsPolicy = { rules: RobotsRule[]; crawlDelaySec: number | null };

export const BOT_TOKEN = 'clubmodebot';

export function parseRobots(txt: string, agent = BOT_TOKEN): RobotsPolicy {
  type Group = { agents: string[]; rules: RobotsRule[]; delay: number | null };
  const groups: Group[] = [];
  let cur: Group | null = null;
  let lastWasAgent = false;

  for (const raw of (txt || '').split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const i = line.indexOf(':');
    if (i < 0) continue;
    const key = line.slice(0, i).trim().toLowerCase();
    const val = line.slice(i + 1).trim();
    if (key === 'user-agent') {
      if (!cur || !lastWasAgent) {
        cur = { agents: [], rules: [], delay: null };
        groups.push(cur);
      }
      cur.agents.push(val.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!cur) continue;
    if (key === 'allow' || key === 'disallow') {
      // An empty Disallow means "allow everything" — no rule.
      if (val) cur.rules.push({ allow: key === 'allow', path: val });
    } else if (key === 'crawl-delay') {
      const n = Number(val);
      if (Number.isFinite(n) && n >= 0) cur.delay = n;
    }
  }

  const a = agent.toLowerCase();
  const specific = groups.filter((g) => g.agents.some((x) => x !== '*' && a.includes(x)));
  const chosen = specific.length ? specific : groups.filter((g) => g.agents.includes('*'));
  return {
    rules: chosen.flatMap((g) => g.rules),
    crawlDelaySec: chosen.reduce<number | null>((m, g) => (g.delay != null ? Math.max(m ?? 0, g.delay) : m), null),
  };
}

function ruleMatches(rulePath: string, path: string): boolean {
  const anchored = rulePath.endsWith('$');
  const body = anchored ? rulePath.slice(0, -1) : rulePath;
  const re = new RegExp(
    '^' + body.split('*').map((p) => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + (anchored ? '$' : ''),
  );
  return re.test(path);
}

/** Is `pathWithQuery` (e.g. "/jobs/?q=tennis") allowed under this policy? */
export function isAllowed(policy: RobotsPolicy, pathWithQuery: string): boolean {
  let best: RobotsRule | null = null;
  for (const r of policy.rules) {
    if (!ruleMatches(r.path, pathWithQuery)) continue;
    if (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.allow && !best.allow)) best = r;
  }
  return best ? best.allow : true;
}
