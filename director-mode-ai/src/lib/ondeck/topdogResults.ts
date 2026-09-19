/**
 * TopDog's match list — the other half of the sheet.
 *
 * courtschedule.asp says what is meant to happen and when. matches_list.asp
 * says what HAS happened: every match carries a Score column that reads
 * "Scheduled" until a result goes in, then the score itself ("6-1 6-2"),
 * "DF" for a default, and so on.
 *
 * That column is what closes the loop at the desk. Darrin enters the score
 * in TopDog the way he always has; the desk notices within a poll and opens
 * the court on its own, instead of asking him to say the same thing twice.
 *
 * The page also carries each division's TopDog event id, which is what the
 * batch score-entry form is keyed on — so the desk can send him straight to
 * the right form rather than the top of the list.
 */

import type { TopDogMatch } from './topdog';

export interface DivisionLink {
  /** "Boys' 10 Singles" — not unique; main and consolation share a name. */
  name: string;
  /** TopDog's event id, e.g. 17166. */
  eventId: string;
}

export interface MatchResult {
  division: string;
  round: string;
  /** "09/19/26" */
  date: string;
  playerA: string;
  playerB: string;
  /** "Scheduled", "6-1 6-2", "DF", "RET"… exactly as TopDog prints it. */
  score: string;
  /** A result is in — anything but "Scheduled". */
  done: boolean;
}

export interface ResultsPage {
  divisions: DivisionLink[];
  results: MatchResult[];
}

const ENTITIES: Record<string, string> = {
  nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
};

function decode(s: string): string {
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

function text(html: string): string {
  return decode(html.replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();
}

/** The results page URL. eventId 0 is "All Divisions". */
export function resultsUrl(tournamentId: string, eventId = '0'): string {
  return `https://sleepyhollowswimtennis.topdoglive.com/pages/tournaments/matches_list.asp` +
    `?idevent=${encodeURIComponent(eventId)}&t=${encodeURIComponent(tournamentId)}`;
}

/** Where Darrin enters a score. Admin-only; he is signed in on the desk laptop. */
export function scoreEntryUrl(eventId: string): string {
  return `https://sleepyhollowswimtennis.topdoglive.com/pages/tournaments/manager/views/scoresbatch.asp` +
    `?idevent=${encodeURIComponent(eventId)}`;
}

export function parseResults(html: string): ResultsPage {
  const divisions: DivisionLink[] = [];
  const linkRe = /matches_list\.asp\?t=\d+&idevent=(\d+)[^>]*>([^<]+)</gi;
  let l: RegExpExecArray | null;
  while ((l = linkRe.exec(html)) !== null) {
    const eventId = l[1];
    if (eventId === '0') continue; // "All Divisions"
    const name = text(l[2]);
    if (name && !divisions.some((d) => d.eventId === eventId)) divisions.push({ name, eventId });
  }

  const results: MatchResult[] = [];
  const rowRe = /<tr>((?:(?!<\/tr>)[\s\S])*)<\/tr>/gi;
  let r: RegExpExecArray | null;
  while ((r = rowRe.exec(html)) !== null) {
    const cells: string[] = [];
    const cellRe = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    let c: RegExpExecArray | null;
    while ((c = cellRe.exec(r[1])) !== null) cells.push(text(c[1]));
    // Division, Round, Date, Start, Court, Player(s), Opponent(s), Score
    if (cells.length < 8) continue;
    const score = cells[7];
    if (!score) continue;
    results.push({
      division: cells[0],
      round: cells[1],
      date: cells[2],
      playerA: cells[5],
      playerB: cells[6],
      score,
      done: !/^scheduled$/i.test(score),
    });
  }

  return { divisions, results };
}

/**
 * Names are the only thing the two pages agree on — the schedule has no ids —
 * so the join is on the pair, order-insensitive because TopDog is not
 * consistent about which side it calls the player and which the opponent.
 */
function pairKey(a: string, b: string): string {
  const norm = (n: string) => n.toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim();
  return [norm(a), norm(b)].sort().join(' | ');
}

/**
 * Fold the results page into the schedule: anything TopDog has a score for
 * is finished, whatever the schedule still shows.
 *
 * A match with a blank side cannot be joined and is left alone — two
 * unstarted matches in the same round would otherwise both key on " | ".
 */
export function mergeResults(matches: TopDogMatch[], results: MatchResult[]): TopDogMatch[] {
  const scored = new Map<string, MatchResult>();
  for (const r of results) {
    if (!r.done || !r.playerA || !r.playerB) continue;
    scored.set(pairKey(r.playerA, r.playerB), r);
  }
  if (!scored.size) return matches;

  return matches.map((m) => {
    if (!m.playerA || !m.playerB || m.completed) return m;
    const hit = scored.get(pairKey(m.playerA, m.playerB));
    if (!hit) return m;
    return { ...m, completed: true, ready: false, score: hit.score };
  });
}

/**
 * The division a match belongs to, for the "enter the score" link.
 *
 * Division names repeat — a 10s main draw and its consolation are both
 * "Boys' 10 Singles" — so this can only ever be a best guess, and it is used
 * to preselect a form Darrin can change, never to write anything.
 */
export function eventIdFor(m: TopDogMatch, divisions: DivisionLink[]): string | null {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const target = norm(m.event);
  return divisions.find((d) => norm(d.name) === target)?.eventId ?? null;
}
