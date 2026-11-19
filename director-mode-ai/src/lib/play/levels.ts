/**
 * Levels, per sport, in the scale players already use:
 *   tennis      NTRP 2.0–6.0 (halves)            "3.5", "3.5–4.0", "4.0+"
 *   pickleball  DUPR 2.0–7.0 (quarters common)   "3.75 DUPR", "4.0+ DUPR"
 *   padel       Playtomic 0–7 (halves)           "Playtomic 3", "intermediate"
 *
 * A game has a range (min/max, either may be open). A player has one number.
 * Nothing here blocks anyone: it sorts, filters and labels.
 */
export type LevelSport = 'tennis' | 'pickleball' | 'padel';

export const LEVEL_SCALE: Record<LevelSport, { name: string; short: string; min: number; max: number; picks: number[]; words: Record<'beginner' | 'intermediate' | 'advanced', [number, number | null]> }> = {
  tennis: {
    name: 'NTRP', short: 'NTRP', min: 1.5, max: 7,
    picks: [2.5, 3, 3.5, 4, 4.5, 5, 5.5],
    words: { beginner: [1.5, 2.5], intermediate: [3, 3.5], advanced: [4, null] },
  },
  pickleball: {
    name: 'DUPR', short: 'DUPR', min: 2, max: 8,
    picks: [2.5, 3, 3.25, 3.5, 3.75, 4, 4.25, 4.5, 5],
    words: { beginner: [2, 2.75], intermediate: [3, 3.75], advanced: [4, null] },
  },
  padel: {
    name: 'Playtomic', short: 'Playtomic', min: 0, max: 7,
    picks: [1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5],
    words: { beginner: [0, 1.5], intermediate: [2, 3.5], advanced: [4, null] },
  },
};

export interface LevelRange { min: number | null; max: number | null }

const fmt = (n: number) => (Number.isInteger(n) ? n.toFixed(1) : String(+n.toFixed(2)));
export const levelNum = (n: number) => fmt(n);

const scaleOf = (sport: string | null | undefined) => LEVEL_SCALE[(sport as LevelSport) in LEVEL_SCALE ? (sport as LevelSport) : 'tennis'];

/** "3.5–4.0", "3.5-4", "4.0+", "4.25 DUPR", "under 3.5", "intermediate", "3.5 and up" → a range. */
export function parseLevelRange(text: string | null | undefined, sport?: string | null): LevelRange | null {
  if (!text) return null;
  const t = text.toLowerCase().replace(/[–—]/g, '-');
  const sc = scaleOf(sport);
  const ok = (n: number) => Number.isFinite(n) && n >= sc.min && n <= sc.max;
  const pair = t.match(/(\d(?:\.\d{1,2})?)\s*(?:-|to)\s*(\d(?:\.\d{1,2})?)/);
  if (pair) {
    const a = +pair[1], b = +pair[2];
    if (ok(a) && ok(b)) return { min: Math.min(a, b), max: Math.max(a, b) };
  }
  const up = t.match(/(\d(?:\.\d{1,2})?)\s*(?:\+|and up|or (?:higher|better|above)|plus)/) || t.match(/(?:over|above|at least|min(?:imum)?)\s*(\d(?:\.\d{1,2})?)/);
  if (up && ok(+up[1])) return { min: +up[1], max: null };
  const down = t.match(/(?:under|below|up to|max(?:imum)?)\s*(\d(?:\.\d{1,2})?)/) || t.match(/(\d(?:\.\d{1,2})?)\s*(?:and (?:under|below)|or (?:lower|below)|-$)/);
  if (down && ok(+down[1])) return { min: null, max: +down[1] };
  const one = t.match(/(\d(?:\.\d{1,2})?)/);
  if (one && ok(+one[1])) return { min: +one[1], max: +one[1] };
  for (const w of ['beginner', 'intermediate', 'advanced'] as const) {
    if (t.includes(w) || (w === 'intermediate' && /\binter\b|\bmid\b/.test(t)) || (w === 'beginner' && /\bnew(bie)?s?\b|\bnovice\b/.test(t))) {
      const [min, max] = sc.words[w];
      return { min, max };
    }
  }
  return null;
}

/** A range as people write it: "3.5–4.0 NTRP", "4.0+ DUPR", "Any level". */
export function levelLabel(r: LevelRange | null, sport?: string | null, withScale = true): string {
  if (!r || (r.min == null && r.max == null)) return 'Any level';
  const sc = scaleOf(sport);
  const tag = withScale ? ` ${sc.short}` : '';
  if (r.min != null && r.max != null) return r.min === r.max ? `${fmt(r.min)}${tag}` : `${fmt(r.min)}–${fmt(r.max)}${tag}`;
  if (r.min != null) return `${fmt(r.min)}+${tag}`;
  return `Up to ${fmt(r.max!)}${tag}`;
}

/**
 * Does a player's level fit a game's range? A little slack either side
 * (a quarter point on DUPR, half a level on padel; NTRP halves are whole steps, so none),
 * because self-ratings drift.
 */
export function levelFits(r: LevelRange | null, player: number | null | undefined, sport?: string | null): boolean {
  if (player == null || !r || (r.min == null && r.max == null)) return true;
  const slack = sport === 'pickleball' ? 0.25 : sport === 'padel' ? 0.5 : 0;
  if (r.min != null && player < r.min - slack) return false;
  if (r.max != null && player > r.max + slack) return false;
  return true;
}

/** How a player's level sits against the game: for a soft note, never a block. */
export function levelNote(r: LevelRange | null, player: number | null | undefined, sport?: string | null): 'fits' | 'below' | 'above' | null {
  if (player == null || !r || (r.min == null && r.max == null)) return null;
  if (levelFits(r, player, sport)) return 'fits';
  return r.min != null && player < r.min ? 'below' : 'above';
}

/* ---------- a player's own level, remembered per sport on this phone ---------- */
const KEY = 'cc_play_levels_v1';
export function getMyLevel(sport: string): number | null {
  try { const v = (JSON.parse(localStorage.getItem(KEY) || '{}') as Record<string, number>)[sport]; return typeof v === 'number' ? v : null; } catch { return null; }
}
export function setMyLevel(sport: string, v: number | null) {
  try { const m = JSON.parse(localStorage.getItem(KEY) || '{}'); if (v == null) delete m[sport]; else m[sport] = v; localStorage.setItem(KEY, JSON.stringify(m)); } catch { /* private mode */ }
}
