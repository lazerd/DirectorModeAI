// ---- Summer Flex League: division shape + shared standings math ----
//
// SINGLE SOURCE OF TRUTH for the /flex board. Both the page renderer and the
// playoff auto-generator import from here, so "who's in which flight", "is this
// flight finished", and "who finished first" can never drift between what the
// board shows and what the playoff generator seeds.

export type FlexStanding = { name: string; w: number; l: number; gf: number; ga: number };

/** A placement playoff fed by two finished flights: A#1 v B#1, A#2 v B#2, … */
export type FlexPlayoffCfg = {
  key: string;
  title: string;
  /** The two group titles (keys of `groups`) that feed this playoff. */
  from: [string, string];
  /** Dedicated round for these rows. Must be above every round-robin round. */
  round: number;
  /** Label for the trophy banner, e.g. "Challenger Champion". */
  crownTitle: string;
};

export type FlexDivisionCfg = {
  id: string;
  slug: string;
  name: string;
  num: string;
  color: string;
  accent: string;
  type: 'compass' | 'group';
  groups?: Record<string, string[]>;
  playoffs?: FlexPlayoffCfg[];
  /** Single-group divisions crown the round-robin winner outright. */
  crownTitle?: string;
  r1?: [string, string][];
};

export const td = (t: string[]) => t.join(' / ');

export const allPairs = (a: string[]): [string, string][] => {
  const r: [string, string][] = [];
  for (let i = 0; i < a.length; i++) for (let j = i + 1; j < a.length; j++) r.push([a[i], a[j]]);
  return r;
};

export const pairKey = (a: string, b: string) =>
  [a, b].map((s) => s.toLowerCase()).sort().join(' ~~ ');

export function parseGames(score: string): [number, number] {
  let ga = 0, gb = 0;
  for (const set of (score || '').split(/[,;]/)) {
    const m = set.trim().match(/^(\d+)\s*-\s*(\d+)/);
    if (m) { ga += +m[1]; gb += +m[2]; }
  }
  return [ga, gb];
}

/** Games-won percentage — the standard RR tiebreaker (see standings sort below). */
export const gamesPct = (s: { gf: number; ga: number }) => {
  const t = s.gf + s.ga;
  return t ? s.gf / t : 0;
};

type ScoredMatch = { a: string; b: string; score: string; winner_side: 'a' | 'b' | null; status: string };

/**
 * Standings for one flight. Tiebreak is GAMES-WON PERCENTAGE, not game
 * differential — differential unfairly rewards whoever simply played more
 * games. Differential is only the last-resort fallback.
 */
export function groupStandings(members: string[], matches: ScoredMatch[]): FlexStanding[] {
  const st = new Map<string, FlexStanding>(members.map((n) => [n, { name: n, w: 0, l: 0, gf: 0, ga: 0 }]));
  for (const mt of matches) {
    if (mt.status !== 'completed' || !mt.winner_side) continue;
    const [ga, gb] = parseGames(mt.score);
    const A = st.get(mt.a), B = st.get(mt.b);
    if (!A || !B) continue;
    A.gf += ga; A.ga += gb; B.gf += gb; B.ga += ga;
    if (mt.winner_side === 'a') { A.w++; B.l++; } else { B.w++; A.l++; }
  }
  return [...st.values()].sort(
    (x, y) => y.w - x.w || gamesPct(y) - gamesPct(x) || (y.gf - y.ga) - (x.gf - x.ga)
  );
}

/** A flight is finished when every one of its round-robin pairings is scored. */
export function isGroupComplete(members: string[], matches: ScoredMatch[]): boolean {
  const done = new Set(
    matches.filter((m) => m.status === 'completed').map((m) => pairKey(m.a, m.b))
  );
  const pairs = allPairs(members);
  return pairs.length > 0 && pairs.every(([a, b]) => done.has(pairKey(a, b)));
}

/**
 * Placement label for playoff slot i (1-based): slot 1 is the title match,
 * slot 2 plays for 3rd, slot 3 for 5th, and so on.
 */
export function placementLabel(slot: number, crownTitle: string): string {
  if (slot === 1) return `${crownTitle} — Final`;
  const place = slot * 2 - 1;
  const suffix = place === 3 ? 'rd' : 'th';
  return `${place}${suffix} place playoff`;
}

// Playoff rounds live far above every round-robin / compass round so the
// (event_id, bracket, round, slot) unique key makes generation idempotent and
// the rows can never collide with a real draw round.
const PO = (n: number) => 90 + n;

export const FLEX_CONFIG: FlexDivisionCfg[] = [
  {
    id: 'mens-singles', slug: 'mens-singles-flex-2026', name: "Men's Singles", num: '01',
    color: '#1B448C', accent: '#2052A8', type: 'compass',
    crownTitle: "Men's Singles Champion",
    r1: [['Harman Batra', 'Craig Sato'], ['Blair Schmicker', 'Walden Browne'], ['Darryl Rains', 'Simon Chan'], ['Justin White', 'Decio Shimura'], ['Abhijeet Kumar', 'Gabe Fett'], ['Alex Rogin', 'Dimitry Lerner'], ['Powell Jose', 'Oliver Gibbons'], ['Tony Helvey', 'Adam Branson']],
  },
  {
    id: 'womens-singles', slug: 'womens-singles-flex-2026', name: "Women's Singles", num: '02',
    color: '#E03313', accent: '#FF4A26', type: 'group',
    groups: {
      'Championship · Flight A': ['Jennifer Stern', 'Sarah Binder', 'Heather Young', 'Allison Weinstein'],
      'Championship · Flight B': ['Chelsea McClure', 'Shannon Moore', 'Katie Shogan', 'Karen Yoo'],
      'Challenger · Flight A': ['Vi Le', 'Laurie Coyle', 'Caedmon Patalano', 'Nancy Jiang'],
      'Challenger · Flight B': ['Jillian Helvey', 'Erica Desjardins', 'Julie Bryant', 'Megan Sullivan'],
    },
    playoffs: [
      { key: 'ws-championship', title: 'Championship Playoff', from: ['Championship · Flight A', 'Championship · Flight B'], round: PO(1), crownTitle: "Women's Singles Championship" },
      { key: 'ws-challenger', title: 'Challenger Playoff', from: ['Challenger · Flight A', 'Challenger · Flight B'], round: PO(2), crownTitle: "Women's Singles Challenger" },
    ],
  },
  {
    id: 'mens-doubles', slug: 'mens-doubles-flex-2026', name: "Men's Doubles", num: '03',
    color: '#0C7B8C', accent: '#109AAD', type: 'group',
    crownTitle: "Men's Doubles Champions",
    groups: {
      'Round Robin': [
        td(['Walden Browne', 'Simon Chan']), td(['Sinan Akay', 'Adam Branson']),
        td(['Gabe Fett', 'Oliver Gibbons']), td(['Craig Sato', 'Justin White']),
      ],
    },
  },
  {
    id: 'womens-doubles', slug: 'womens-doubles-flex-2026', name: "Women's Doubles", num: '04',
    color: '#B07D00', accent: '#F5B000', type: 'group',
    groups: {
      'Championship · Pool 1': [td(['Chitra Balasubramanian', 'Kersti Peter']), td(['Sarah Binder', 'Leena Elias']), td(['Yvette Girard', 'Dena McManis']), td(['Allison Weinstein', 'Jen Acker Parks'])],
      'Championship · Pool 2': [td(['Anne Schwaikert', 'Daralisa Kelley']), td(['Heather Young', 'Leah Branson']), td(['Robyn Rogin', 'Katie Shogan']), td(['Lauren Disston', 'Danielle Hawley'])],
      'Challenger · Pool 1': [td(['Erica Desjardins', 'Christina Gibbons']), td(['Vi Le', 'Jen Hill']), td(['Jessica Howard', 'Liz Lawrence'])],
      'Challenger · Pool 2': [td(['Julie Bryant', 'Jennifer Walker']), td(['Megan Sullivan', 'Kate Woodcox']), td(['Meghan Schmicker', 'Susie Hsu'])],
    },
    playoffs: [
      { key: 'wd-championship', title: 'Championship Playoff', from: ['Championship · Pool 1', 'Championship · Pool 2'], round: PO(1), crownTitle: "Women's Doubles Championship" },
      { key: 'wd-challenger', title: 'Challenger Playoff', from: ['Challenger · Pool 1', 'Challenger · Pool 2'], round: PO(2), crownTitle: "Women's Doubles Challenger" },
    ],
  },
];

export const FLEX_SLUGS = new Set(FLEX_CONFIG.map((d) => d.slug));
export const flexDivisionBySlug = (slug: string) => FLEX_CONFIG.find((d) => d.slug === slug);
