/**
 * CourtConnect "one link runs the night" — shared, pure logic (safe in the browser).
 *
 *   clubmode.ai/play      a host says what they want in one sentence → we build the event
 *   clubmode.ai/p/<code>  the one link: invite + RSVP → live courts on every phone → recap
 *
 * Pairing is the same RoundGenerator MixerMode uses (via guestMixer).
 */
import { standings, type GuestFormat, type GuestMixer } from '@/lib/mixer/guestMixer';

export type Sport = 'tennis' | 'pickleball';
export type PlayKind = 'game' | 'social';
export type PlayStatus = 'open' | 'live' | 'done';

/** What a sentence turns into. Every field is editable before the event is made. */
export interface PlayDraft {
  title: string;
  sport: Sport;
  kind: PlayKind;
  format: GuestFormat;
  when_text: string | null;
  starts_at: string | null; // ISO
  location: string | null;
  level: string | null;
  spots: number;
  courts: number;
  round_minutes: number;
  notes: string | null;
}

export interface PlayRsvp {
  id: string;
  name: string;
  gender: 'male' | 'female' | null;
  level: string | null;
  status: 'in' | 'wait' | 'out';
  is_host: boolean;
  created_at: string;
}

export interface PlayState {
  mixer?: GuestMixer;
  roundStartedAt?: string | null;
  nextCode?: string | null;
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
  crown?: { slug: string; place: string; king: { name: string; wins: number } | null; queen: { name: string; wins: number } | null } | null;
}

export const SPORT_LABEL: Record<Sport, string> = { tennis: 'Tennis', pickleball: 'Pickleball' };

export function clampInt(v: unknown, lo: number, hi: number, dflt: number): number {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
}

/** Players one court holds in this format. */
export const perCourt = (f: GuestFormat) => (f === 'singles' ? 2 : 4);

/** Fill in anything missing and keep every number in range. */
export function normalizeDraft(d: Partial<PlayDraft>): PlayDraft {
  const sport: Sport = d.sport === 'pickleball' ? 'pickleball' : 'tennis';
  const format: GuestFormat = d.format === 'singles' || d.format === 'mixed-doubles' ? d.format : 'doubles';
  const spots = clampInt(d.spots, 2, 96, format === 'singles' ? 2 : 4);
  const kind: PlayKind = d.kind === 'game' || d.kind === 'social' ? d.kind : spots <= perCourt(format) ? 'game' : 'social';
  const courts = clampInt(d.courts, 1, 24, Math.max(1, Math.floor(spots / perCourt(format))));
  const dflt = kind === 'game' ? 'Doubles' : 'Mixer';
  const str = (v: unknown, n: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : null);
  let starts: string | null = null;
  if (typeof d.starts_at === 'string' && !isNaN(Date.parse(d.starts_at))) starts = new Date(d.starts_at).toISOString();
  return {
    title: str(d.title, 80) || `${SPORT_LABEL[sport]} ${format === 'singles' ? 'Singles' : dflt}`,
    sport, kind, format,
    when_text: str(d.when_text, 80),
    starts_at: starts,
    location: str(d.location, 120),
    level: str(d.level, 40),
    spots, courts,
    round_minutes: clampInt(d.round_minutes, 5, 120, sport === 'pickleball' ? 15 : 20),
    notes: str(d.notes, 300),
  };
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
  if (!spots && courts) spots = courts * perCourt(format);

  const lvl = t.match(/(\d\.\d)\s*(?:-|–|to)\s*(\d\.\d)/) || t.match(/(\d\.\d)\+?/);
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
  const title = `${dayLabel && dayLabel !== 'Today' && dayLabel !== 'Tomorrow' ? dayLabel + ' ' : ''}${format === 'mixed-doubles' ? 'Mixed ' : ''}${sport === 'pickleball' ? 'Pickleball ' : ''}${words[kind]}`;
  return normalizeDraft({ title, sport, kind, format, spots, courts, level, when_text, starts_at, location, notes: null });
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
    if (x.scoreA == null || x.scoreB == null || x.scoreA === x.scoreB) continue;
    const [win, sw, sl] = x.scoreA > x.scoreB ? [x.teamA, x.scoreA, x.scoreB] : [x.teamB, x.scoreB, x.scoreA];
    if (win.length === 2) { const k = [...win].sort().join('|'); const d = duos.get(k) ?? { ids: win, w: 0, diff: 0 }; d.w++; d.diff += sw - sl; duos.set(k, d); }
    if (sw - sl === 1 && (!clutch || sw > clutch.a)) clutch = { ids: win, a: sw, b: sl };
  }
  const duo = [...duos.values()].sort((a, b) => b.w - a.w || b.diff - a.diff)[0];
  if (duo) out.push({ emoji: '🤝', title: 'Best duo', who: duo.ids.map(name).join(' & '), why: duo.w > 1 ? `won all ${duo.w} rounds together` : `won by ${duo.diff} together` });
  if (clutch) out.push({ emoji: '😮‍💨', title: 'Nail-biter', who: clutch.ids.map(name).join(' & '), why: `won ${clutch.a}–${clutch.b}` });
  return out;
}

export function spotsLine(e: Pick<PlayEvent, 'rsvps' | 'spots'>): string {
  const n = e.rsvps.filter((r) => r.status === 'in').length;
  const w = e.rsvps.filter((r) => r.status === 'wait').length;
  return n >= e.spots ? `Full · ${n} in${w ? ` · ${w} waiting` : ''}` : `${n} of ${e.spots} in · ${e.spots - n} spot${e.spots - n === 1 ? '' : 's'} left`;
}

export function whenLine(e: Pick<PlayDraft, 'when_text' | 'starts_at'>, tz?: string): string | null {
  if (e.starts_at) {
    const d = new Date(e.starts_at);
    return d.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', ...(tz ? { timeZone: tz } : {}) }).replace(':00', '');
  }
  return e.when_text;
}
