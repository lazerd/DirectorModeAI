/**
 * Paste World Tennis Numbers in from a USTA player profile or a team page.
 *
 * WTN is the number that makes line order objective. NTRP is coarse — half a
 * B2/B3 roster shares a 3.0, so ordering courts on it is really the captain
 * guessing — where WTN is a single decimal that separates every player. Average
 * the two WTNs on a doubles pair and lines 1 through 4 fall out of the numbers
 * instead of out of an opinion.
 *
 * The scale runs the OPPOSITE way to NTRP: 40 is a beginner and 1 is a pro, so
 * LOWER is stronger. That inversion is the whole reason WTN lives in its own
 * column and its own parser rather than being poured into `rating` — one silent
 * sign flip would put the weakest pair on court 1 and look entirely plausible.
 *
 * There is a USTA Connect API that serves WTN (POST /v1/api-public/wtn), but it
 * needs a partner OAuth client issued by a USTA rep and each player's UAID, so
 * until those exist the captain copies the numbers out of their own browser and
 * this does the fiddly part: parsing a ragged table and matching 20-odd names.
 * Deterministic, no LLM, same as the ratings importer — and nothing is written
 * until the captain has seen a preview of exactly who gets which number.
 */
import { canonical, matchByName, type MatchedOn } from './ratingsPaste';

/**
 * The published WTN band. 40 is the beginner floor and 1 the professional
 * ceiling; anything outside is not a WTN and is far more likely to be a match
 * count, a win percentage or an NTRP rating sitting in the next column.
 */
export const MIN_WTN = 1;
export const MAX_WTN = 40;

/**
 * Numbers at or below this are almost certainly NTRP, not WTN. A genuine WTN of
 * 7 is a nationally ranked junior — nobody on a ladies B2/B3 roster has one, and
 * pasting a TennisRecord block into the WTN box by mistake would otherwise write
 * "3.42" over everyone as if it were an elite number and invert the whole line
 * order. Reporting it back is always better than importing it.
 */
const NTRP_LOOKALIKE_MAX = 7;

export type ParsedWtn = {
  name: string;
  /** singles WTN, or the only WTN on the line */
  wtn: number;
  /** doubles WTN when the line carried two — the one a doubles league wants */
  wtnDoubles: number | null;
};

export type WtnMatch = {
  playerId: string;
  playerName: string;
  wtn: number;
  wtnDoubles: number | null;
  matchedOn: MatchedOn;
  previousWtn: number | null;
  previousWtnDoubles: number | null;
};

export type WtnResolution = {
  matched: WtnMatch[];
  unmatched: ParsedWtn[];
  ambiguous: { parsed: ParsedWtn; candidates: string[] }[];
  /** lines that held no name/number pair at all */
  ignoredLines: string[];
  /**
   * Lines whose numbers all looked like NTRP ratings. Called out separately
   * because it means the captain pasted the wrong block, and a silent "nothing
   * matched" would send them hunting for a name-matching bug instead.
   */
  ntrpLooking: string[];
};

/**
 * Every number on the line, in the order they appear, tags stripped.
 *
 * Read per CELL, and only cells that are a bare number count. A loose scan of
 * the raw text pulls an 8 and a 4 out of the win-loss column "8-4", and an 8 is
 * a perfectly plausible WTN — so "Paula Garcia  3.42  8-4", a TennisRecord row
 * pasted into the wrong box, would import as an 8 and rank her the strongest
 * player on the team. Requiring the whole cell to be the number throws that
 * line out instead, which is the only safe answer.
 */
function numbersIn(raw: string): number[] {
  const withoutTags = raw.replace(/\(.*?\)/g, ' ');
  const cells = withoutTags.split(/\t|\s{2,}/).map((c) => c.trim()).filter(Boolean);
  // A single-column paste is space-separated; split it the rest of the way.
  const fields = cells.length > 1 ? cells : withoutTags.split(/\s+/).filter(Boolean);
  const out: number[] = [];
  for (const f of fields) {
    if (/^\d+(?:\.\d+)?$/.test(f)) out.push(Number(f));
  }
  return out;
}

/** The name cell: has letters, no digits left after tags are stripped, and at
 *  least two words (one bare word can't be matched to a roster with confidence). */
function nameIn(raw: string): string | null {
  const cols = raw.split(/\t|\s{2,}/).map((c) => c.trim()).filter(Boolean);
  for (const f of cols.length > 1 ? cols : [raw]) {
    const cleaned = f.replace(/\(.*?\)/g, '').trim();
    if (/[a-z]/i.test(cleaned) && !/\d/.test(cleaned) && cleaned.length >= 3 && /\s|,/.test(cleaned)) {
      return cleaned;
    }
  }
  // Single-column line: "Jane Smith 14.2 15.1"
  const m = raw.match(/^([A-Za-z][A-Za-z .'-]*?[A-Za-z])\s+\d/);
  return m && /\s|,/.test(m[1]) ? m[1].trim() : null;
}

export type WtnLineResult =
  | { kind: 'parsed'; value: ParsedWtn }
  | { kind: 'ntrp' }
  | { kind: 'ignored' };

/**
 * One pasted line → a name and one or two WTNs.
 *
 * When a line carries two in-band numbers they are read as singles then
 * doubles, which is the order a USTA profile and the WTN site both print them.
 * A third number (matches played, last-played date) is ignored — a WTN pair is
 * always the first two.
 */
export function parseWtnLine(line: string): WtnLineResult {
  const raw = line.trim();
  if (!raw) return { kind: 'ignored' };

  const name = nameIn(raw);
  if (!name) return { kind: 'ignored' };

  const nums = numbersIn(raw);
  const inBand = nums.filter((n) => n >= MIN_WTN && n <= MAX_WTN);
  if (!inBand.length) return { kind: 'ignored' };

  // Every candidate sits in NTRP territory — treat the line as a wrong paste
  // rather than importing a 3.5 as if it were a near-professional WTN.
  const plausible = inBand.filter((n) => n > NTRP_LOOKALIKE_MAX);
  if (!plausible.length) return { kind: 'ntrp' };

  return {
    kind: 'parsed',
    value: {
      name,
      wtn: plausible[0],
      wtnDoubles: plausible.length > 1 ? plausible[1] : null,
    },
  };
}

export function parseWtnBlock(text: string): {
  parsed: ParsedWtn[];
  ignored: string[];
  ntrpLooking: string[];
} {
  const parsed: ParsedWtn[] = [];
  const ignored: string[] = [];
  const ntrpLooking: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const r = parseWtnLine(line);
    if (r.kind === 'parsed') parsed.push(r.value);
    else if (r.kind === 'ntrp') ntrpLooking.push(line.trim());
    else ignored.push(line.trim());
  }
  return { parsed, ignored, ntrpLooking };
}

export function resolveWtn(
  parsed: ParsedWtn[],
  roster: { id: string; name: string; wtn: number | null; wtn_doubles: number | null }[],
  ignoredLines: string[] = [],
  ntrpLooking: string[] = [],
): WtnResolution {
  const res = matchByName(parsed, roster);
  return {
    matched: res.matched.map((m) => ({
      playerId: m.player.id,
      playerName: m.player.name,
      wtn: m.parsed.wtn,
      wtnDoubles: m.parsed.wtnDoubles,
      matchedOn: m.matchedOn,
      previousWtn: m.player.wtn,
      previousWtnDoubles: m.player.wtn_doubles,
    })),
    unmatched: res.unmatched,
    ambiguous: res.ambiguous,
    ignoredLines,
    ntrpLooking,
  };
}

/**
 * The WTN a doubles league should order on: the doubles number when the player
 * has one, otherwise their singles number. Null when they have neither.
 */
export function doublesWtnOf(p: {
  wtn?: number | null;
  wtnDoubles?: number | null;
}): number | null {
  const d = p.wtnDoubles;
  if (typeof d === 'number' && !Number.isNaN(d)) return d;
  const s = p.wtn;
  return typeof s === 'number' && !Number.isNaN(s) ? s : null;
}

/**
 * Strength order implied by WTN, strongest (lowest number) first.
 *
 * Players with no WTN fall to the bottom rather than being treated as a 0,
 * which on this inverted scale would make them the strongest on the team.
 * Ties keep their existing rank, then fall back to name, so re-importing the
 * same numbers never reshuffles players the captain already placed by hand.
 */
export function rankByWtn(
  players: {
    id: string;
    name: string;
    wtn?: number | null;
    wtnDoubles?: number | null;
    sort_order?: number | null;
  }[],
): string[] {
  return [...players]
    .sort((a, b) => {
      const wa = doublesWtnOf(a);
      const wb = doublesWtnOf(b);
      if (wa === null && wb !== null) return 1;
      if (wb === null && wa !== null) return -1;
      if (wa !== null && wb !== null && wa !== wb) return wa - wb; // lower = stronger
      const sa = a.sort_order ?? Number.MAX_SAFE_INTEGER;
      const sb = b.sort_order ?? Number.MAX_SAFE_INTEGER;
      if (sa !== sb) return sa - sb;
      return a.name.localeCompare(b.name);
    })
    .map((p) => p.id);
}

/** Exported so the importer's preview can explain a near-miss name. */
export { canonical };
