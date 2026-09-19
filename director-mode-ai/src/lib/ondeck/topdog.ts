/**
 * TopDog Sports tournament schedule — read-only.
 *
 * The RSPA/USPTA Jr Circuit events run on TopDog, not Serve Tennis, and the
 * two publish completely different things:
 *
 *   Serve Tennis  a match feed with a court on it, so "court assigned" is
 *                 the event the PA reacts to.
 *   TopDog        an order of play grouped by START TIME, with a single
 *                 "Unknown Court" column — the desk never assigns courts,
 *                 so that event does not exist here.
 *
 * What DOES happen on TopDog is that a match's players are blank until the
 * previous round is scored, and fill in the moment the desk enters a result.
 * That is the trigger this feed exposes: a match going from "TBD vs TBD" to
 * two real names is a match that can now be called. Courts are chosen on our
 * side, by the person at the desk.
 *
 * The page is public — no login, no token — so this is a plain GET. It is
 * fetched server-side only because TopDog sends no CORS headers.
 */

export interface TopDogMatch {
  /** Stable for a given day, so the announcer can remember what it called. */
  id: string;
  /** Start time exactly as TopDog prints it: "8:00am". */
  slot: string;
  /** Same time as "HH:MM", for sorting and for "has this wave started?". */
  slot24: string;
  /** Court from the column header, or null for TopDog's "Unknown Court". */
  court: string | null;
  /** "Boys' 10 Singles" */
  event: string;
  /** "Round 16", "Quarters", "Consol Semis" */
  round: string;
  /** Empty string when the draw has not produced this player yet. */
  playerA: string;
  playerB: string;
  /** The bolded name, when TopDog has recorded a result. */
  winner: string | null;
  defaulted: boolean;
  /** Result already in — nothing left to call. */
  completed: boolean;
  /** The score, once TopDog's match list has one ("6-1 6-2", "DF"). */
  score?: string;
  /** Both players known and no result yet: this one can go over the PA. */
  ready: boolean;
}

export interface TopDogDateOption {
  /** "9/19/2026" — the value the form posts back. */
  value: string;
  /** "Saturday, September 19, 2026" */
  label: string;
  selected: boolean;
}

export interface TopDogSchedule {
  tournamentId: string;
  tournamentName: string;
  /** The day this schedule is for, as TopDog spells it. */
  date: string;
  dates: TopDogDateOption[];
  /** Column headers, minus TopDog's "Unknown Court" placeholder. */
  courts: string[];
  matches: TopDogMatch[];
}

export const TOPDOG_HOST = 'https://sleepyhollowswimtennis.topdoglive.com';

/** The public order-of-play page. `date` is TopDog's own M/D/YYYY. */
export function scheduleUrl(tournamentId: string, date?: string): string {
  const q = new URLSearchParams({ tournamentid: tournamentId });
  if (date) q.set('currentdate', date);
  return `${TOPDOG_HOST}/pages/tournaments/courtschedule.asp?${q.toString()}`;
}

const ENTITIES: Record<string, string> = {
  nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
};

/** TopDog is classic ASP: a handful of entities, no unicode escapes. */
export function decodeEntities(s: string): string {
  return s.replace(/&(#\d+|[a-z]+);/gi, (whole, name: string) => {
    const key = name.toLowerCase();
    if (ENTITIES[key] !== undefined) return ENTITIES[key];
    if (key.startsWith('#')) {
      const code = Number(key.slice(1));
      return Number.isFinite(code) ? String.fromCharCode(code) : whole;
    }
    return whole;
  });
}

function stripTags(s: string): string {
  return decodeEntities(s.replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();
}

/**
 * "8:00am" -> "08:00". Returns '' for anything that isn't a clock, which is
 * how a stray header row gets ignored downstream.
 */
export function slotTo24(slot: string): string {
  const m = slot.trim().toLowerCase().match(/^(\d{1,2}):(\d{2})\s*(am|pm)?$/);
  if (!m) return '';
  let h = Number(m[1]);
  const min = m[2];
  const mer = m[3];
  if (mer === 'pm' && h !== 12) h += 12;
  if (mer === 'am' && h === 12) h = 0;
  return `${String(h).padStart(2, '0')}:${min}`;
}

/**
 * Round shorthand as it appears at the head of a TopDog match line. Kept
 * deliberately tight — anything looser starts eating the first name of the
 * player that follows it.
 */
const ROUND_RE =
  /^((?:consol(?:ation)?\s+)?(?:round\s*robin|round\s+\d+|quarters|quarterfinals?|semis|semifinals?|finals?|playoff(?:\s+\d+(?:\s*-\s*\d+)?)?|\d+))\s*/i;

/**
 * One line of a schedule cell:
 *   "Boys' 10 Singles Round 16 Bennett J Stocker vs. Niam R Pathare"
 *   "Boys' 10 Singles Round 16 <b>Massimo Cardenas</b> vs. Rory Frase (default)"
 *   "Boys' 12 Singles Consol Quarters  vs. "
 *
 * The event always ends at "Singles" or "Doubles", the round always follows
 * it, and the two sides are always split by " vs. ". Anything that doesn't
 * fit that shape is returned with the whole line as the event, so a format
 * we have not seen shows up on screen instead of vanishing.
 */
export function parseMatchLine(html: string): {
  event: string; round: string; playerA: string; playerB: string;
  winner: string | null; defaulted: boolean;
} | null {
  const bold = html.match(/<b>(.*?)<\/b>/i);
  const winner = bold ? stripTags(bold[1]) || null : null;

  let text = stripTags(html);
  if (!text) return null;

  const defaulted = /\(default\)/i.test(text);
  text = text.replace(/\(default\)/gi, '').trim();
  if (!text) return null;

  const head = text.match(/^(.*?\b(?:singles|doubles))\b\s*(.*)$/i);
  const event = head ? head[1].trim() : text;
  const rest = head ? head[2] : '';

  const sides = rest.split(/\s+vs\.?\s+|\s+vs\.?$/i);
  const left = (sides[0] ?? '').trim();
  const playerB = (sides[1] ?? '').trim();

  const roundMatch = left.match(ROUND_RE);
  const round = roundMatch ? roundMatch[1].replace(/\s+/g, ' ').trim() : '';
  const playerA = roundMatch ? left.slice(roundMatch[0].length).trim() : left;

  return { event, round, playerA, playerB, winner, defaulted };
}

/** Rows of the schedule table, each already split into its `<td>` contents. */
function tableRows(html: string): string[][] {
  const table = html.match(/<table[^>]*class="[^"]*table-striped[^"]*"[^>]*>([\s\S]*?)<\/table>/i);
  if (!table) return [];
  const rows: string[][] = [];
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let r: RegExpExecArray | null;
  while ((r = rowRe.exec(table[1])) !== null) {
    const cells: string[] = [];
    const cellRe = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    let c: RegExpExecArray | null;
    while ((c = cellRe.exec(r[1])) !== null) cells.push(c[1]);
    if (cells.length) rows.push(cells);
  }
  return rows;
}

/** TopDog's placeholder header for "nobody has assigned courts". */
function isRealCourt(name: string): boolean {
  const n = name.trim().toLowerCase();
  return !!n && n !== 'unknown court' && n !== 'court';
}

export function parseSchedule(html: string, tournamentId: string): TopDogSchedule {
  const titleMatch = html.match(/<h2>([\s\S]*?)<\/h2>/i);
  const tournamentName = titleMatch ? stripTags(titleMatch[1]) : 'Tournament';

  const dates: TopDogDateOption[] = [];
  const optRe = /<option\s+value="([^"]*)"([^>]*)>([\s\S]*?)<\/option>/gi;
  let o: RegExpExecArray | null;
  while ((o = optRe.exec(html)) !== null) {
    dates.push({
      value: o[1].trim(),
      label: stripTags(o[3]),
      selected: /\bselected\b/i.test(o[2]),
    });
  }
  const date = (dates.find((d) => d.selected) ?? dates[0])?.value ?? '';

  const rows = tableRows(html);
  const header = rows[0] ?? [];
  // The header's first cell is the empty corner above the time column.
  const courtHeaders = header.slice(1).map((c) => stripTags(c));
  const courts = courtHeaders.filter(isRealCourt);

  const matches: TopDogMatch[] = [];
  for (const cells of rows.slice(1)) {
    const slot = stripTags(cells[0] ?? '');
    const slot24 = slotTo24(slot);
    if (!slot24) continue; // not a time row

    cells.slice(1).forEach((cell, col) => {
      const headerName = courtHeaders[col] ?? '';
      const court = isRealCourt(headerName) ? headerName : null;

      cell.split(/<br\s*\/?>/i).forEach((line, idx) => {
        const parsed = parseMatchLine(line);
        if (!parsed) return;
        const { event, round, playerA, playerB, winner, defaulted } = parsed;
        // A line with no event and no players is table padding (&nbsp;).
        if (!event && !playerA && !playerB) return;

        const completed = defaulted || !!winner;
        matches.push({
          id: `${date}|${slot24}|${col}|${idx}|${event}|${round}`,
          slot, slot24, court, event, round, playerA, playerB, winner, defaulted,
          completed,
          ready: !!playerA && !!playerB && !completed,
        });
      });
    });
  }

  return { tournamentId, tournamentName, date, dates, courts, matches };
}

/* ------------------------------------------------------------------ */
/* Speech                                                              */
/* ------------------------------------------------------------------ */

/**
 * "Bennett J Stocker" -> "Bennett Stocker".
 *
 * A middle initial read aloud ("Bennett Jay Stocker") is pure noise over a
 * PA and makes the name harder to recognise, not easier.
 */
export function spokenName(name: string): string {
  return name.replace(/\s+[A-Z]\.?(?=\s)/g, '').replace(/\s+/g, ' ').trim();
}

const ROUND_WORDS: Record<string, string> = {
  quarters: 'quarterfinal',
  quarterfinal: 'quarterfinal',
  quarterfinals: 'quarterfinal',
  semis: 'semifinal',
  semifinal: 'semifinal',
  semifinals: 'semifinal',
  final: 'final',
  finals: 'final',
  'round robin': 'round robin',
};

const NUMBER_WORDS: Record<string, string> = {
  '1': 'one', '2': 'two', '3': 'three', '4': 'four', '8': 'eight',
  '16': 'sixteen', '32': 'thirty two', '64': 'sixty four',
};

/**
 * "Consol Quarters" -> "consolation quarterfinal", "Round 16" -> "round of
 * sixteen". Left as-is if we don't recognise it: saying the draw sheet's own
 * words is better than saying nothing.
 */
export function spokenRound(round: string): string {
  if (!round) return '';
  let s = round.trim().toLowerCase().replace(/\s+/g, ' ');
  let prefix = '';
  const consol = s.match(/^consol(?:ation)?\s+(.*)$/);
  if (consol) { prefix = 'consolation '; s = consol[1].trim(); }

  const roundN = s.match(/^round\s*(\d+)$/);
  if (roundN) return `${prefix}round of ${NUMBER_WORDS[roundN[1]] ?? roundN[1]}`.trim();

  // "Consol 1" — a bare number after the consolation prefix is a round.
  const bare = s.match(/^(\d+)$/);
  if (bare) return `${prefix}round ${NUMBER_WORDS[bare[1]] ?? bare[1]}`.trim();

  return (prefix + (ROUND_WORDS[s] ?? s)).trim();
}

/** "Boys' 10 Singles" -> "boys ten singles". */
export function spokenEvent(event: string): string {
  if (!event) return '';
  const AGES: Record<string, string> = {
    '8': 'eight', '10': 'ten', '12': 'twelve', '14': 'fourteen',
    '16': 'sixteen', '18': 'eighteen',
  };
  return event
    .replace(/&/g, ' and ')
    .replace(/['’]/g, '')
    .replace(/\b(\d{1,2})\b/g, (_, d: string) => AGES[d] ?? d)
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * The line that goes over the PA.
 *
 * Court first and court last: the middle is who, the ends are where, and
 * the ends are the only part anyone reliably hears. With no court chosen
 * yet the call sends them to the desk instead, which is what happens at a
 * TopDog event where courts are handed out by hand.
 */
export function announcementText(m: TopDogMatch, court?: string | null): string {
  const where = (court ?? m.court ?? '').trim();
  const event = spokenEvent(m.event);
  const round = m.round ? `, ${spokenRound(m.round)}` : '';
  const a = spokenName(m.playerA) || 'player to be confirmed';
  const b = spokenName(m.playerB) || 'player to be confirmed';

  if (!where) {
    return `Attention please. ${event}${round}. ${a} versus ${b}. Please report to the tournament desk.`;
  }
  return `Attention please. On court ${where}, ${event}${round}. ${a} versus ${b}. Players report to court ${where}.`;
}

/**
 * Matches that became callable since the last poll.
 *
 * "Callable" is both players known and no result in — the TopDog equivalent
 * of a court going up on the Serve Tennis desk. Anything already announced
 * is excluded by the caller's set, so a player is never called twice for the
 * same match.
 */
export function diffForAnnouncement(
  previous: TopDogMatch[],
  current: TopDogMatch[],
  announced: Set<string>
): TopDogMatch[] {
  const before = new Map(previous.map((m) => [m.id, m]));
  return current.filter((m) => {
    if (!m.ready || announced.has(m.id)) return false;
    const was = before.get(m.id);
    // First sight of an already-ready match is not news: it was on the sheet
    // before we started looking. Only a transition is.
    return !!was && !was.ready;
  });
}
