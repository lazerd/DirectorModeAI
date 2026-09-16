/**
 * Notes from the club hosting a match — the pure parts.
 *
 * The model reads the email (hostNoteAi.ts). This file decides what that means
 * for a CaptainMode match: which fixture it is about, whether the host's date
 * and time agree with ours, and what to suggest for the match fields the
 * lineup email, calendar invite and reminder already print.
 */
import { CLUB_TZ } from './clubTime';

/** What the model pulls out of a host's email. */
export type HostNoteExtract = {
  /** False when the text isn't about a match at all (a newsletter, a reply-all). */
  about_a_match: boolean;
  /** YYYY-MM-DD as stated, or null. */
  match_date: string | null;
  /** 24h HH:MM the lines start, or null. */
  start_time: string | null;
  host_club: string | null;
  /** Street address when the email gives one. */
  address: string | null;
  /** Player-facing: warmup, check-in, parking, amenities. Short sentences. */
  arrival_note: string | null;
  captains: { name: string; email: string | null; phone: string | null }[];
};

export type MatchLite = {
  id: string;
  match_at: string;
  is_home: boolean;
  opponent: string | null;
  location: string | null;
  arrival_note: string | null;
  opposing_captain_name: string | null;
  opposing_captain_email: string | null;
  opposing_captain_phone: string | null;
  status?: string | null;
};

/** The match fields a note can fill. */
export type HostNoteFields = {
  location: string | null;
  arrival_note: string | null;
  opposing_captain_name: string | null;
  opposing_captain_email: string | null;
  opposing_captain_phone: string | null;
};

function clubParts(iso: string, tz: string): { date: string; time: string } {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(new Date(iso))
      .map((x) => [x.type, x.value]),
  );
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

const words = (s: string | null | undefined) =>
  (s || '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !['the', 'club', 'country', 'tennis', 'swim', 'and'].includes(w));

/** Does the host club named in the email look like this match's opponent? */
export function sameClub(host: string | null, opponent: string | null): boolean {
  const a = words(host);
  const b = new Set(words(opponent));
  return a.length > 0 && a.some((w) => b.has(w));
}

/**
 * Which of the team's matches a note is about.
 *
 * A stated date that lands on exactly one match wins. Otherwise the host club's
 * name narrows it: the next upcoming match against that club. Anything less
 * certain returns null and the captain picks — filing a venue note on the wrong
 * week would send players to the wrong club.
 */
export function pickMatch(
  matches: MatchLite[],
  x: Pick<HostNoteExtract, 'match_date' | 'host_club'>,
  now: Date = new Date(),
  tz: string = CLUB_TZ,
): string | null {
  const live = matches.filter((m) => m.status !== 'cancelled');
  if (x.match_date) {
    const onDate = live.filter((m) => clubParts(m.match_at, tz).date === x.match_date);
    if (onDate.length === 1) return onDate[0].id;
    const onDateClub = onDate.filter((m) => sameClub(x.host_club, m.opponent));
    if (onDateClub.length === 1) return onDateClub[0].id;
    if (onDate.length > 1) return null;
  }
  if (x.host_club) {
    const soon = live
      .filter((m) => new Date(m.match_at).getTime() > now.getTime() - 86_400_000)
      .filter((m) => sameClub(x.host_club, m.opponent))
      .sort((a, b) => a.match_at.localeCompare(b.match_at));
    if (soon.length) return soon[0].id;
  }
  return null;
}

/** Plain warnings when the host's date or start time disagree with the match. */
export function scheduleWarnings(
  match: Pick<MatchLite, 'match_at'>,
  x: Pick<HostNoteExtract, 'match_date' | 'start_time'>,
  tz: string = CLUB_TZ,
): string[] {
  const ours = clubParts(match.match_at, tz);
  const out: string[] = [];
  const pretty = (d: string) => {
    const [y, mo, da] = d.split('-').map(Number);
    return `${mo}/${da}/${y}`;
  };
  const clock = (t: string) => {
    const [h, mi] = t.split(':').map(Number);
    return `${h % 12 || 12}:${String(mi).padStart(2, '0')}${h < 12 ? 'am' : 'pm'}`;
  };
  if (x.match_date && x.match_date !== ours.date) {
    out.push(`The host says ${pretty(x.match_date)}; this match is on ${pretty(ours.date)}.`);
  }
  if (x.start_time && x.start_time !== ours.time) {
    out.push(`The host says play starts at ${clock(x.start_time)}; this match is set for ${clock(ours.time)}.`);
  }
  return out;
}

/**
 * What to suggest for each match field. A field the email says nothing about
 * keeps what the match already has, so applying a note never blanks anything.
 */
export function suggestFields(match: MatchLite, x: HostNoteExtract): HostNoteFields {
  const lead = x.captains[0];
  const location = x.address
    ? [x.host_club, x.address].filter(Boolean).join(', ')
    : match.location || x.host_club || null;
  return {
    location,
    arrival_note: x.arrival_note?.trim() || match.arrival_note,
    opposing_captain_name: lead?.name || match.opposing_captain_name,
    opposing_captain_email: lead?.email || match.opposing_captain_email,
    opposing_captain_phone: lead?.phone || match.opposing_captain_phone,
  };
}

/** The team's forwarding address: `<token>@<domain>`. */
export function inboundAddress(token: string, domain = process.env.CAPTAIN_INBOUND_DOMAIN || 'mail.clubmode.ai') {
  return `${token}@${domain}`;
}

/** A readable, unguessable local part: "fall-b2b3-2026-k7m2q9x4". */
export function newInboundToken(teamName: string, random: string): string {
  const slug = teamName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24)
    .replace(/-+$/g, '');
  return `${slug || 'team'}-${random.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8)}`;
}

/** The token(s) an inbound email was sent to, from every recipient header. */
export function tokensFromRecipients(addresses: (string | null | undefined)[], domain: string): string[] {
  const out = new Set<string>();
  const d = domain.toLowerCase();
  for (const raw of addresses) {
    for (const m of String(raw || '').toLowerCase().matchAll(/([a-z0-9._+-]+)@([a-z0-9.-]+)/g)) {
      if (m[2] === d) out.add(m[1]);
    }
  }
  return [...out];
}
