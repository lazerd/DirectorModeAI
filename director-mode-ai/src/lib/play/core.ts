import { parseLevelRange } from './levels';
/**
 * CourtConnect "one link runs the night" — shared, pure logic (safe in the browser).
 *
 *   clubmode.ai/play      a host says what they want in one sentence → we build the event
 *   clubmode.ai/p/<code>  the one link: invite + RSVP → live courts on every phone → recap
 *
 * Pairing is the same RoundGenerator MixerMode uses (via guestMixer).
 */
import { standings, winnerOf, type GuestFormat, type GuestMixer } from '@/lib/mixer/guestMixer';
import { DRAW_FORMAT_NAME, consolationChampion, drawKind, entryOf, resultOf, scoreWinnerFirst, standingsFor, type Draw, type DrawFormat } from './draw';
import { groupTables } from './drawGroups';

export type Sport = 'tennis' | 'pickleball' | 'padel';
export type PlayKind = 'game' | 'social';
export type PlayStatus = 'open' | 'live' | 'done';
/**
 * A social runs on the mixer (GuestFormat). 'tournament' runs a draw instead: the real
 * draw type (round robin, elimination, consolation, compass) lives in state.drawFormat / state.draw.format.
 */
export type PlayFormat = GuestFormat | 'tournament';
export const isTournament = (e: { format: PlayFormat | string }) => e.format === 'tournament';

/** What a sentence turns into. Every field is editable before the event is made. */
export interface PlayDraft {
  title: string;
  sport: Sport;
  kind: PlayKind;
  format: PlayFormat;
  when_text: string | null;
  starts_at: string | null; // ISO
  location: string | null;
  /** Set when the place was picked from map suggestions: full address and pin. */
  place_address?: string | null;
  place_lat?: number | null;
  place_lng?: number | null;
  level: string | null;
  /** Derived from `level` and the sport's scale (NTRP / DUPR / Playtomic). */
  level_min?: number | null;
  level_max?: number | null;
  /** Shows up in "Games near me" (needs a pinned place). */
  listed?: boolean;
  /** A weekly series: next week's game is made when this one is played. */
  repeat_weekly?: boolean;
  /** Player cap. null = no cap: people sign up and the host checks in whoever shows (MixerMode style). */
  spots: number | null;
  courts: number;
  round_minutes: number;
  notes: string | null;
}

export interface PlayRsvp {
  id: string;
  name: string;
  gender: 'male' | 'female' | null;
  level: string | null;
  level_num?: number | null;
  team?: 'A' | 'B' | null;
  status: 'in' | 'wait' | 'out';
  is_host: boolean;
  created_at: string;
  /** Actually here (checked in by the host or by the player on arrival). Only checked-in players get rounds. */
  checked_in_at?: string | null;
}

export interface PlayState {
  mixer?: GuestMixer;
  roundStartedAt?: string | null;
  /** Round clock paused at this moment (resume shifts roundStartedAt by the pause). */
  pausedAt?: string | null;
  /** The club's court numbers before the night starts (copied into the mixer at start). */
  courtLabels?: string[] | null;
  /** Chosen before the start, copied into the mixer when it starts. */
  pairingPref?: 'smart' | 'random';
  teamSplit?: { singles: number; doubles: number } | null;
  nextCode?: string | null;
  /** A weekly series couldn't make next week's game: the host needs a pass. */
  weeklyPaywall?: boolean;
  teamNames?: { A: string; B: string } | null;
  /** Tournament: the draw type picked before the start (singles / doubles round robin now). */
  drawFormat?: DrawFormat | null;
  /** Tournament, doubles: the host's pairs (rsvp ids) set before the start. Anyone unpaired is auto-paired. */
  drawPairs?: string[][] | null;
  /** Tournament: the host's seed order (rsvp ids, best first) set before the start. Anyone not listed follows by level. */
  drawSeeds?: string[] | null;
  /** Tournament, pools + playoffs: how many pools the host picked (null = by field size). */
  drawPools?: number | null;
  /** Tournament, quads: the scoring format (lib/quads QUAD_SCORING_FORMATS id). */
  drawScoring?: string | null;
  /** Tournament: the live draw (entries, matches, courts). */
  draw?: Draw | null;
  preview?: { headline: string; lines: { id: string; name: string; line: string }[]; at: string } | null;
  recap?: {
    headline: string; story: string; spice: 'mild' | 'club' | 'locker'; crown?: string | null; at: string;
    lines: { id: string; name: string; tag: string; line: string; skipped?: boolean }[];
  } | null;
}

/** The event as the page sees it (never includes the host key). */
export interface PlayEvent extends PlayDraft {
  code: string;
  host_name: string | null;
  status: PlayStatus;
  state: PlayState;
  version: number;
  created_at: string;
  rsvps: PlayRsvp[];
  isHost: boolean;
  me: string | null; // my rsvp id
  prevCode?: string | null;
  /** A weekly series' running table (2+ nights played). */
  season?: { nights: number; rows: { name: string; nights: number; wins: number; losses: number; games: number }[] } | null;
  crown?: { slug: string; place: string; king: { name: string; wins: number } | null; queen: { name: string; wins: number } | null } | null;
}

export const SPORT_LABEL: Record<Sport, string> = { tennis: 'Tennis', pickleball: 'Pickleball', padel: 'Padel' };

export function clampInt(v: unknown, lo: number, hi: number, dflt: number): number {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
}

/** Players one court holds in this format. */
export const perCourt = (f: PlayFormat) => (f === 'singles' || f === 'tournament' ? 2 : 4);

export const FORMAT_NAME: Record<PlayFormat, string> = {
  tournament: 'Tournament',
  'maximize-courts': 'Optimize Courts', 'king-of-court': 'King of the Court', 'team-battle': 'Team Battle', doubles: 'Doubles', 'mixed-doubles': 'Mixed doubles', singles: 'Singles',
};
export const FORMAT_BLURB: Record<PlayFormat, string> = {
  tournament: 'A real draw: round robin, elimination, consolation, compass, quads or pools. Courts fill themselves as matches finish.',
  'maximize-courts': 'Every court full: doubles where it fits, singles with the rest, fewest sit-outs.',
  'king-of-court': 'Winners move up a court, losers move down. Court 1 is the King court.',
  'team-battle': 'Two teams, lines matched by strength like team tennis. Every court counts toward the team score.',
  doubles: 'Rotating doubles partners every round.',
  'mixed-doubles': 'One man and one woman per team, partners rotate.',
  singles: 'One-on-one, new opponent each round.',
};

/** Fill in anything missing and keep every number in range. */
export function normalizeDraft(d: Partial<PlayDraft>): PlayDraft {
  const sport: Sport = d.sport === 'pickleball' || d.sport === 'padel' ? d.sport : 'tennis';
  let format: PlayFormat = d.format === 'singles' || d.format === 'mixed-doubles' || d.format === 'maximize-courts' || d.format === 'king-of-court' || d.format === 'team-battle' || d.format === 'tournament' ? d.format : 'doubles';
  // No player count = no cap (a social where the host checks in whoever shows up).
  let spots = d.spots == null || (d.spots as unknown) === '' ? null : clampInt(d.spots, 2, 96, format === 'singles' ? 2 : 4);
  // A tournament is always an event (never a one-court game).
  const kind: PlayKind = format === 'tournament' ? 'social' : d.kind === 'game' || d.kind === 'social' ? d.kind : spots != null && spots <= perCourt(format) ? 'game' : 'social';
  // A one-court game (a doubles 4some, a singles hit) has a natural size; a social has none.
  if (spots == null && kind === 'game') spots = perCourt(format);
  // A social with plain doubles becomes Optimize Courts unless the host chose otherwise (d.format set explicitly).
  if (kind === 'social' && d.format == null) format = 'maximize-courts';
  const courts = clampInt(d.courts, 1, 24, spots != null ? Math.max(1, Math.floor(spots / perCourt(format))) : kind === 'game' ? 1 : 2);
  const dflt = kind === 'game' ? 'Doubles' : 'Mixer';
  void dflt;
  const str = (v: unknown, n: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : null);
  let starts: string | null = null;
  if (typeof d.starts_at === 'string' && !isNaN(Date.parse(d.starts_at))) starts = new Date(d.starts_at).toISOString();
  return {
    title: str(d.title, 80) || `${SPORT_LABEL[sport]} ${format === 'tournament' ? 'Round Robin' : format === 'singles' ? 'Singles' : kind === 'game' ? 'Doubles' : 'Mixer'}`,
    sport, kind, format,
    when_text: str(d.when_text, 80),
    starts_at: starts,
    location: str(d.location, 120),
    ...normalizePlace(d),
    level: str(d.level, 40),
    ...(() => { const r = parseLevelRange(str(d.level, 40), sport); return { level_min: r?.min ?? null, level_max: r?.max ?? null }; })(),
    listed: d.listed === true,
    repeat_weekly: d.repeat_weekly === true,
    spots, courts,
    round_minutes: clampInt(d.round_minutes, 5, 120, sport === 'pickleball' ? 15 : 20),
    notes: str(d.notes, 300),
  };
}

/** A pin only counts with a name next to it and real coordinates. */
function normalizePlace(d: Partial<PlayDraft>): Pick<PlayDraft, 'place_address' | 'place_lat' | 'place_lng'> {
  const lat = Number(d.place_lat), lng = Number(d.place_lng);
  const ok = !!(typeof d.location === 'string' && d.location.trim()) && d.place_lat != null && d.place_lng != null
    && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
  const addr = typeof d.place_address === 'string' && d.place_address.trim() ? d.place_address.trim().slice(0, 200) : null;
  return ok ? { place_address: addr, place_lat: lat, place_lng: lng } : { place_address: addr && d.location ? addr : null, place_lat: null, place_lng: null };
}

/** Directions that open the phone's maps app (Apple Maps on iPhone, Google elsewhere). */
export function directionsUrl(e: Pick<PlayDraft, 'location' | 'place_address' | 'place_lat' | 'place_lng'>, apple = false): string | null {
  const q = [e.location, e.place_address].filter(Boolean).join(', ');
  if (!q && e.place_lat == null) return null;
  const pin = e.place_lat != null && e.place_lng != null ? `${e.place_lat},${e.place_lng}` : '';
  if (apple) return `https://maps.apple.com/?${pin ? `daddr=${pin}&q=${encodeURIComponent(e.location ?? '')}` : `daddr=${encodeURIComponent(q)}`}`;
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(pin || q)}`;
}

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

/**
 * The no-AI reading of a sentence. Good enough on its own; the AI version
 * (server) improves titles and odd phrasings. `now` is the host's local clock.
 */
export function parseSentence(text: string, now = new Date()): PlayDraft {
  const t = ' ' + text.toLowerCase().replace(/\s+/g, ' ') + ' ';
  const sport: Sport = /pickle|dupr|\bpb\b/.test(t) ? 'pickleball' : 'tennis';
  const format: GuestFormat = /mixed/.test(t) ? 'mixed-doubles' : /singles|\bhit\b|hitting/.test(t) && !/doubles/.test(t) ? 'singles' : 'doubles';

  let spots: number | undefined;
  const mPlayers = t.match(/(\d{1,2})\s*(?:players|people|ppl|guys|ladies|of us|person)/) || t.match(/\bfor (\d{1,2})\b/);
  if (mPlayers) spots = +mPlayers[1];
  const need = t.match(/need (?:a |one )?(\d|one|two|three|a fourth|4th|fourth)\s*(?:more)?/);
  if (!spots && need) spots = format === 'singles' ? 2 : 4;
  const mCourts = t.match(/(\d{1,2})\s*courts?/);
  const courts = mCourts ? +mCourts[1] : undefined;
  // Courts alone don't cap the players: whoever shows up gets checked in.

  const lvl = t.match(/(\d\.\d{1,2})\s*(?:-|–|to)\s*(\d\.\d{1,2})/) || t.match(/(\d\.\d{1,2})\+?/);
  const level = lvl ? (lvl[2] ? `${lvl[1]}–${lvl[2]}` : lvl[0].trim()) : /beginner|advanced|intermediate/.exec(t)?.[0] ?? null;

  // when
  let day: Date | null = null, dayLabel = '';
  if (/\btonight\b|\btoday\b/.test(t)) { day = new Date(now); dayLabel = /tonight/.test(t) ? 'Tonight' : 'Today'; }
  else if (/\btomorrow\b/.test(t)) { day = new Date(now); day.setDate(day.getDate() + 1); dayLabel = 'Tomorrow'; }
  else {
    const di = DAYS.findIndex((d) => t.includes(' ' + d) || t.includes(' ' + d.slice(0, 3) + ' '));
    if (di >= 0) { day = new Date(now); day.setDate(day.getDate() + ((di - now.getDay() + 7) % 7)); dayLabel = DAYS[di][0].toUpperCase() + DAYS[di].slice(1); } // "Friday" said on a Friday = today
  }
  const tm = t.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)/) || t.match(/\bat (\d{1,2})(?::(\d{2}))?\b/);
  let starts_at: string | null = null, timeLabel = '';
  if (tm) {
    let h = +tm[1]; const mi = tm[2] ? +tm[2] : 0; const ap = tm[3]?.[0];
    if (ap === 'p' && h < 12) h += 12; if (ap === 'a' && h === 12) h = 0;
    if (!ap && h < 8) h += 12; // "at 6" means evening
    timeLabel = `${((h + 11) % 12) + 1}${mi ? ':' + String(mi).padStart(2, '0') : ''}${h < 12 ? 'am' : 'pm'}`;
    const d = day ? new Date(day) : new Date(now);
    d.setHours(h, mi, 0, 0);
    if (!day && d < now) d.setDate(d.getDate() + 1);
    starts_at = d.toISOString();
    if (!dayLabel) dayLabel = d.toDateString() === now.toDateString() ? 'Today' : 'Tomorrow';
  }
  const when_text = [dayLabel, timeLabel].filter(Boolean).join(' ') || null;

  const loc = text.match(/\b(?:at|@)\s+([A-Z][\w'’&.-]*(?:\s+[A-Z][\w'’&.-]*){0,4})/);
  const location = loc && !/^\d/.test(loc[1]) ? loc[1].trim() : null;

  const kind: PlayKind = /mixer|social|round ?robin|party|king of/.test(t) ? 'social' : spots && spots > perCourt(format) ? 'social' : 'game';
  const words = { game: format === 'singles' ? 'Singles' : 'Doubles', social: /round ?robin/.test(t) ? 'Round Robin' : 'Mixer' };
  const title = `${dayLabel && dayLabel !== 'Today' && dayLabel !== 'Tomorrow' ? dayLabel + ' ' : ''}${format === 'mixed-doubles' ? 'Mixed ' : ''}${sport === 'tennis' ? '' : SPORT_LABEL[sport] + ' '}${words[kind]}`;
  const fmt: GuestFormat = /team battle|\bvs\.? (the )?|us vs them|ryder cup|davis cup|club vs/.test(t) && kind === 'social' ? 'team-battle' : /king of (the )?court|up and down the river/.test(t) ? 'king-of-court' : kind === 'social' && format === 'doubles' && !/\bdoubles only\b/.test(t) ? 'maximize-courts' : format;
  return normalizeDraft({ title, sport, kind, format: fmt, spots, courts, level, when_text, starts_at, location, notes: null });
}

/* ---------------- the recap: awards people screenshot ---------------- */
export interface Award { emoji: string; title: string; who: string; why: string }

export function awards(m: GuestMixer): Award[] {
  const st = standings(m);
  if (!st.length) return [];
  const name = (id: string) => m.players.find((p) => p.id === id)?.name ?? '?';
  const out: Award[] = [];
  const champ = st[0];
  out.push({ emoji: '🏆', title: 'Champion', who: champ.name, why: `${champ.wins}–${champ.losses}, ${champ.gamesFor} games won` });
  const used = new Set([champ.id]);
  const pick = (rows: typeof st, f: (s: (typeof st)[0]) => number, min = 2) =>
    rows.filter((s) => s.played >= min && !used.has(s.id)).sort((a, b) => f(b) - f(a))[0];
  const wall = pick(st, (s) => -(s.gamesAgainst / s.played));
  if (wall) { used.add(wall.id); out.push({ emoji: '🧱', title: 'The Wall', who: wall.name, why: `gave up ${(wall.gamesAgainst / wall.played).toFixed(1)} games a round` }); }
  const most = pick(st, (s) => s.gamesFor);
  if (most) { used.add(most.id); out.push({ emoji: '🔥', title: 'Most games won', who: most.name, why: `${most.gamesFor} games` }); }
  // best duo + nail-biters
  const duos = new Map<string, { ids: string[]; w: number; diff: number }>();
  let clutch: { ids: string[]; a: number; b: number } | null = null;
  for (const r of m.rounds) for (const x of r.matches) {
    const wn = winnerOf(x);
    if (!wn || x.scoreA == null || x.scoreB == null) continue;
    const [win, sw, sl] = wn === 'A' ? [x.teamA, x.scoreA, x.scoreB] : [x.teamB, x.scoreB, x.scoreA];
    if (win.length === 2) { const k = [...win].sort().join('|'); const d = duos.get(k) ?? { ids: win, w: 0, diff: 0 }; d.w++; d.diff += sw - sl; duos.set(k, d); }
    if (sw - sl === 1 && (!clutch || sw > clutch.a)) clutch = { ids: win, a: sw, b: sl };
  }
  const duo = [...duos.values()].sort((a, b) => b.w - a.w || b.diff - a.diff)[0];
  if (duo) out.push({ emoji: '🤝', title: 'Best duo', who: duo.ids.map(name).join(' & '), why: duo.w > 1 ? `won all ${duo.w} rounds together` : `won by ${duo.diff} together` });
  if (clutch) out.push({ emoji: '😮‍💨', title: 'Nail-biter', who: clutch.ids.map(name).join(' & '), why: `won ${clutch.a}–${clutch.b}` });
  const slayer = giantSlayer(m);
  if (slayer) out.push({ emoji: '🗡️', title: 'Giant Slayer', who: slayer.ids.map(name).join(' & '), why: `beat a side rated ${fmtLvl(slayer.gap)} higher, ${slayer.a}–${slayer.b}` });
  const steady = mostConsistent(m);
  if (steady) out.push({ emoji: '🎯', title: 'Most Consistent', who: name(steady.id), why: `game diff ${sgn(steady.min)} to ${sgn(steady.max)} over ${steady.n} matches` });
  return out;
}

/**
 * A tournament's awards: Champion, Finalist (Runner-up in a round robin), Consolation
 * champion (brackets with a back draw), Biggest upset by seed, Most games won.
 * Only real results count (BYEs never do; a walkover or default is no upset).
 */
export function drawAwards(d: Draw): Award[] {
  const st = standingsFor(d);
  const real = d.matches.filter((m) => m.status === 'done' && !m.bye);
  if (!st.length || !real.length) return [];
  const out: Award[] = [];
  const rr = drawKind(d.format) === 'rr';
  const rec = (s: (typeof st)[0]) => `${s.wins}–${s.losses}, ${s.gamesWon} games won`;
  if (drawKind(d.format) === 'quads') return quadsAwards(d, st, real, out, rec);
  const champ = rr ? (st[0].played ? st[0] : null) : st.find((s) => s.label === 'Champion' || (s.place === 1 && s.label === '1st'));
  if (champ) out.push({ emoji: '🏆', title: 'Champion', who: champ.name, why: rr ? rec(champ) : `${rec(champ)}${champ.seed ? ` · No. ${champ.seed} seed` : ''}` });
  const second = rr ? (champ && st[1]?.played ? st[1] : null) : st.find((s) => s.label === 'Finalist' || (s.place === 2 && s.label === '2nd'));
  if (second) out.push({ emoji: '🥈', title: rr ? 'Runner-up' : 'Finalist', who: second.name, why: rec(second) });
  const cc = consolationChampion(d);
  const ccRow = cc ? st.find((s) => s.id === cc) : null;
  if (ccRow) out.push({ emoji: '🎖️', title: 'Consolation champion', who: ccRow.name, why: `won the back draw · ${ccRow.wins}–${ccRow.losses}` });
  let upset: { w: string; l: string; gap: number; score: string } | null = null;
  for (const m of real) {
    if (m.how === 'W/O' || m.how === 'DEF') continue;
    const r = resultOf(m);
    const w = r && entryOf(d, r.winner), l = r && entryOf(d, r.loser);
    if (!w || !l) continue;
    const gap = w.seed - l.seed;
    if (gap >= 2 && (!upset || gap > upset.gap)) upset = { w: w.id, l: l.id, gap, score: scoreWinnerFirst(m) };
  }
  if (upset) {
    const w = entryOf(d, upset.w)!, l = entryOf(d, upset.l)!;
    out.push({ emoji: '🗡️', title: 'Biggest upset', who: w.name, why: `No. ${w.seed} seed beat No. ${l.seed} ${l.name}${upset.score ? `, ${upset.score}` : ''}` });
  }
  const most = [...st].sort((a, b) => b.gamesWon - a.gamesWon || a.rank - b.rank)[0];
  if (most && most.gamesWon > 0) out.push({ emoji: '🔥', title: 'Most games won', who: most.name, why: `${most.gamesWon} games in ${most.played} match${most.played === 1 ? '' : 'es'}` });
  return out;
}

/**
 * Quads: every flight crowns its own winner (MixerMode: most games over all four rounds).
 * The top flight's is the Champion; the rest are "Flight B champion", ... Then the biggest
 * singles upset by seed and the most games won.
 */
function quadsAwards(d: Draw, st: ReturnType<typeof standingsFor>, real: Draw['matches'], out: Award[], rec: (s: ReturnType<typeof standingsFor>[0]) => string): Award[] {
  for (const [i, t] of groupTables(d, String).entries()) {
    const top = t.rows[0]?.label === 'Champion' ? st.find((s) => s.id === t.rows[0].id) : null;
    if (!top) continue;
    out.push({ emoji: i === 0 ? '🏆' : '🏅', title: i === 0 ? 'Champion' : `${t.group.name} champion`, who: top.name, why: `${i === 0 ? `won ${t.group.name} · ` : ''}${rec(top)}` });
  }
  let upset: { w: string; l: string; gap: number; score: string } | null = null;
  for (const m of real) {
    if (m.match_type !== 'singles' || m.how === 'W/O' || m.how === 'DEF') continue;
    const r = resultOf(m);
    const w = r && entryOf(d, r.winner), l = r && entryOf(d, r.loser);
    if (!w || !l) continue;
    const gap = w.seed - l.seed;
    if (gap >= 2 && (!upset || gap > upset.gap)) upset = { w: w.id, l: l.id, gap, score: scoreWinnerFirst(m) };
  }
  if (upset) {
    const w = entryOf(d, upset.w)!, l = entryOf(d, upset.l)!;
    out.push({ emoji: '🗡️', title: 'Biggest upset', who: w.name, why: `No. ${w.seed} seed beat No. ${l.seed} ${l.name}${upset.score ? `, ${upset.score}` : ''}` });
  }
  const most = [...st].sort((a, b) => b.gamesWon - a.gamesWon || a.rank - b.rank)[0];
  if (most && most.gamesWon > 0) out.push({ emoji: '🔥', title: 'Most games won', who: most.name, why: `${most.gamesWon} games in ${most.played} match${most.played === 1 ? '' : 'es'}` });
  return out;
}

const fmtLvl = (n: number) => String(+n.toFixed(2));
const sgn = (n: number) => (n > 0 ? `+${n}` : String(n));

/** A level gap this big (half a step on NTRP / DUPR / Playtomic) is a real upset, not noise. */
export const GIANT_GAP = 0.5;

/**
 * MixerMode's Giant Slayer: the biggest win over a side whose average level is
 * clearly higher. Only matches where every player on both sides has a level count.
 */
export function giantSlayer(m: GuestMixer): { ids: string[]; gap: number; a: number; b: number } | null {
  const lvl = new Map(m.players.map((p) => [p.id, p.level]));
  const avg = (ids: string[]) => {
    const v = ids.map((id) => lvl.get(id));
    return v.length && v.every((x) => x != null && Number.isFinite(x)) ? (v as number[]).reduce((s, x) => s + x, 0) / v.length : null;
  };
  let best: { ids: string[]; gap: number; a: number; b: number } | null = null;
  for (const r of m.rounds) for (const x of r.matches) {
    const wn = winnerOf(x);
    if (!wn || x.scoreA == null || x.scoreB == null) continue;
    const [win, lose, sw, sl] = wn === 'A' ? [x.teamA, x.teamB, x.scoreA, x.scoreB] : [x.teamB, x.teamA, x.scoreB, x.scoreA];
    const wa = avg(win), la = avg(lose);
    if (wa == null || la == null) continue;
    const gap = la - wa;
    if (gap < GIANT_GAP - 1e-9) continue;
    if (!best || gap > best.gap + 1e-9 || (Math.abs(gap - best.gap) < 1e-9 && sw - sl > best.a - best.b)) best = { ids: win, gap, a: sw, b: sl };
  }
  return best;
}

/**
 * MixerMode's Most Consistent: the player whose game differential moved the least
 * from match to match (smallest standard deviation), over 3+ scored matches.
 * Ties go to the better average differential.
 */
export function mostConsistent(m: GuestMixer): { id: string; n: number; sd: number; mean: number; min: number; max: number } | null {
  const diffs = new Map<string, number[]>();
  for (const r of m.rounds) for (const x of r.matches) {
    if (!winnerOf(x) || x.scoreA == null || x.scoreB == null) continue;
    for (const id of x.teamA) diffs.set(id, [...(diffs.get(id) ?? []), x.scoreA - x.scoreB]);
    for (const id of x.teamB) diffs.set(id, [...(diffs.get(id) ?? []), x.scoreB - x.scoreA]);
  }
  let best: { id: string; n: number; sd: number; mean: number; min: number; max: number } | null = null;
  for (const [id, d] of diffs) {
    if (d.length < 3) continue;
    const mean = d.reduce((s, x) => s + x, 0) / d.length;
    const sd = Math.sqrt(d.reduce((s, x) => s + (x - mean) ** 2, 0) / d.length);
    const row = { id, n: d.length, sd, mean, min: Math.min(...d), max: Math.max(...d) };
    if (!best || sd < best.sd - 1e-9 || (Math.abs(sd - best.sd) < 1e-9 && mean > best.mean)) best = row;
  }
  return best;
}

/** "Round Robin · Doubles" for a tournament, the mixer format's name otherwise. */
export function formatLabel(e: { format: PlayFormat; state?: PlayState | null }): string {
  if (e.format !== 'tournament') return FORMAT_NAME[e.format];
  const f = e.state?.draw?.format ?? e.state?.drawFormat ?? 'rr-singles';
  return DRAW_FORMAT_NAME[f] ?? FORMAT_NAME.tournament;
}

export function spotsLine(e: Pick<PlayEvent, 'rsvps' | 'spots'>): string {
  const n = e.rsvps.filter((r) => r.status === 'in').length;
  const w = e.rsvps.filter((r) => r.status === 'wait').length;
  const here = e.rsvps.filter((r) => r.status !== 'out' && r.checked_in_at).length;
  const hereTxt = here ? ` · ${here} here` : '';
  if (e.spots == null) return `${n} in${hereTxt} · all welcome`;
  return n >= e.spots ? `Full · ${n} in${w ? ` · ${w} waiting` : ''}${hereTxt}` : `${n} of ${e.spots} in · ${e.spots - n} spot${e.spots - n === 1 ? '' : 's'} left${hereTxt}`;
}

/** Players who are actually here (checked in) and still in the event. The playing host counts: they press Start at the courts. */
export function checkedIn(e: Pick<PlayEvent, 'rsvps'>): PlayRsvp[] {
  return e.rsvps.filter((r) => r.status !== 'out' && (!!r.checked_in_at || (r.is_host && r.status === 'in')));
}

export function whenLine(e: Pick<PlayDraft, 'when_text' | 'starts_at'>, tz?: string): string | null {
  if (e.starts_at) {
    const d = new Date(e.starts_at);
    return d.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', ...(tz ? { timeZone: tz } : {}) }).replace(':00', '');
  }
  return e.when_text;
}

/** How a format fills the courts for this many players (mirrors RoundGenerator's maximize-courts policy). */
export function courtPlan(format: PlayFormat, players: number, courts: number): { doubles: number; singles: number; sit: number } {
  if (format === 'singles' || format === 'tournament') { const s = Math.min(courts, Math.floor(players / 2)); return { doubles: 0, singles: s, sit: players - 2 * s }; }
  if (format === 'team-battle') { const n = Math.floor(players / 2); const d = Math.min(courts, Math.floor(n / 2)); const s = Math.min(courts - d, n - 2 * d); return { doubles: d, singles: s, sit: players - 4 * d - 2 * s }; }
  if (format !== 'maximize-courts') { const d = Math.min(courts, Math.floor(players / 4)); return { doubles: d, singles: 0, sit: players - 4 * d }; }
  const d = Math.min(Math.floor(players / 4), courts);
  let s = Math.min(Math.floor((players - 4 * d) / 2), courts - d);
  if (d + s < courts && players > 4 * d + 2 * s) s += Math.min(courts - d - s, Math.floor((players - 4 * d - 2 * s) / 2));
  return { doubles: d, singles: s, sit: players - 4 * d - 2 * s };
}
