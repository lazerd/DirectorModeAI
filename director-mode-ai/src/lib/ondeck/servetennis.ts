/**
 * Serve Tennis (ClubSpark) live feed — read-only.
 *
 * The tournament desk is the source of truth. We never write to it. This
 * module fetches the published match feed, normalises the bits we care
 * about, and works out what is NEW since the last poll so the announcer
 * only ever calls a match once.
 *
 * Discovered by reading the public venue-tournaments bundle:
 *   endpoint  POST https://prd-usta-kube-tournamentdesk-public-api.clubspark.pro
 *   query     tournamentMatchUps(tournamentId: ID!) -> JSON
 *   auth      Authorization: <X-Api-Token from /account/tokens on playtennis.usta.com>
 *   CORS      access-control-allow-origin: * (so this runs straight from the browser)
 *
 * Note the feed carries schedule.startTime but NO end time, so match
 * durations cannot be read from it — they have to be observed locally by
 * noticing when a match stops being IN_PROGRESS. See observeCompletions().
 */

export const SERVE_TENNIS_ENDPOINT =
  'https://prd-usta-kube-tournamentdesk-public-api.clubspark.pro';

export const MATCHUPS_QUERY =
  'query TournamentMatchUps($tournamentId: ID!) { tournamentMatchUps(tournamentId: $tournamentId) }';

export type MatchUpStatus =
  | 'TO_BE_PLAYED'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'DEFAULTED'
  | 'RETIRED'
  | 'WALKOVER'
  | string;

/** Only the fields we actually rely on; the feed carries far more. */
export interface RawMatchUp {
  matchUpId: string;
  eventName?: string;
  roundName?: string;
  abbreviatedRoundName?: string;
  matchUpStatus?: MatchUpStatus;
  structureName?: string;
  readyToScore?: boolean;
  allParticipantsCheckedIn?: boolean;
  checkedInParticipantIds?: string[];
  schedule?: {
    scheduledDate?: string;
    scheduledTime?: string;
    startTime?: string;
    courtName?: string;
    courtId?: string;
    venueName?: string;
  };
  sides?: Array<{
    sideNumber?: number;
    participant?: { participantName?: string };
    participantName?: string;
  }>;
}

export interface Feed {
  dateMatchUps?: RawMatchUp[];
  completedMatchUps?: RawMatchUp[];
  courtsData?: Array<{
    courtName?: string;
    dateAvailability?: Array<{ date?: string; startTime?: string; endTime?: string }>;
  }>;
  venues?: Array<{ courts?: Array<{ courtName?: string }> }>;
}

export interface NormalisedMatch {
  id: string;
  /** "Girls' 14 & under singles" */
  event: string;
  /** "Quarterfinals" */
  round: string;
  /** "Main" | "Consolation" | "Playoff 3-4" — drives the duration estimate. */
  structure: string;
  /** "5" — stripped of the venue prefix Serve Tennis prepends. */
  court: string | null;
  courtRaw: string | null;
  status: MatchUpStatus;
  /** Actual start, "HH:MM", when the desk has started the match. */
  startTime: string | null;
  /** Scheduled time, "HH:MM". */
  scheduledTime: string | null;
  scheduledDate: string | null;
  playerA: string;
  playerB: string;
  allCheckedIn: boolean;
}

type RawSide = NonNullable<RawMatchUp['sides']>[number];

function sideName(side: RawSide | undefined): string {
  return side?.participant?.participantName || side?.participantName || 'TBD';
}

/**
 * Court names arrive as "SHSTC 5". Announcing "es aitch es tee see five"
 * would be absurd, so we keep only the trailing court designator and fall
 * back to the raw string if it doesn't match that shape.
 */
export function shortCourt(courtName: string | null | undefined): string | null {
  if (!courtName) return null;
  const trimmed = courtName.trim();
  const m = trimmed.match(/([0-9]+[A-Za-z]?)\s*$/);
  return m ? m[1] : trimmed;
}

export function normalise(raw: RawMatchUp): NormalisedMatch {
  const sides = raw.sides ?? [];
  const a = sides.find((s) => s.sideNumber === 1) ?? sides[0];
  const b = sides.find((s) => s.sideNumber === 2) ?? sides[1];
  return {
    id: raw.matchUpId,
    event: raw.eventName ?? '',
    round: raw.roundName || raw.abbreviatedRoundName || '',
    structure: raw.structureName ?? '',
    court: shortCourt(raw.schedule?.courtName),
    courtRaw: raw.schedule?.courtName ?? null,
    status: raw.matchUpStatus ?? 'TO_BE_PLAYED',
    startTime: raw.schedule?.startTime ?? null,
    scheduledTime: raw.schedule?.scheduledTime ?? null,
    scheduledDate: raw.schedule?.scheduledDate ?? null,
    playerA: sideName(a),
    playerB: sideName(b),
    allCheckedIn: Boolean(raw.allParticipantsCheckedIn),
  };
}

export function normaliseFeed(feed: Feed): {
  live: NormalisedMatch[];
  completed: NormalisedMatch[];
  courts: string[];
} {
  return {
    live: (feed.dateMatchUps ?? []).map(normalise),
    completed: (feed.completedMatchUps ?? []).map(normalise),
    courts: courtNames(feed),
  };
}

/**
 * Courts Serve Tennis says are available on a given date, shortened for
 * display. Falls back to every known court when the feed carries no
 * availability, because an empty court list breaks the wait maths far
 * worse than an over-generous one.
 *
 * Note this is what the venue MADE available, not necessarily what the
 * director is actually using today — he may hold two back for members. The
 * announcer lets him switch courts off on top of this.
 */
export function courtsAvailableOn(feed: Feed, isoDate: string): string[] {
  const rows = feed.courtsData ?? [];
  const available = rows
    .filter((c) =>
      (c?.dateAvailability ?? []).some((a) => (a?.date ?? '').slice(0, 10) === isoDate)
    )
    .map((c) => shortCourt(c?.courtName))
    .filter((n): n is string => Boolean(n));

  const list = available.length ? available : courtNames(feed);
  return [...new Set(list)].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

/**
 * Every court at the venue, shortened for display ("SHSTC 7" -> "7").
 *
 * The wait maths depends on this being the real count. The desk assigns
 * courts only as it calls matches, so without the venue's court list the
 * simulation has nowhere to put anything and stacks the whole day onto one
 * imaginary court.
 */
export function courtNames(feed: Feed): string[] {
  const raw = [
    ...(feed.courtsData ?? []).map((c) => c?.courtName),
    ...(feed.venues ?? []).flatMap((v) => (v?.courts ?? []).map((c) => c?.courtName)),
  ].filter((n): n is string => Boolean(n));

  const short = raw.map((n) => shortCourt(n)).filter((n): n is string => Boolean(n));
  return [...new Set(short)].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

export async function fetchFeed(
  tournamentId: string,
  token: string,
  signal?: AbortSignal
): Promise<Feed> {
  const res = await fetch(SERVE_TENNIS_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: token },
    body: JSON.stringify({ query: MATCHUPS_QUERY, variables: { tournamentId } }),
    signal,
  });
  const json = await res.json();
  if (json.errors?.length) {
    const msg = json.errors[0]?.message ?? 'unknown error';
    // The desk token is short-lived; surface expiry distinctly so the UI
    // can tell Darrin to re-click the bookmarklet instead of showing a
    // generic failure he can't act on.
    const err = new Error(msg) as Error & { code?: string };
    if (/not auth/i.test(msg)) err.code = 'TOKEN_EXPIRED';
    throw err;
  }
  return (json.data?.tournamentMatchUps ?? {}) as Feed;
}

/**
 * A match is announceable once the desk has put it on a court and it is
 * actually under way. We key on court + status rather than on any "called"
 * flag because Serve Tennis has no such concept — the act of assigning a
 * court IS the call.
 */
export function isAnnounceable(m: NormalisedMatch): boolean {
  return Boolean(m.court) && (m.status === 'IN_PROGRESS' || Boolean(m.startTime));
}

/**
 * Which matches to announce this poll.
 *
 * `announced` is the set of ids already spoken. On the very first poll of
 * a session we return nothing and seed the set instead — otherwise opening
 * the page mid-afternoon would announce every match played so far, which
 * is exactly the sort of thing that gets a tool switched off on day one.
 */
export function diffForAnnouncement(
  live: NormalisedMatch[],
  announced: Set<string>,
  opts: { seedOnly?: boolean } = {}
): { toAnnounce: NormalisedMatch[]; nextAnnounced: Set<string> } {
  const next = new Set(announced);
  const toAnnounce: NormalisedMatch[] = [];

  for (const m of live) {
    if (!isAnnounceable(m)) continue;
    if (next.has(m.id)) continue;
    next.add(m.id);
    if (!opts.seedOnly) toAnnounce.push(m);
  }
  return { toAnnounce: opts.seedOnly ? [] : toAnnounce, nextAnnounced: next };
}

/**
 * Watch matches leaving IN_PROGRESS so we can time them ourselves. The
 * feed gives us a start time but never an end time, so the moment a match
 * disappears from the in-progress set is the best end timestamp available.
 * Slightly late by up to one poll interval, which is irrelevant against
 * match lengths measured in tens of minutes.
 */
export function observeCompletions(
  previousLive: NormalisedMatch[],
  currentLive: NormalisedMatch[],
  now: Date
): Array<{ id: string; startTime: string; endedAt: string }> {
  const stillLive = new Set(
    currentLive.filter((m) => m.status === 'IN_PROGRESS').map((m) => m.id)
  );
  return previousLive
    .filter((m) => m.status === 'IN_PROGRESS' && m.startTime && !stillLive.has(m.id))
    .map((m) => ({ id: m.id, startTime: m.startTime!, endedAt: now.toISOString() }));
}

/** "HH:MM" on a given date -> Date, in the browser's local zone (the club's). */
export function timeToDate(hhmm: string, onDate: Date): Date {
  const [h, min] = hhmm.split(':').map(Number);
  const d = new Date(onDate);
  d.setHours(h, min ?? 0, 0, 0);
  return d;
}

/**
 * The spoken line. Kept short on purpose: over a PA, in the open air, with
 * kids and parents talking, anything longer than about two breaths stops
 * being heard. Court first because it's the only bit that tells a player
 * where to go, and repeated at the end because that's the bit people miss.
 */
export function announcementText(m: NormalisedMatch): string {
  const court = m.court ?? 'the desk';
  const event = spokenEvent(m.event);
  const round = m.round ? `, ${spokenRound(m.round)}` : '';
  return `Attention please. On court ${court}, ${event}${round}. ${m.playerA} versus ${m.playerB}. Players report to court ${court}.`;
}

/**
 * Round names arrive in draw-sheet shorthand — "C-Quarterfinals-Q",
 * "PL-Final", "R16" — which a speech engine reads out as "see quarterfinals
 * cue". Over a PA that is worse than saying nothing, so we spell them out.
 *
 *   C-   consolation draw
 *   PL-  playoff (3rd/4th)
 *   -Q   qualifying marker, meaningless to a player standing on court
 *
 * Singular throughout: one match is being called, not the whole round.
 */
export function spokenRound(roundName: string): string {
  if (!roundName) return '';
  let s = roundName.trim();
  let prefix = '';

  if (/^C-/i.test(s)) { prefix = 'consolation '; s = s.slice(2); }
  else if (/^PL-/i.test(s)) { prefix = 'playoff '; s = s.slice(3); }

  s = s.replace(/-Q$/i, '');

  const NAMES: Record<string, string> = {
    'quarterfinals': 'quarterfinal',
    'quarterfinal': 'quarterfinal',
    'semifinals': 'semifinal',
    'semifinal': 'semifinal',
    'final': 'final',
    'r16': 'round of sixteen',
    'r32': 'round of thirty two',
    'r64': 'round of sixty four',
  };

  const key = s.toLowerCase();
  return (prefix + (NAMES[key] ?? s.replace(/-/g, ' ').toLowerCase())).trim();
}

/**
 * "Girls' 14 & under singles" -> "girls fourteen and under singles".
 * The ampersand and the apostrophe both trip up TTS, and digits get read
 * inconsistently, so we spell the common age groups out.
 */
export function spokenEvent(eventName: string): string {
  if (!eventName) return 'singles';
  const AGES: Record<string, string> = {
    '10': 'ten', '12': 'twelve', '14': 'fourteen',
    '16': 'sixteen', '18': 'eighteen',
  };
  return eventName
    .replace(/&/g, ' and ')
    .replace(/'/g, '')
    .replace(/\b(\d{2})\b/g, (_, d) => AGES[d] ?? d)
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}
