/**
 * Carrying a match's saved scores to TopDog's "Enter Score" page.
 *
 * TopDog answers server requests with "Bots are disabled", and a captain's
 * session is the only thing allowed to post a scorecard, so nothing here talks
 * to TopDog. ClubMode builds a small fill payload; the captain opens the entry
 * page and taps the "Fill from ClubMode" bookmarklet (public/topdog-fill.js),
 * which fills the form in their own browser and STOPS — the captain checks the
 * card and presses Submit themselves. Posting to a league is an outward
 * submission and is never done on anyone's behalf.
 */

export type TopDogLink = { host: string; matchId: string };

/**
 * Any TopDog link for one match → where it lives. Accepts the scorecard page
 * (list_scorecard.asp?id=), the entry page (ScoreCardEntry.asp?s=), the lineup
 * page (lineup_edit.asp?matchid=) and the blank card (scorecardblank.asp?id=),
 * or a bare numeric id when the host is already known.
 */
export function parseTopDogLink(input: string, knownHost?: string | null): TopDogLink | null {
  const raw = (input || '').trim();
  if (/^\d{4,}$/.test(raw)) return knownHost ? { host: knownHost, matchId: raw } : null;
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  if (host !== 'topdoglive.com' && !host.endsWith('.topdoglive.com')) return null;
  const q = url.searchParams;
  const page = url.pathname.toLowerCase();
  const id = page.includes('scorecardentry')
    ? q.get('s')
    : page.includes('lineup_edit')
      ? q.get('matchid')
      : q.get('id') ?? q.get('s') ?? q.get('matchid');
  if (!id || !/^\d+$/.test(id)) return null;
  return { host, matchId: id };
}

export function topdogEntryUrl(link: TopDogLink, action: 'insert' | 'update' = 'insert'): string {
  return `https://${link.host}/pages/leagues/ScoreCardEntry.asp?s=${link.matchId}&action=${action}`;
}

export function topdogScorecardUrl(link: TopDogLink): string {
  return `https://${link.host}/pages/leagues/list_scorecard.asp?id=${link.matchId}`;
}

/** One set, written ours-then-theirs. */
export type SetScore = [number, number];

/**
 * A ClubMode score ("6-4, 4-6, 10-8", "7-6(5), 6-3", "6-4, 5-6 RET") → the set
 * boxes TopDog wants, from OUR side.
 *
 * TopDog's own rule: "if you play a tie-breaker in lieu of a third set enter
 * 1-0". A match tiebreak typed as 10-8 is converted; one already typed as 1-0
 * or 0-1 passes through. Tiebreak points in brackets are dropped.
 */
export function topdogSets(score: string | null | undefined): { sets: SetScore[]; retired: boolean } {
  const text = score || '';
  const retired = /\bret(ired|\.)?\b/i.test(text);
  const sets: SetScore[] = [];
  for (const m of text.replace(/\(\d+\)/g, '').matchAll(/(\d+)\s*-\s*(\d+)/g)) {
    let a = Number(m[1]);
    let b = Number(m[2]);
    const matchTiebreak = sets.length === 2 && Math.max(a, b) >= 10;
    if (matchTiebreak) [a, b] = a > b ? [1, 0] : [0, 1];
    sets.push([a, b]);
  }
  return { sets: sets.slice(0, 3), retired };
}

export type FillCourt = {
  courtNumber: number;
  courtType: 'singles' | 'doubles';
  /** Player names in slot order; null for an empty slot. */
  players: (string | null)[];
  score: string | null;
  won: boolean | null;
  defaulted: boolean;
  defaultBy: 'us' | 'them' | null;
};

/** What the bookmarklet reads. Keep in step with public/topdog-fill.js. */
export type FillPayload = {
  v: 1;
  /** TopDog's match id — the bookmarklet refuses a page for any other match. */
  s: string;
  /** M/D/YYYY in the club's zone, the format TopDog's date box uses. */
  date: string;
  /** Which side of TopDog's card is ours: H(ome) or V(isitor). */
  side: 'H' | 'V';
  opponent: string | null;
  lines: {
    type: 'S' | 'D';
    court: number;
    /** TopDog status codes: C completed, DF default, RE retired. */
    status: 'C' | 'DF' | 'RE';
    winner: 'us' | 'them' | null;
    /** Our names, or 'default' when we could not field the court. */
    us: (string | null)[] | 'default';
    /** Only ever 'default' — ClubMode doesn't know the other team's names. */
    them: 'default' | null;
    sets: SetScore[];
  }[];
};

export function buildFillPayload(input: {
  matchId: string;
  matchAt: string;
  timeZone: string;
  isHome: boolean;
  opponent: string | null;
  courts: FillCourt[];
}): { payload: FillPayload; problems: string[] } {
  const problems: string[] = [];
  const date = new Intl.DateTimeFormat('en-US', {
    timeZone: input.timeZone,
    month: 'numeric',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(input.matchAt));

  const ordered = [...input.courts].sort((a, b) => a.courtNumber - b.courtNumber);
  const lines = ordered.map((c) => {
    const label = `${c.courtType === 'singles' ? 'Singles' : 'Doubles'} ${c.courtNumber}`;
    const need = c.courtType === 'singles' ? 1 : 2;
    const names = c.players.slice(0, need);
    while (names.length < need) names.push(null);

    if (c.defaulted) {
      const weDefaulted = c.defaultBy === 'us';
      if (!weDefaulted && names.some((n) => !n)) problems.push(`${label}: a player is missing from the lineup.`);
      return {
        type: c.courtType === 'singles' ? 'S' : 'D',
        court: c.courtNumber,
        status: 'DF',
        winner: weDefaulted ? 'them' : 'us',
        us: weDefaulted ? 'default' : names,
        them: weDefaulted ? null : 'default',
        // TopDog: "Default matches must be recorded as 6-0, 6-0."
        sets: weDefaulted ? [[0, 6], [0, 6]] : [[6, 0], [6, 0]],
      } as FillPayload['lines'][number];
    }

    const { sets, retired } = topdogSets(c.score);
    if (!sets.length) problems.push(`${label}: no score saved.`);
    if (c.won == null) problems.push(`${label}: no winner marked.`);
    if (names.some((n) => !n)) problems.push(`${label}: a player is missing from the lineup.`);
    return {
      type: c.courtType === 'singles' ? 'S' : 'D',
      court: c.courtNumber,
      status: retired ? 'RE' : 'C',
      winner: c.won == null ? null : c.won ? 'us' : 'them',
      us: names,
      them: null,
      sets,
    } as FillPayload['lines'][number];
  });

  return {
    payload: {
      v: 1,
      s: input.matchId,
      date,
      side: input.isHome ? 'H' : 'V',
      opponent: input.opponent,
      lines,
    },
    problems,
  };
}

/** URL-safe base64 of the JSON, so it survives a #fragment and a paste box. */
export function encodeFillPayload(p: FillPayload): string {
  return Buffer.from(JSON.stringify(p), 'utf8').toString('base64url');
}
