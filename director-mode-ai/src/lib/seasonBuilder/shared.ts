/**
 * Season Builder — the shapes and rules shared by the player form, the director
 * dashboard and the API. Pure: no DB, safe to import from client components.
 */

export type Slot = 'day' | 'nights_weekends';

export type League = {
  key: string;
  label: string;
  /** Who may join: a women's league, a men's league, or mixed (anyone). */
  gender: 'female' | 'male' | 'mixed';
  /** USTA age floor. A 40+ player must turn 40 by Dec 31 of the season year. */
  min_age: number;
  /** Which schedules this league runs. Men's 40+ is nights/weekends only. */
  slots: Slot[];
  /** USTA membership must not expire before this date (ISO). */
  valid_through: string;
};

export type Choice = { league: string; slot: Slot };

export type Campaign = {
  id: string;
  club_id: string;
  title: string;
  intro: string | null;
  sign_off: string | null;
  registration_opens: string | null;
  reply_by: string | null;
  season_start: string | null;
  season_end: string | null;
  leagues: League[];
  public_token: string;
  status: 'draft' | 'sent' | 'closed';
  sent_at: string | null;
};

export type Answer = {
  interested: boolean;
  gender: 'female' | 'male' | null;
  ntrp: string | null;
  choices: Choice[];
  role: 'captain' | 'play' | null;
  age_ok: boolean | null;
  usta_expires: string | null; // 'YYYY-MM' from the form
  usta_unknown: boolean;
  notes: string | null;
};

export const SLOT_LABEL: Record<Slot, string> = {
  day: 'Daytime — weekdays, about 10am',
  nights_weekends: 'Nights & weekends — home matches Sat/Sun',
};

/** How a schedule reads inside a sentence (emails, newsletter). */
export const SLOT_PHRASE: Record<Slot, string> = {
  day: 'daytime (weekdays, about 10am)',
  nights_weekends: 'nights & weekends (home matches Sat/Sun)',
};

export const SLOT_SHORT: Record<Slot, string> = { day: 'Day', nights_weekends: 'Nights/Wknd' };

export const NTRP_LEVELS = ['2.5', '3.0', '3.5', '4.0', '4.5', '5.0'];
export const NTRP_UNRATED = 'unrated';

export function ntrpLabel(n: string | null): string {
  if (!n) return '—';
  return n === NTRP_UNRATED ? 'Not rated yet' : n;
}

/** Sleepy Hollow's winter set. Any club starts from this and edits it. */
export function defaultLeagues(seasonEndIso: string): League[] {
  return [
    { key: 'w40', label: "Women's 40 & Over", gender: 'female', min_age: 40, slots: ['day', 'nights_weekends'], valid_through: seasonEndIso },
    { key: 'm40', label: "Men's 40 & Over", gender: 'male', min_age: 40, slots: ['nights_weekends'], valid_through: seasonEndIso },
    { key: 'x18', label: 'Mixed 18 & Over', gender: 'mixed', min_age: 18, slots: ['nights_weekends'], valid_through: seasonEndIso },
  ];
}

/** Leagues this person can enter, given the gender they told us. */
export function leaguesFor(leagues: League[], gender: Answer['gender']): League[] {
  if (!gender) return [];
  return leagues.filter((l) => l.gender === 'mixed' || l.gender === gender);
}

/** The birth year a player must be born in or before for an age-floor league. */
export function ageCutoffYear(league: League, seasonStartIso: string | null): number {
  const seasonYear = seasonStartIso ? Number(seasonStartIso.slice(0, 4)) : new Date().getFullYear() + 1;
  return seasonYear - league.min_age;
}

/** Last day of a 'YYYY-MM' month, as ISO date. */
export function monthEnd(ym: string): string | null {
  const m = /^(\d{4})-(\d{2})$/.exec(ym || '');
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]), 0));
  return d.toISOString().slice(0, 10);
}

/**
 * Whether this person must renew USTA before the season ends. Anyone who doesn't
 * know is told to check too — guessing "fine" is how a player gets left off a
 * roster on registration night.
 */
export function needsRenewal(c: Campaign, a: Answer): boolean {
  if (!a.interested || !a.choices.length) return false;
  if (a.usta_unknown || !a.usta_expires) return true;
  const exp = monthEnd(a.usta_expires);
  if (!exp) return true;
  const latest = a.choices
    .map((ch) => c.leagues.find((l) => l.key === ch.league)?.valid_through)
    .filter(Boolean)
    .sort()
    .pop();
  return !!latest && exp < latest;
}

/** Validate a submitted answer against the campaign. Returns an error message or null. */
export function validate(c: Campaign, a: Answer): string | null {
  if (!a.interested) return null;
  if (a.gender !== 'female' && a.gender !== 'male') return 'Please pick women’s or men’s.';
  if (!a.ntrp || ![...NTRP_LEVELS, NTRP_UNRATED].includes(a.ntrp)) return 'Please pick your NTRP level.';
  if (!a.choices.length) return 'Pick at least one league.';
  const allowed = leaguesFor(c.leagues, a.gender);
  for (const ch of a.choices) {
    const l = allowed.find((x) => x.key === ch.league);
    if (!l) return 'One of those leagues isn’t open to you.';
    if (!l.slots.includes(ch.slot)) return `${l.label} doesn’t have a ${SLOT_SHORT[ch.slot]} option.`;
  }
  const needsAge = a.choices.some((ch) => (c.leagues.find((l) => l.key === ch.league)?.min_age ?? 0) >= 40);
  if (needsAge && a.age_ok !== true) return 'The 40 & Over leagues need you to confirm your age.';
  if (a.role !== 'captain' && a.role !== 'play') return 'Tell us if you’d like to captain or just play.';
  if (!a.usta_unknown && !monthEnd(a.usta_expires || '')) return 'Add your USTA expiration month, or tick “not sure”.';
  return null;
}

export function fmtDate(iso: string | null, opts: Intl.DateTimeFormatOptions = { weekday: 'short', month: 'short', day: 'numeric' }): string {
  if (!iso) return '';
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { ...opts, timeZone: 'UTC' });
}

export function fmtMonth(isoDate: string | null): string {
  return isoDate ? fmtDate(isoDate, { month: 'long', year: 'numeric' }) : '';
}

/** Group key used by the dashboard and team creation: league · slot · level. */
export function groupKey(league: string, slot: Slot, ntrp: string | null): string {
  return `${league}|${slot}|${ntrp || NTRP_UNRATED}`;
}
