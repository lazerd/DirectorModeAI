/**
 * Scout — pure text helpers (no I/O). HTML → text, entity decoding, the
 * cross-source fingerprint, US state normalization and a tiny RSS reader.
 */

const NAMED: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—',
  rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', hellip: '…', bull: '•', middot: '·',
  eacute: 'é', egrave: 'è', aacute: 'á', ntilde: 'ñ', copy: '©', reg: '®', trade: '™',
};

/** Decode HTML entities (named subset + all numeric). Run twice for double-escaped feeds. */
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code: string) => {
    if (code[0] === '#') {
      const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    }
    const v = NAMED[code.toLowerCase()];
    return v ?? m;
  });
}

/**
 * Strip HTML to readable text: drops script/style/nav chrome, keeps line
 * breaks at block elements, decodes entities, collapses whitespace.
 */
export function htmlToText(html: string): string {
  if (!html) return '';
  let s = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|template|iframe|head)\b[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '\n• ')
    .replace(/<\/?(p|div|li|ul|ol|tr|h[1-6]|section|article|header|footer|table|blockquote|dd|dt)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  s = decodeEntities(s);
  return s
    .replace(/\r/g, '')
    .replace(/[ \t\f\v ]+/g, ' ')
    .split('\n')
    .map((l) => l.trim())
    .filter((l, i, a) => l || (i > 0 && a[i - 1]))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Every absolute href on a page (deduped), resolved against `base`. */
export function linksIn(html: string, base: string): string[] {
  const out = new Set<string>();
  for (const m of html.matchAll(/href\s*=\s*["']([^"'#]+)["']/gi)) {
    try {
      const u = new URL(decodeEntities(m[1]), base);
      if (u.protocol === 'http:' || u.protocol === 'https:') out.add(u.toString());
    } catch {
      /* skip */
    }
  }
  return [...out];
}

const STOP = new Set(['the', 'of', 'and', 'a', 'an', 'at', 'for', 'inc', 'incorporated', 'llc', 'corp', 'corporation', 'co', 'company', 'ltd']);

/** Lowercase, & → and, strip punctuation and filler words. */
export function normalizeName(s: string | null | undefined): string {
  return (s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !STOP.has(w))
    .join(' ');
}

/**
 * Dedupe key across sources: club | title | state. Title words are sorted so
 * "Tennis Director" and "Director of Tennis" collide; racquet/racquets and
 * racket spellings fold together.
 */
export function fingerprint(club: string | null | undefined, title: string | null | undefined, state: string | null | undefined): string {
  const fold = (w: string) => w.replace(/^rackets?$|^racquets?$/, 'racquet').replace(/^pro$/, 'professional');
  const t = normalizeName(title).split(' ').filter(Boolean).map(fold).sort().join(' ');
  // Club: drop parentheticals and spaces so "Wakit Rakit" = "Wak it Rak it (Premier Sport)".
  const c = normalizeName((club || '').replace(/\([^)]*\)/g, ' '))
    .replace(/\bcountry club\b/g, 'cc')
    .replace(/\bgolf and cc\b/g, 'gcc')
    .replace(/\s+/g, '');
  return `${c}|${t}|${(state || '').trim().toUpperCase()}`;
}

export const US_STATES: Record<string, string> = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut',
  DE: 'Delaware', DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois',
  IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland',
  MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana',
  NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York',
  NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania',
  RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah',
  VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
};
const BY_NAME = new Map(Object.entries(US_STATES).map(([k, v]) => [v.toLowerCase(), k]));
BY_NAME.set('washington dc', 'DC');
BY_NAME.set('washington d c', 'DC');

/** "Kentucky" / "ky" / "KY " → "KY"; anything not a US state → null. */
export function toStateCode(s: string | null | undefined): string | null {
  const t = (s || '').trim().replace(/\./g, '');
  if (!t) return null;
  if (t.length === 2 && US_STATES[t.toUpperCase()]) return t.toUpperCase();
  return BY_NAME.get(t.toLowerCase().replace(/\s+/g, ' ')) ?? null;
}

/** "Tyler, TX" / "Rye, New York, USA" → { city, state }. */
export function parseLocation(s: string | null | undefined): { city: string | null; state: string | null } {
  const parts = (s || '').split(',').map((p) => p.trim()).filter(Boolean).filter((p) => !/^(usa|us|united states)$/i.test(p));
  for (let i = parts.length - 1; i >= 0; i--) {
    const bare = parts[i].replace(/\s+\d{5}(-\d{4})?$/, '');
    const st = toStateCode(bare);
    if (st) return { city: i > 0 ? parts[i - 1] : null, state: st };
  }
  return { city: parts[0] ?? null, state: null };
}

export type RssItem = { title: string; link: string; description: string; pubDate: string | null; guid: string | null };

/** Minimal RSS 2.0 item reader (title/link/description/pubDate/guid). */
export function parseRss(xml: string): RssItem[] {
  const out: RssItem[] = [];
  const tag = (block: string, name: string) => {
    const m = block.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, 'i'));
    if (!m) return null;
    return m[1].replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, '$1').trim();
  };
  for (const m of xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)) {
    const b = m[1];
    const link = decodeEntities(tag(b, 'link') || '');
    if (!link) continue;
    out.push({
      title: decodeEntities(decodeEntities(tag(b, 'title') || '')),
      link,
      description: decodeEntities(tag(b, 'description') || ''),
      pubDate: tag(b, 'pubDate'),
      guid: tag(b, 'guid'),
    });
  }
  return out;
}

/** Date-ish string → YYYY-MM-DD, or null. */
export function toIsoDate(s: string | null | undefined): string | null {
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s.trim())) return s.trim();
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

/**
 * Cheap title pre-filter before spending a model call: racquet-sport roles
 * that could be leadership/pro jobs at a club; not college coaching, camps,
 * front desk, maintenance or league ambassadors.
 */
export function looksLikeRacquetsRole(title: string): boolean {
  const t = title.toLowerCase();
  const sport = /tennis|racquet|racket|pickle|padel|paddle|platform|squash|court sports/.test(t);
  if (!sport && !/director of sport|sports director/.test(t)) return false;
  if (/ambassador|counselor|counsellor|front desk|maintenance|intern\b|internship|volunteer|stringer|ball ?machine|camp staff|lifeguard/.test(t)) return false;
  // College / school coaching — different market.
  if (/\b(men'?s|women'?s|mens|womens)\b.*coach|coach.*\b(men'?s|women'?s)\b|university|college|\bncaa\b|adjunct|high school|\bhs\b|graduate assistant|\bay\d/.test(t)) return false;
  return true;
}
