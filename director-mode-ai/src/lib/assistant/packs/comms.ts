import crypto from 'crypto';
import type Anthropic from '@anthropic-ai/sdk';
import type { DomainPack, ToolDef, ToolResult } from '../framework';
import { resolveClubCtx, MANAGER_ROLES, type ClubCtx } from '../clubContext';
import { sendBilledEmails, CreditLimitError } from '@/lib/email';
import { recordUnsubscribe, removeUnsubscribe } from '@/lib/emailUnsubscribe';

/*
 * Comms pack — emailing the club's people from the chat.
 *
 * "Email everyone who did Tennis 101 that the new session starts Saturday",
 * "write the cancellation note for tonight's clinic and send it to everyone
 * registered", "send Jane the CourtConnect instructions", "send me a test
 * first", "take the Yangs off the list, they moved".
 *
 * ONE MAIL PATH. Every send goes through sendBilledEmails (lib/email.ts): paced
 * batches with rate-limit retries, credits billed to the club owner, the demo
 * hold (clubId is always passed), the unsubscribe blocklist and the signed
 * one-click footer. Nothing here talks to Resend or builds a second sender.
 * The From name is the club's (fromName), the address stays ours.
 *
 * WHO. An audience is built from this club's own records only — every query is
 * pinned to ctx.clubId (directly, or through leagues / teams / events whose
 * club_id is ctx.clubId): class registrations (past and present), PlayerVault,
 * league team rosters and matchups, CaptainMode teams, tournament entries,
 * named people, and addresses the director types.
 *
 * HOUSEHOLDS. A person is never keyed on email. Recipients are deduped BY
 * INBOX (one email per address) but every inbox carries the names of all the
 * people behind it, so "Emma & Leo Yang — grace@…" is one send and both kids
 * are visibly covered.
 *
 * SEND EXACTLY WHAT WAS PREVIEWED. preview and run share one prepare step.
 * The preview returns a send_key — a hash of subject + body + the exact
 * recipient set. The run recomputes it and refuses if anything moved (the text
 * was rewritten, someone registered or unsubscribed in between). Above
 * SEND_CAP inboxes it refuses outright.
 *
 * WHAT IT DELIBERATELY CANNOT DO: text messages (carrier registration is not
 * finished), scheduling (the only scheduled sender is the CRM's, which is for
 * sales outreach to CRM contacts, not club members), or report opens (no
 * per-send log or open tracking exists for club email).
 */

type Ctx = ClubCtx;

/** Inboxes per send. Sends are paced ~2/sec, so this also bounds request time. */
export const SEND_CAP = 300;
const PREVIEW_NAMES = 25;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL = /^[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+$/;

// --------------------------------------------------------------- utilities

const todayIn = (tz: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

const norm = (s: unknown) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
const normEmail = (s: unknown) => String(s ?? '').trim().toLowerCase();

/** Age in whole years on `today` (YYYY-MM-DD) from a YYYY-MM-DD birth date. */
export function ageOn(dob: string | null | undefined, today: string): number | null {
  if (!dob || !YMD.test(dob.slice(0, 10))) return null;
  const [by, bm, bd] = dob.slice(0, 10).split('-').map(Number);
  const [ty, tm, td] = today.split('-').map(Number);
  let a = ty - by;
  if (tm < bm || (tm === bm && td < bd)) a -= 1;
  return a >= 0 && a < 130 ? a : null;
}

/**
 * Does a typed name refer to this person? Every word typed must be a word of
 * the name ("Yang" → Emma Yang; "Emma Yang" → Emma Yang). A trailing plural
 * is forgiven ("the Yangs"). Never a substring match — "Yang" is not "Yangtze".
 */
export function nameMatches(term: string, name: string): boolean {
  const words = norm(name).split(/[\s,.'-]+/).filter(Boolean);
  const typed = norm(term)
    .replace(/^the\s+/, '')
    .split(/[\s,.'-]+/)
    .filter(Boolean);
  if (!typed.length || !words.length) return false;
  return typed.every((t) => words.includes(t) || (t.length > 2 && t.endsWith('s') && words.includes(t.slice(0, -1))));
}

function canWrite(ctx: Ctx): ToolResult | null {
  if (MANAGER_ROLES.has(ctx.role)) return null;
  return {
    ok: false,
    error: `Your role here is "${ctx.role}", which can look up who would get an email but not send one. An owner or director can send.`,
  };
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The director's plain text → the email HTML. Paragraphs, line breaks and links; nothing else. */
export function renderEmailHtml(clubName: string, body: string): string {
  const linkify = (s: string) =>
    s.replace(/(https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"])/g, (u) => `<a href="${u}" style="color:#1F4FA0">${u}</a>`);
  const paras = body
    .replace(/\r\n/g, '\n')
    .trim()
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 14px">${linkify(esc(p)).replace(/\n/g, '<br>')}</p>`)
    .join('\n');
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#1f2937;line-height:1.55;max-width:640px;margin:0 auto">
  <div style="background:#1F4FA0;border-radius:14px 14px 0 0;padding:16px 26px;color:#fff">
    <div style="font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:#FFD24F;font-weight:700">${esc(clubName)}</div>
  </div>
  <div style="border:1px solid #e5e7eb;border-top:none;border-radius:0 0 14px 14px;padding:22px 26px">${paras}</div>
</div>`;
}

// --------------------------------------------------------------- people

/** One person reachable (or not) at one address. A person can have two (player + parent). */
type Contact = {
  person: string;
  email: string | null;
  /** Who reads that inbox when it is not the person ("parent Grace Yang"). */
  contactName?: string | null;
  /** null = unknown. */
  age: number | null;
  via: string;
};

export interface Audience {
  classes?: string[];
  class_scope?: 'all_matching' | 'most_recent_started';
  include_waitlist?: boolean;
  club_players?: boolean;
  league_team?: string;
  league?: string;
  league_matchup?: string;
  matchup_team?: string;
  captain_team?: string;
  event?: string;
  people?: string[];
  emails?: string[];
  min_age?: number;
  max_age?: number;
  exclude?: string[];
}

type Loaded = { contacts: Contact[]; used: string[] } | { error: string; candidates?: unknown };

async function loadClasses(ctx: Ctx, a: Audience, today: string): Promise<Loaded> {
  const { data } = await ctx.db
    .from('club_programs')
    .select('id, title, status, range_start, range_end')
    .eq('club_id', ctx.clubId)
    .order('range_start');
  const all = (data as { id: string; title: string; status: string; range_start: string; range_end: string }[] | null) ?? [];
  const picked = new Map<string, (typeof all)[number]>();
  for (const term of a.classes ?? []) {
    const t = String(term).trim();
    let hits = UUID.test(t) ? all.filter((p) => p.id === t) : all.filter((p) => norm(p.title).includes(norm(t)));
    if (!hits.length) return { error: `No class at ${ctx.clubName} (past or present) matches "${t}". Use list_audiences to look.` };
    if (a.class_scope === 'most_recent_started' && !UUID.test(t)) {
      const started = hits.filter((p) => p.range_start <= today).sort((x, y) => x.range_start.localeCompare(y.range_start));
      if (!started.length) return { error: `No "${t}" class has started yet, so there is no "last session" to use.` };
      hits = [started[started.length - 1]];
    }
    for (const h of hits) picked.set(h.id, h);
  }
  const ids = [...picked.keys()];
  const { data: regs } = await ctx.db
    .from('club_program_registrations')
    .select('program_id, participant_name, participant_dob, parent_name, parent_email, status')
    .eq('club_id', ctx.clubId)
    .in('program_id', ids);
  const rows =
    (regs as { program_id: string; participant_name: string; participant_dob: string | null; parent_name: string | null; parent_email: string | null; status: string }[] | null) ?? [];
  const contacts: Contact[] = [];
  for (const r of rows) {
    if (r.status === 'cancelled') continue;
    if (r.status === 'waitlist' && !a.include_waitlist) continue;
    const p = picked.get(r.program_id);
    contacts.push({
      person: r.participant_name,
      email: r.parent_email || null,
      contactName: r.parent_name && norm(r.parent_name) !== norm(r.participant_name) ? r.parent_name : null,
      age: ageOn(r.participant_dob, today),
      via: `class: ${p?.title ?? 'class'}`,
    });
  }
  return {
    contacts,
    used: [...picked.values()].map((p) => `class "${p.title}" (${p.range_start} – ${p.range_end}${p.status === 'archived' ? ', archived' : p.status === 'draft' ? ', draft' : ''})`),
  };
}

async function loadVault(ctx: Ctx, today: string): Promise<Contact[]> {
  const { data } = await ctx.db
    .from('cc_vault_players')
    .select('id, full_name, email, date_of_birth, age')
    .eq('club_id', ctx.clubId)
    .limit(5000);
  return ((data as { full_name: string; email: string | null; date_of_birth: string | null; age: number | null }[] | null) ?? []).map((v) => ({
    person: v.full_name,
    email: v.email || null,
    age: ageOn(v.date_of_birth, today) ?? (typeof v.age === 'number' ? v.age : null),
    via: 'PlayerVault',
  }));
}

type LeagueBits = {
  leagues: { id: string; name: string }[];
  divisions: { id: string; league_id: string; name: string }[];
  teams: { id: string; league_id: string; name: string; short_code: string | null }[];
};

async function loadLeagueBits(ctx: Ctx): Promise<LeagueBits> {
  const { data: lg } = await ctx.db.from('leagues').select('id, name').eq('club_id', ctx.clubId);
  const leagues = (lg as LeagueBits['leagues'] | null) ?? [];
  if (!leagues.length) return { leagues, divisions: [], teams: [] };
  const ids = leagues.map((l) => l.id);
  const [{ data: dv }, { data: tm }] = await Promise.all([
    ctx.db.from('league_divisions').select('id, league_id, name').in('league_id', ids),
    ctx.db.from('league_clubs').select('id, league_id, name, short_code').in('league_id', ids),
  ]);
  return { leagues, divisions: (dv as LeagueBits['divisions'] | null) ?? [], teams: (tm as LeagueBits['teams'] | null) ?? [] };
}

type RosterRow = { division_id: string; club_id: string; player_name: string; player_email: string | null; parent_name: string | null; parent_email: string | null; status: string };

function rosterContacts(rows: RosterRow[], via: (r: RosterRow) => string): Contact[] {
  const out: Contact[] = [];
  for (const r of rows) {
    if (r.status && r.status !== 'active') continue;
    const emails = [...new Set([r.player_email, r.parent_email].map(normEmail).filter(Boolean))];
    if (!emails.length) out.push({ person: r.player_name, email: null, age: null, via: via(r) });
    for (const e of emails) {
      const isParent = e === normEmail(r.parent_email) && e !== normEmail(r.player_email);
      out.push({ person: r.player_name, email: e, contactName: isParent ? r.parent_name : null, age: null, via: via(r) });
    }
  }
  return out;
}

const teamMatches = (t: { name: string; short_code: string | null }, term: string) =>
  norm(t.name) === norm(term) || norm(t.short_code) === norm(term) || norm(t.name).includes(norm(term));

async function loadLeagueTeam(ctx: Ctx, a: Audience, bits: LeagueBits): Promise<Loaded> {
  const term = String(a.league_team);
  const leagueIds = a.league
    ? bits.leagues.filter((l) => UUID.test(a.league!) ? l.id === a.league : norm(l.name).includes(norm(a.league))).map((l) => l.id)
    : bits.leagues.map((l) => l.id);
  if (!leagueIds.length) return { error: `No league at ${ctx.clubName} matches "${a.league}".` };
  const hits = bits.teams.filter((t) => leagueIds.includes(t.league_id) && (UUID.test(term) ? t.id === term : teamMatches(t, term)));
  if (!hits.length) return { error: `No league team matches "${term}".`, candidates: bits.teams.map((t) => t.name) };
  if (hits.length > 1) {
    return {
      error: `"${term}" matches ${hits.length} league teams. Ask which one (or name the league), then pass its id.`,
      candidates: hits.map((t) => ({ id: t.id, team: t.name, league: bits.leagues.find((l) => l.id === t.league_id)?.name })),
    };
  }
  const team = hits[0];
  const { data } = await ctx.db
    .from('league_team_rosters')
    .select('division_id, club_id, player_name, player_email, parent_name, parent_email, status')
    .eq('club_id', team.id);
  const leagueName = bits.leagues.find((l) => l.id === team.league_id)?.name ?? 'league';
  return {
    contacts: rosterContacts((data as RosterRow[] | null) ?? [], () => `team: ${team.name}`),
    used: [`league team "${team.name}" (${leagueName}) roster`],
  };
}

async function loadMatchup(ctx: Ctx, a: Audience, bits: LeagueBits): Promise<Loaded> {
  const key = String(a.league_matchup).trim();
  const divIds = bits.divisions.map((d) => d.id);
  if (!divIds.length) return { error: `${ctx.clubName} has no league divisions.` };
  type M = { id: string; division_id: string; match_date: string; start_time: string | null; home_club_id: string; away_club_id: string };
  let q = ctx.db.from('league_team_matchups').select('id, division_id, match_date, start_time, home_club_id, away_club_id').in('division_id', divIds);
  if (UUID.test(key)) q = q.eq('id', key);
  else if (YMD.test(key)) q = q.eq('match_date', key);
  else return { error: 'league_matchup must be a matchup id or a YYYY-MM-DD date.' };
  const { data } = await q;
  const rows = (data as M[] | null) ?? [];
  const tName = (id: string) => bits.teams.find((t) => t.id === id)?.name ?? 'team';
  if (!rows.length) return { error: `No league matchup ${UUID.test(key) ? 'with that id' : `on ${key}`} at ${ctx.clubName}.` };
  if (rows.length > 1) {
    return {
      error: `${rows.length} matchups on ${key}. Ask which one, then pass its id.`,
      candidates: rows.map((m) => ({ id: m.id, match: `${tName(m.away_club_id)} @ ${tName(m.home_club_id)}`, time: m.start_time })),
    };
  }
  const m = rows[0];
  let sides = [m.home_club_id, m.away_club_id];
  if (a.matchup_team) {
    sides = sides.filter((id) => {
      const t = bits.teams.find((x) => x.id === id);
      return !!t && teamMatches(t, a.matchup_team!);
    });
    if (!sides.length) return { error: `"${a.matchup_team}" is not one of the two teams in that matchup.` };
  }
  const { data: rs } = await ctx.db
    .from('league_team_rosters')
    .select('division_id, club_id, player_name, player_email, parent_name, parent_email, status')
    .eq('division_id', m.division_id)
    .in('club_id', sides);
  return {
    contacts: rosterContacts((rs as RosterRow[] | null) ?? [], (r) => `team: ${tName(r.club_id)}`),
    used: [`matchup ${tName(m.away_club_id)} @ ${tName(m.home_club_id)} on ${m.match_date} (${sides.map(tName).join(' + ')} rosters)`],
  };
}

async function loadCaptainTeam(ctx: Ctx, a: Audience): Promise<Loaded> {
  const term = String(a.captain_team).trim();
  const { data } = await ctx.db.from('captain_teams').select('id, name, archived').eq('club_id', ctx.clubId);
  const teams = ((data as { id: string; name: string; archived: boolean | null }[] | null) ?? []).filter((t) => UUID.test(term) || !t.archived);
  const hits = UUID.test(term) ? teams.filter((t) => t.id === term) : teams.filter((t) => norm(t.name).includes(norm(term)));
  if (!hits.length) return { error: `No team at ${ctx.clubName} matches "${term}".`, candidates: teams.map((t) => t.name) };
  if (hits.length > 1) return { error: `"${term}" matches ${hits.length} teams — which one?`, candidates: hits.map((t) => ({ id: t.id, team: t.name })) };
  const team = hits[0];
  const { data: ps } = await ctx.db
    .from('captain_players')
    .select('name, email, contact2_name, contact2_email, active')
    .eq('team_id', team.id)
    .eq('active', true);
  const contacts: Contact[] = [];
  for (const p of (ps as { name: string; email: string | null; contact2_name: string | null; contact2_email: string | null }[] | null) ?? []) {
    const emails = [...new Set([p.email, p.contact2_email].map(normEmail).filter(Boolean))];
    if (!emails.length) contacts.push({ person: p.name, email: null, age: null, via: `team: ${team.name}` });
    for (const e of emails) {
      contacts.push({ person: p.name, email: e, contactName: e === normEmail(p.contact2_email) && e !== normEmail(p.email) ? p.contact2_name : null, age: null, via: `team: ${team.name}` });
    }
  }
  return { contacts, used: [`team "${team.name}" (active players)`] };
}

async function loadEvent(ctx: Ctx, a: Audience, today: string): Promise<Loaded> {
  const term = String(a.event).trim();
  const { data } = await ctx.db.from('events').select('id, name, event_date').eq('club_id', ctx.clubId);
  const evs = (data as { id: string; name: string; event_date: string | null }[] | null) ?? [];
  const hits = UUID.test(term) ? evs.filter((e) => e.id === term) : evs.filter((e) => norm(e.name).includes(norm(term)));
  if (!hits.length) return { error: `No event at ${ctx.clubName} matches "${term}".` };
  if (hits.length > 1) return { error: `"${term}" matches ${hits.length} events — which one?`, candidates: hits.map((e) => ({ id: e.id, event: e.name, date: e.event_date })) };
  const ev = hits[0];
  const { data: en } = await ctx.db
    .from('tournament_entries')
    .select('player_name, player_email, parent_name, parent_email, partner_name, partner_email, date_of_birth, position')
    .eq('event_id', ev.id);
  type E = { player_name: string; player_email: string | null; parent_name: string | null; parent_email: string | null; partner_name: string | null; partner_email: string | null; date_of_birth: string | null; position: string | null };
  const contacts: Contact[] = [];
  const via = `event: ${ev.name}`;
  for (const r of (en as E[] | null) ?? []) {
    if (r.position === 'withdrawn') continue;
    if (r.position === 'waitlist' && !a.include_waitlist) continue;
    const age = ageOn(r.date_of_birth, today);
    const emails = [...new Set([r.player_email, r.parent_email].map(normEmail).filter(Boolean))];
    if (!emails.length) contacts.push({ person: r.player_name, email: null, age, via });
    for (const e of emails) {
      contacts.push({ person: r.player_name, email: e, contactName: e === normEmail(r.parent_email) && e !== normEmail(r.player_email) ? r.parent_name : null, age, via });
    }
    if (r.partner_name) contacts.push({ person: r.partner_name, email: normEmail(r.partner_email) || null, age: null, via });
  }
  return { contacts, used: [`event "${ev.name}"${ev.event_date ? ` (${ev.event_date})` : ''} entries`] };
}

/** Everyone this club knows, from every source — for finding people by name or address. */
async function loadEveryone(ctx: Ctx, today: string): Promise<Contact[]> {
  const out: Contact[] = await loadVault(ctx, today);
  const { data: regs } = await ctx.db
    .from('club_program_registrations')
    .select('participant_name, participant_dob, parent_name, parent_email, status')
    .eq('club_id', ctx.clubId)
    .limit(10000);
  for (const r of (regs as { participant_name: string; participant_dob: string | null; parent_name: string | null; parent_email: string | null }[] | null) ?? []) {
    out.push({ person: r.participant_name, email: normEmail(r.parent_email) || null, contactName: r.parent_name, age: ageOn(r.participant_dob, today), via: 'class registration' });
    if (r.parent_name && norm(r.parent_name) !== norm(r.participant_name)) {
      out.push({ person: r.parent_name, email: normEmail(r.parent_email) || null, age: null, via: 'class registration (parent)' });
    }
  }
  const bits = await loadLeagueBits(ctx);
  if (bits.teams.length) {
    const { data } = await ctx.db
      .from('league_team_rosters')
      .select('division_id, club_id, player_name, player_email, parent_name, parent_email, status')
      .in('club_id', bits.teams.map((t) => t.id));
    out.push(...rosterContacts((data as RosterRow[] | null) ?? [], () => 'league roster'));
  }
  const { data: ct } = await ctx.db.from('captain_teams').select('id').eq('club_id', ctx.clubId);
  const teamIds = ((ct as { id: string }[] | null) ?? []).map((t) => t.id);
  if (teamIds.length) {
    const { data } = await ctx.db.from('captain_players').select('name, email, contact2_name, contact2_email').in('team_id', teamIds);
    for (const p of (data as { name: string; email: string | null; contact2_name: string | null; contact2_email: string | null }[] | null) ?? []) {
      out.push({ person: p.name, email: normEmail(p.email) || null, age: null, via: 'team roster' });
      if (p.contact2_email) out.push({ person: p.name, email: normEmail(p.contact2_email), contactName: p.contact2_name, age: null, via: 'team roster' });
    }
  }
  const { data: ev } = await ctx.db.from('events').select('id').eq('club_id', ctx.clubId);
  const evIds = ((ev as { id: string }[] | null) ?? []).map((e) => e.id);
  if (evIds.length) {
    const { data } = await ctx.db.from('tournament_entries').select('player_name, player_email, parent_name, parent_email, date_of_birth').in('event_id', evIds);
    for (const r of (data as { player_name: string; player_email: string | null; parent_name: string | null; parent_email: string | null; date_of_birth: string | null }[] | null) ?? []) {
      const age = ageOn(r.date_of_birth, today);
      out.push({ person: r.player_name, email: normEmail(r.player_email) || null, age, via: 'event entry' });
      if (r.parent_email) out.push({ person: r.player_name, email: normEmail(r.parent_email), contactName: r.parent_name, age, via: 'event entry' });
    }
  }
  return out;
}

const distinctEmails = (cs: Contact[]) => [...new Set(cs.map((c) => normEmail(c.email)).filter(Boolean))];

function parseTyped(s: string): { email: string; name: string | null } | null {
  const m = String(s).match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  const email = normEmail(m ? m[2] : s);
  if (!EMAIL.test(email)) return null;
  return { email, name: m && m[1].trim() ? m[1].trim() : null };
}

// --------------------------------------------------------------- audience → recipients

export type Recipient = { email: string; people: string[]; contacts: string[]; via: string[] };

export type Built = {
  recipients: Recipient[];
  used: string[];
  people_count: number;
  excluded: {
    unsubscribed: { email: string; people: string[] }[];
    no_email: string[];
    invalid_email: { person: string; email: string }[];
    age_unknown: string[];
    left_out_by_request: string[];
  };
  outside_age: number;
  shared_inboxes: { email: string; people: string[] }[];
};

function hasAudience(a: Audience): boolean {
  return !!(
    a.classes?.length || a.club_players || a.league_team || a.league_matchup || a.captain_team || a.event || a.people?.length || a.emails?.length
  );
}

export async function buildAudience(ctx: Ctx, raw: unknown): Promise<Built | { error: string; candidates?: unknown }> {
  const a = (raw && typeof raw === 'object' ? raw : {}) as Audience;
  if (!hasAudience(a)) {
    return { error: 'Who should get it? Give classes, club_players, a league team or matchup, a team, an event, people or emails.' };
  }
  const today = todayIn(ctx.timeZone);
  const contacts: Contact[] = [];
  const used: string[] = [];
  const add = (r: Loaded) => {
    if ('error' in r) return r;
    contacts.push(...r.contacts);
    used.push(...r.used);
    return null;
  };

  if (a.classes?.length) {
    const e = add(await loadClasses(ctx, a, today));
    if (e) return e;
  }
  if (a.club_players) {
    contacts.push(...(await loadVault(ctx, today)));
    used.push('everyone in PlayerVault');
  }
  if (a.league_team || a.league_matchup) {
    const bits = await loadLeagueBits(ctx);
    if (a.league_team) {
      const e = add(await loadLeagueTeam(ctx, a, bits));
      if (e) return e;
    }
    if (a.league_matchup) {
      const e = add(await loadMatchup(ctx, a, bits));
      if (e) return e;
    }
  }
  if (a.captain_team) {
    const e = add(await loadCaptainTeam(ctx, a));
    if (e) return e;
  }
  if (a.event) {
    const e = add(await loadEvent(ctx, a, today));
    if (e) return e;
  }

  let everyone: Contact[] | null = null;
  const known = async () => (everyone ??= await loadEveryone(ctx, today));

  for (const term of a.people ?? []) {
    const hits = (await known()).filter((c) => nameMatches(term, c.person));
    if (!hits.length) return { error: `Nobody called "${term}" is in ${ctx.clubName}'s records. Ask for their email and pass it in emails.` };
    const emails = distinctEmails(hits);
    if (emails.length > 1) {
      return {
        error: `"${term}" matches more than one address. Ask which, then pass the full name or the email.`,
        candidates: emails.map((e) => ({ email: e, people: [...new Set(hits.filter((h) => normEmail(h.email) === e).map((h) => h.person))] })),
      };
    }
    // One person may appear from several sources; keep a single contact for them.
    const first = hits.find((h) => h.email) ?? hits[0];
    contacts.push({ ...first, via: 'named' });
    used.push(`named: ${term}`);
  }

  for (const typed of a.emails ?? []) {
    const p = parseTyped(typed);
    if (!p) return { error: `"${typed}" is not an email address.` };
    const names = [...new Set((await known()).filter((c) => normEmail(c.email) === p.email).map((c) => c.person))];
    const who = p.name ? [p.name] : names.length ? names : [p.email];
    for (const n of who) contacts.push({ person: n, email: p.email, age: null, via: 'typed address' });
    used.push(`address: ${p.email}`);
  }

  // Age filter — only where an age is known; unknown ages are listed, never guessed.
  const ageUnknown = new Set<string>();
  let outsideAge = 0;
  const ageOk = (c: Contact) => {
    if (a.min_age == null && a.max_age == null) return true;
    if (c.via === 'named' || c.via === 'typed address') return true;
    if (c.age == null) {
      ageUnknown.add(c.person);
      return false;
    }
    const ok = (a.min_age == null || c.age >= a.min_age) && (a.max_age == null || c.age <= a.max_age);
    if (!ok) outsideAge += 1;
    return ok;
  };

  const leftOut = new Set<string>();
  const excludeTerms = (a.exclude ?? []).map(String).filter((s) => s.trim());
  const excludedByRequest = (c: Contact) => {
    const hit = excludeTerms.some((t) => (EMAIL.test(normEmail(t)) ? normEmail(t) === normEmail(c.email) : nameMatches(t, c.person)));
    if (hit) leftOut.add(c.person);
    return hit;
  };

  const byEmail = new Map<string, { people: Set<string>; contacts: Set<string>; via: Set<string> }>();
  const noEmail = new Set<string>();
  const invalid: { person: string; email: string }[] = [];
  const reachable = new Set<string>();
  for (const c of contacts) {
    if (!ageOk(c) || excludedByRequest(c)) continue;
    const e = normEmail(c.email);
    if (!e) {
      noEmail.add(c.person);
      continue;
    }
    if (!EMAIL.test(e)) {
      invalid.push({ person: c.person, email: e });
      continue;
    }
    const slot = byEmail.get(e) ?? { people: new Set(), contacts: new Set(), via: new Set() };
    slot.people.add(c.person);
    if (c.contactName) slot.contacts.add(c.contactName);
    slot.via.add(c.via);
    byEmail.set(e, slot);
    reachable.add(norm(c.person));
  }
  // Someone with no address on one record but an address on another IS reachable.
  for (const n of [...noEmail]) if (reachable.has(norm(n))) noEmail.delete(n);
  for (const n of [...ageUnknown]) if (reachable.has(norm(n))) ageUnknown.delete(n);

  // The shared opt-out list, checked up front so the preview names who is skipped.
  const emails = [...byEmail.keys()];
  const unsub = new Set<string>();
  for (let i = 0; i < emails.length; i += 200) {
    const { data } = await ctx.db.from('email_unsubscribes').select('email').eq('scope', 'all').in('email', emails.slice(i, i + 200));
    for (const r of (data as { email: string }[] | null) ?? []) unsub.add(normEmail(r.email));
  }

  const recipients: Recipient[] = [];
  const unsubscribed: Built['excluded']['unsubscribed'] = [];
  for (const [email, s] of byEmail) {
    const people = [...s.people].sort();
    if (unsub.has(email)) unsubscribed.push({ email, people });
    else recipients.push({ email, people, contacts: [...s.contacts].sort(), via: [...s.via].sort() });
  }
  recipients.sort((x, y) => x.people[0].localeCompare(y.people[0]) || x.email.localeCompare(y.email));

  // People behind more than one inbox are counted once.
  const peopleCount = new Set(recipients.flatMap((r) => r.people.map(norm))).size;

  return {
    recipients,
    used: [...new Set(used)],
    people_count: peopleCount,
    excluded: {
      unsubscribed,
      no_email: [...noEmail].sort(),
      invalid_email: invalid,
      age_unknown: [...ageUnknown].sort(),
      left_out_by_request: [...leftOut].sort(),
    },
    outside_age: outsideAge,
    shared_inboxes: recipients.filter((r) => r.people.length > 1).map((r) => ({ email: r.email, people: r.people })),
  };
}

const line = (r: Recipient) =>
  `${r.people.join(' & ')} — ${r.email}${r.contacts.length ? ` (${r.contacts.join(', ')})` : ''}`;

function excludedSummary(b: Built) {
  const ex = b.excluded;
  return {
    unsubscribed: ex.unsubscribed.map((u) => `${u.people.join(' & ')} — ${u.email}`),
    no_email_on_file: ex.no_email,
    bad_email: ex.invalid_email.map((x) => `${x.person} — ${x.email}`),
    age_unknown: ex.age_unknown,
    left_out_as_asked: ex.left_out_by_request,
    outside_age_range: b.outside_age || undefined,
  };
}

/** The fingerprint of one exact send: subject, body, and the precise set of inboxes. */
export function sendKey(subject: string, body: string, emails: string[]): string {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify({ s: subject, b: body, r: [...emails].sort() }))
    .digest('hex')
    .slice(0, 16);
}

// --------------------------------------------------------------- club / director

async function clubSender(ctx: Ctx): Promise<{ ownerId: string | null; replyTo: string | undefined; directorEmail: string | null }> {
  const { data } = await ctx.db.from('cc_clubs').select('owner_id, email').eq('id', ctx.clubId).maybeSingle();
  const club = data as { owner_id: string | null; email: string | null } | null;
  let directorEmail: string | null = null;
  try {
    const { data: u } = await (ctx.db as any).auth.admin.getUserById(ctx.userId);
    directorEmail = u?.user?.email ?? null;
  } catch {
    directorEmail = null;
  }
  return { ownerId: club?.owner_id ?? ctx.userId, replyTo: club?.email || directorEmail || undefined, directorEmail };
}

// --------------------------------------------------------------- send

type SendPlan = { subject: string; body: string; built: Built; key: string; summary: Record<string, unknown> };

function cleanText(input: Record<string, unknown>): { subject: string; body: string } | { error: string } {
  const subject = String(input.subject ?? '').replace(/[\r\n]+/g, ' ').trim();
  const body = String(input.body ?? '').replace(/\r\n/g, '\n').trim();
  if (!subject) return { error: 'The email needs a subject.' };
  if (!body) return { error: 'The email needs a body.' };
  if (subject.length > 200) return { error: 'That subject is too long (200 characters max).' };
  if (body.length > 20000) return { error: 'That body is too long.' };
  return { subject, body };
}

async function prepareSend(input: Record<string, unknown>, ctx: Ctx): Promise<SendPlan | { error: string; candidates?: unknown }> {
  const t = cleanText(input);
  if ('error' in t) return t;
  const built = await buildAudience(ctx, input.audience);
  if ('error' in built) return built;
  const n = built.recipients.length;
  if (n === 0) {
    return { error: 'Nobody in that audience can be emailed.', candidates: excludedSummary(built) };
  }
  if (n > SEND_CAP) {
    return {
      error: `That is ${n} inboxes. The assistant sends up to ${SEND_CAP} at a time — narrow the audience (or split it in two) and preview again.`,
    };
  }
  const key = sendKey(t.subject, t.body, built.recipients.map((r) => r.email));
  return {
    ...t,
    built,
    key,
    summary: {
      from: `${ctx.clubName} (via ClubMode)`,
      subject: t.subject,
      body: t.body,
      recipient_count: n,
      people_count: built.people_count,
      audience: built.used,
      recipients: built.recipients.slice(0, PREVIEW_NAMES).map(line),
      more_recipients: n > PREVIEW_NAMES ? n - PREVIEW_NAMES : undefined,
      shared_inboxes: built.shared_inboxes.length
        ? `${built.shared_inboxes.length} inbox${built.shared_inboxes.length === 1 ? ' is' : 'es are'} shared by a household — one email each, all names shown above.`
        : undefined,
      not_sent_to: excludedSummary(built),
      footer: 'Every email carries the club name and a one-click unsubscribe link.',
    },
  };
}

const T_LIST: Anthropic.Messages.Tool = {
  name: 'list_audiences',
  description:
    'Find who the club can email: classes (including PAST and archived sessions, with registration counts), league ' +
    'teams and upcoming league matchups, CaptainMode teams, events with entries, and the PlayerVault size. Use it to ' +
    'turn "everyone who did Tennis 101" or "this week\'s match" into an audience.',
  input_schema: {
    type: 'object',
    properties: { query: { type: 'string', description: 'Optional words to narrow by name (e.g. "Tennis 101").' } },
  },
};

const AUDIENCE_SCHEMA = {
  type: 'object',
  description: 'Who gets it. Sources are combined (union) and deduped by inbox.',
  properties: {
    classes: {
      type: 'array',
      items: { type: 'string' },
      description: 'Class names or ids. A name matches EVERY class (past or present) whose title contains it.',
    },
    class_scope: {
      type: 'string',
      enum: ['all_matching', 'most_recent_started'],
      description: '"most_recent_started" = only the latest session that has already started ("the last session"). Default all_matching.',
    },
    include_waitlist: { type: 'boolean', description: 'Include waitlisted registrations / entries. Default false.' },
    club_players: { type: 'boolean', description: "Everyone in the club's PlayerVault." },
    league_team: { type: 'string', description: 'A league team (name, short code or id) — its roster, players and parents.' },
    league: { type: 'string', description: 'Narrow league_team to one league.' },
    league_matchup: { type: 'string', description: 'A league matchup id, or a YYYY-MM-DD date — both teams\' rosters.' },
    matchup_team: { type: 'string', description: 'Only this one of the two matchup teams.' },
    captain_team: { type: 'string', description: 'A CaptainMode team (name or id) — its active players.' },
    event: { type: 'string', description: 'An event / tournament (name or id) — everyone entered.' },
    people: { type: 'array', items: { type: 'string' }, description: 'Specific people by name, looked up in the club\'s records.' },
    emails: { type: 'array', items: { type: 'string' }, description: 'Addresses typed by the director, "Name <a@b.com>" or bare.' },
    min_age: { type: 'number' },
    max_age: { type: 'number', description: '"12 and under" → 12. Only people with a known birth date/age qualify; the rest are listed.' },
    exclude: { type: 'array', items: { type: 'string' }, description: 'Names or addresses to leave out.' },
  },
};

const T_WHO: Anthropic.Messages.Tool = {
  name: 'preview_recipients',
  description:
    '"Who would get this?" — the recipient list for an audience: inbox count, people count, every name behind each ' +
    'inbox, and who is left out (unsubscribed, no email on file, unknown age, duplicates merged). Sends nothing.',
  input_schema: { type: 'object', properties: { audience: AUDIENCE_SCHEMA }, required: ['audience'] },
};

const T_SEND: Anthropic.Messages.Tool = {
  name: 'send_email',
  description:
    'Email an audience from the club (From = the club name). Without confirm it returns the full preview: subject, ' +
    `body, recipient count, the first ${PREVIEW_NAMES} names, exclusions and a send_key. To send, call again with the ` +
    'SAME subject, body and audience plus that send_key and confirm:true. If the text or the list changed it refuses — ' +
    `preview again. One-offs (one person) work the same way. Max ${SEND_CAP} inboxes.`,
  input_schema: {
    type: 'object',
    properties: {
      subject: { type: 'string' },
      body: { type: 'string', description: 'Plain text. Blank lines between paragraphs; URLs become links. Include greeting and sign-off.' },
      audience: AUDIENCE_SCHEMA,
      send_key: { type: 'string', description: 'From the preview. Required with confirm:true.' },
    },
    required: ['subject', 'body', 'audience'],
  },
};

const T_TEST: Anthropic.Messages.Tool = {
  name: 'send_test_email',
  description:
    'Send the exact email ONLY to the director asking (their own login address), subject prefixed "[Test]". ' +
    'Nobody else receives anything. Pass the audience too to report how many it would go to.',
  input_schema: {
    type: 'object',
    properties: { subject: { type: 'string' }, body: { type: 'string' }, audience: AUDIENCE_SCHEMA },
    required: ['subject', 'body'],
  },
};

const OPT_PROPS = {
  people: { type: 'array', items: { type: 'string' }, description: 'Names (a surname covers the household: "Yang").' },
  emails: { type: 'array', items: { type: 'string' } },
};

const T_STOP: Anthropic.Messages.Tool = {
  name: 'stop_emails_to',
  description:
    'Take people off club email ("remove the Yangs, they moved"): puts their addresses on the ClubMode unsubscribe ' +
    'list, the same one the footer link uses. Only addresses found in this club\'s records. Does not delete them.',
  input_schema: { type: 'object', properties: OPT_PROPS },
};

const T_RESUME: Anthropic.Messages.Tool = {
  name: 'resume_emails_to',
  description:
    'Put people back on club email (removes their addresses from the unsubscribe list). Only for people who asked to ' +
    'be added back. Only addresses found in this club\'s records.',
  input_schema: { type: 'object', properties: OPT_PROPS },
};

const T_SCHEDULE: Anthropic.Messages.Tool = {
  name: 'schedule_email',
  description: 'Schedule a club email for later ("send it tomorrow at 8am").',
  input_schema: { type: 'object', properties: { send_at: { type: 'string' } } },
};

const T_STATUS: Anthropic.Messages.Tool = {
  name: 'email_delivery_status',
  description: '"Did that email go out? Who opened it?" for an email sent earlier.',
  input_schema: { type: 'object', properties: { subject: { type: 'string' } } },
};

// --------------------------------------------------------------- reads

async function listAudiences(input: Record<string, unknown>, ctx: Ctx): Promise<ToolResult> {
  const q = norm(input.query);
  const fits = (s: string) => !q || q.split(' ').every((w) => norm(s).includes(w));
  const { data: pr } = await ctx.db
    .from('club_programs')
    .select('id, title, status, range_start, range_end, audience')
    .eq('club_id', ctx.clubId)
    .order('range_start');
  const programs = ((pr as { id: string; title: string; status: string; range_start: string; range_end: string; audience: string }[] | null) ?? []).filter((p) =>
    fits(p.title),
  );
  const counts = new Map<string, number>();
  if (programs.length) {
    const { data: regs } = await ctx.db
      .from('club_program_registrations')
      .select('program_id, status')
      .eq('club_id', ctx.clubId)
      .in('program_id', programs.map((p) => p.id));
    for (const r of (regs as { program_id: string; status: string }[] | null) ?? []) {
      if (r.status !== 'cancelled') counts.set(r.program_id, (counts.get(r.program_id) ?? 0) + 1);
    }
  }
  const bits = await loadLeagueBits(ctx);
  const today = todayIn(ctx.timeZone);
  let matchups: unknown[] = [];
  if (bits.divisions.length) {
    const { data } = await ctx.db
      .from('league_team_matchups')
      .select('id, division_id, match_date, start_time, home_club_id, away_club_id')
      .in('division_id', bits.divisions.map((d) => d.id))
      .gte('match_date', today)
      .order('match_date')
      .limit(15);
    const tn = (id: string) => bits.teams.find((t) => t.id === id)?.name ?? 'team';
    matchups = ((data as { id: string; match_date: string; start_time: string | null; home_club_id: string; away_club_id: string }[] | null) ?? []).map((m) => ({
      id: m.id,
      date: m.match_date,
      time: m.start_time,
      match: `${tn(m.away_club_id)} @ ${tn(m.home_club_id)}`,
    }));
  }
  const { data: ct } = await ctx.db.from('captain_teams').select('id, name, archived').eq('club_id', ctx.clubId);
  const { data: ev } = await ctx.db.from('events').select('id, name, event_date').eq('club_id', ctx.clubId).order('event_date');
  const { data: vp } = await ctx.db.from('cc_vault_players').select('id').eq('club_id', ctx.clubId).limit(5000);
  return {
    ok: true,
    classes: programs.map((p) => ({
      id: p.id,
      title: p.title,
      dates: `${p.range_start} – ${p.range_end}`,
      status: p.status,
      audience: p.audience,
      registered: counts.get(p.id) ?? 0,
    })),
    league_teams: bits.teams.filter((t) => fits(t.name)).map((t) => ({ id: t.id, team: t.name, league: bits.leagues.find((l) => l.id === t.league_id)?.name })),
    upcoming_matchups: matchups,
    teams: ((ct as { id: string; name: string; archived: boolean | null }[] | null) ?? []).filter((t) => !t.archived && fits(t.name)).map((t) => ({ id: t.id, team: t.name })),
    events: ((ev as { id: string; name: string; event_date: string | null }[] | null) ?? []).filter((e) => fits(e.name)).slice(-20),
    playervault_people: ((vp as unknown[] | null) ?? []).length,
  };
}

async function previewRecipients(input: Record<string, unknown>, ctx: Ctx): Promise<ToolResult> {
  const b = await buildAudience(ctx, input.audience);
  if ('error' in b) return { ok: false, ...b };
  return {
    ok: true,
    inboxes: b.recipients.length,
    people: b.people_count,
    audience: b.used,
    recipients: b.recipients.slice(0, 200).map(line),
    more: b.recipients.length > 200 ? b.recipients.length - 200 : undefined,
    shared_inboxes: b.shared_inboxes.length || undefined,
    not_sent_to: excludedSummary(b),
    over_cap: b.recipients.length > SEND_CAP ? `Above the ${SEND_CAP}-inbox limit for one send — narrow it.` : undefined,
  };
}

// --------------------------------------------------------------- sends

async function deliver(ctx: Ctx, subject: string, body: string, to: Recipient[]) {
  const sender = await clubSender(ctx);
  const html = renderEmailHtml(ctx.clubName, body);
  const payloads = to.map((r) => ({
    to: r.email,
    subject,
    html,
    fromName: ctx.clubName,
    clubId: ctx.clubId,
    clubSlug: ctx.clubSlug,
    replyTo: sender.replyTo,
  }));
  const results = await sendBilledEmails(sender.ownerId, payloads);
  let sent = 0;
  let held = 0;
  const unsubscribed: string[] = [];
  const failed: string[] = [];
  results.forEach((r, i) => {
    const who = `${to[i].people.join(' & ')} — ${to[i].email}`;
    if (r?.sent) {
      if ((r as { demo?: unknown }).demo) held += 1;
      else sent += 1;
    } else if (r?.reason === 'unsubscribed') unsubscribed.push(who);
    else failed.push(`${who}${r && 'error' in r && r.error ? ` (${r.error})` : ''}`);
  });
  return { sent, held, unsubscribed, failed };
}

const sendTool: ToolDef<Ctx> = {
  schema: T_SEND,
  destructive: true,
  async preview(input, ctx) {
    const denied = canWrite(ctx);
    if (denied) return denied;
    const plan = await prepareSend(input ?? {}, ctx);
    if ('error' in plan) return { ok: false, ...plan };
    return {
      ok: true,
      will: plan.summary,
      send_key: plan.key,
      next: 'Show the director the subject, body and list. To send, call send_email again with the same subject, body, audience, this send_key and confirm:true. Offer "send me a test first".',
    };
  },
  async run(input, ctx) {
    const denied = canWrite(ctx);
    if (denied) return denied;
    const plan = await prepareSend(input ?? {}, ctx);
    if ('error' in plan) return { ok: false, ...plan };
    const given = String(input?.send_key ?? '').trim();
    if (!given) return { ok: false, error: 'Preview first: call send_email without confirm, show it, then send with its send_key.' };
    if (given !== plan.key) {
      return {
        ok: false,
        error:
          'This is not the email that was previewed — the text or the recipient list has changed since (a rewrite, a new ' +
          'registration, an unsubscribe). Nothing was sent. Preview it again and get a fresh yes.',
      };
    }
    try {
      const r = await deliver(ctx, plan.subject, plan.body, plan.built.recipients);
      return {
        ok: true,
        subject: plan.subject,
        inboxes: plan.built.recipients.length,
        delivered: r.sent,
        held_demo: r.held || undefined,
        demo_note: r.held ? `${ctx.clubName} is in demo mode, so ${r.held} were held and NOT delivered.` : undefined,
        skipped_unsubscribed: r.unsubscribed.length ? r.unsubscribed : undefined,
        failed: r.failed.length ? r.failed : undefined,
        not_sent_to: excludedSummary(plan.built),
      };
    } catch (e) {
      if (e instanceof CreditLimitError) {
        return { ok: false, error: `The club's email allowance is used up (${e.tier} plan, ${e.limit}). Nothing was sent. Upgrade at /pricing.` };
      }
      return { ok: false, error: e instanceof Error ? e.message : 'Could not send.' };
    }
  },
};

const testTool: ToolDef<Ctx> = {
  schema: T_TEST,
  async run(input, ctx) {
    const denied = canWrite(ctx);
    if (denied) return denied;
    const t = cleanText(input ?? {});
    if ('error' in t) return { ok: false, error: t.error };
    let wouldReach: number | undefined;
    if (input?.audience) {
      const b = await buildAudience(ctx, input.audience);
      if ('error' in b) return { ok: false, ...b };
      wouldReach = b.recipients.length;
    }
    const sender = await clubSender(ctx);
    if (!sender.directorEmail) return { ok: false, error: 'Could not find your login email, so there is nowhere to send a test.' };
    const me: Recipient = { email: normEmail(sender.directorEmail), people: ['you'], contacts: [], via: ['test'] };
    try {
      const r = await deliver(ctx, `[Test] ${t.subject}`, t.body, [me]);
      if (r.unsubscribed.length) return { ok: false, error: `${me.email} is on the unsubscribe list, so the test was not delivered.` };
      if (r.failed.length) return { ok: false, error: `The test did not send: ${r.failed[0]}` };
      return {
        ok: true,
        test_sent_to: me.email,
        held_demo: r.held ? 'Demo club — the test was held, not delivered.' : undefined,
        would_go_to: wouldReach,
        note: 'Only you received this. Nothing went to the audience.',
      };
    } catch (e) {
      if (e instanceof CreditLimitError) return { ok: false, error: "The club's email allowance is used up." };
      return { ok: false, error: e instanceof Error ? e.message : 'Could not send.' };
    }
  },
};

// --------------------------------------------------------------- opt-out list

type OptPlan = { targets: { email: string; people: string[]; on_list: boolean; since: string | null }[]; summary: Record<string, unknown> };

async function prepareOpt(input: Record<string, unknown>, ctx: Ctx, stopping: boolean): Promise<OptPlan | { error: string; candidates?: unknown }> {
  const names = (Array.isArray(input.people) ? input.people : []).map(String).filter((s) => s.trim());
  const typed = (Array.isArray(input.emails) ? input.emails : []).map(String).filter((s) => s.trim());
  if (!names.length && !typed.length) return { error: 'Whose email? Give names or addresses.' };
  const everyone = await loadEveryone(ctx, todayIn(ctx.timeZone));
  const found = new Map<string, Set<string>>();
  const note = (e: string, who: string) => found.set(e, (found.get(e) ?? new Set()).add(who));
  for (const n of names) {
    const hits = everyone.filter((c) => c.email && nameMatches(n, c.person));
    if (!hits.length) return { error: `No one called "${n}" with an email is in ${ctx.clubName}'s records.` };
    for (const h of hits) note(normEmail(h.email), h.person);
  }
  for (const t of typed) {
    const p = parseTyped(t);
    if (!p) return { error: `"${t}" is not an email address.` };
    const hits = everyone.filter((c) => normEmail(c.email) === p.email);
    if (!hits.length) return { error: `${p.email} is not in ${ctx.clubName}'s records, so it can't be changed from here.` };
    for (const h of hits) note(p.email, h.person);
  }
  const emails = [...found.keys()];
  const { data } = await ctx.db.from('email_unsubscribes').select('email, unsubscribed_at').eq('scope', 'all').in('email', emails);
  const on = new Map(((data as { email: string; unsubscribed_at: string | null }[] | null) ?? []).map((r) => [normEmail(r.email), r.unsubscribed_at]));
  const targets = emails.map((e) => ({ email: e, people: [...found.get(e)!].sort(), on_list: on.has(e), since: on.get(e) ?? null }));
  const todo = targets.filter((t) => (stopping ? !t.on_list : t.on_list));
  if (!todo.length) {
    return { error: stopping ? 'Those addresses are already unsubscribed.' : 'None of those addresses are unsubscribed — they already get club email.' };
  }
  const lines = todo.map((t) => `${t.people.join(' & ')} — ${t.email}${t.since ? ` (unsubscribed ${t.since.slice(0, 10)})` : ''}`);
  return {
    targets: todo,
    summary: stopping
      ? {
          stop_emailing: lines,
          already_off: targets.filter((t) => t.on_list).map((t) => t.email),
          note:
            "Uses ClubMode's shared unsubscribe list (the one the footer link writes), so these addresses stop getting " +
            'club broadcast email from ClubMode. Account alerts still arrive. Their records stay; undo with resume_emails_to.',
        }
      : {
          resume_emailing: lines,
          note: 'Only do this if they asked to be added back — an address that unsubscribed itself must not be re-added on our say-so.',
        },
  };
}

function optTool(schema: Anthropic.Messages.Tool, stopping: boolean): ToolDef<Ctx> {
  return {
    schema,
    destructive: true,
    async preview(input, ctx) {
      const denied = canWrite(ctx);
      if (denied) return denied;
      const plan = await prepareOpt(input ?? {}, ctx, stopping);
      if ('error' in plan) return { ok: false, ...plan };
      return { ok: true, will: plan.summary };
    },
    async run(input, ctx) {
      const denied = canWrite(ctx);
      if (denied) return denied;
      const plan = await prepareOpt(input ?? {}, ctx, stopping);
      if ('error' in plan) return { ok: false, ...plan };
      const errors: string[] = [];
      for (const t of plan.targets) {
        const r = stopping ? await recordUnsubscribe(t.email) : await removeUnsubscribe(t.email);
        if (!r.success) errors.push(`${t.email}: ${r.error ?? 'failed'}`);
      }
      if (errors.length) return { ok: false, error: errors.join('; '), did: plan.summary };
      return { ok: true, did: plan.summary };
    },
  };
}

// --------------------------------------------------------------- tool table

const tools: ToolDef<Ctx>[] = [
  { schema: T_LIST, run: (i, c) => listAudiences(i ?? {}, c) },
  { schema: T_WHO, run: (i, c) => previewRecipients(i ?? {}, c) },
  sendTool,
  testTool,
  optTool(T_STOP, true),
  optTool(T_RESUME, false),
  {
    schema: T_SCHEDULE,
    run: async () => ({
      ok: false,
      error:
        "ClubMode can't schedule a club email for later yet — the only scheduled sender is the sales CRM's, which is not " +
        'for club members. Offer to send it now, or remind the director to ask again at that time.',
    }),
  },
  {
    schema: T_STATUS,
    run: async () => ({
      ok: false,
      error:
        'ClubMode keeps no log of club emails sent from here and does not track opens. The send_email result earlier in ' +
        'this chat is the record: how many were delivered, skipped (unsubscribed) or failed, by name.',
    }),
  },
];

// -------------------------------------------------------------------- export

export const commsPack: DomainPack<Ctx> = {
  domain: 'comms',

  actionsPrompt: `
COMMS — you can email the club's people from the club's name.

Reads: list_audiences (classes incl. past sessions, league teams/matchups, teams, events), preview_recipients
("who would get this?" — names behind every inbox, who is left out and why).
Sends (owner/director only): send_email (preview → confirm with send_key), send_test_email (to the director only),
stop_emails_to / resume_emails_to (the unsubscribe list).

How to work:
- Draft in the director's plain voice: short, friendly, no marketing fluff, no emoji unless they use them. Put
  every link and time they gave you in the body. Sign off as the director/club the way they do.
- Build the audience from what they said ("anyone who did Tennis 101" → classes ["Tennis 101"]; "the last session"
  → class_scope most_recent_started; "kids 12 and under" → max_age 12; "this week's match" → league_matchup date).
- Always call send_email WITHOUT confirm first and show: subject, the full body, recipient count, the names, and
  who is NOT getting it (no email, unsubscribed, unknown age). Always offer "want me to send you a test first?".
- Rewrites ("more casual", "shorter") → change the text and preview again; the old send_key no longer works.
- Send only after a clear yes, passing the SAME subject/body/audience plus send_key and confirm:true.
- After sending, report delivered / skipped / failed by name and anyone unreachable.

You CANNOT, and must say so plainly: send texts/SMS, schedule for later, or tell who opened an email.
`.trim(),

  async resolve(userId) {
    return resolveClubCtx(userId);
  },

  tools,
};
