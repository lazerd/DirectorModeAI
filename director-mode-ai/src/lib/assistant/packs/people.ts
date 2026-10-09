import crypto from 'crypto';
import type Anthropic from '@anthropic-ai/sdk';
import type { DomainPack, ToolDef, ToolResult } from '../framework';
import { resolveClubCtx, MANAGER_ROLES, type ClubCtx } from '../clubContext';
import { sendBilledEmail, resolveCoachUserId, CreditLimitError } from '@/lib/email';
import { zonedWallTimeToIso } from '@/lib/captain/clubTime';
import { ROLE_LABEL } from '@/lib/clubRoles';
import { isLevelValue } from '@/lib/levels';
import {
  clubRoster,
  gameGroup,
  gameGuestLinks,
  genderFits,
  levelFits,
  loadClub,
  loadGame,
  GAME_COLS,
  type Club,
  type Game,
  type RosterRow,
} from '@/lib/partnerFinder/server';
import { cancelGame, hostAddPlayer } from '@/lib/partnerFinder/actions';
import { inviteMembers } from '@/lib/partnerFinder/notify';
import {
  DAILY_POST_LIMIT,
  MAX_RECIPIENTS,
  MAX_SPOTS,
  gameTitle,
  isFormat,
  isGender,
  ratingLabel,
  shortName,
} from '@/lib/partnerFinder/format';
import { lessonCancelEmail } from '@/lib/lessons/cancelEmail';

/*
 * People pack — the club's people, its pickup games, and its lessons.
 *
 *   "What's Simon Chan's email? Is he a member? What's Shannon's access?"
 *   "Lawrence Browne is actually Walden Browne."  "Delete the Simon Chan duplicate."
 *   "Lauren isn't getting the match emails — why?"  "Add these 30 members."
 *   "Post a doubles game tomorrow 1pm at my level."  "Who said yes?"
 *   "Add my friend Pete to the game."  "Cancel it."
 *   "What lessons does Julia have this week?"  "Cancel her 4pm."
 *
 * A PERSON IS A PLAYERVAULT ROW (cc_vault_players), never an email: a household
 * shares an inbox, and two kids behind one address are two people. Names are
 * matched word-for-word, ids are the handle once found, and an address shared
 * by several people is shown as exactly that.
 *
 * SAME PATHS AS THE APP. A rename or contact fix is the same update the
 * PlayerVault edit form makes; a bulk add is the same insert the Add Player form
 * makes. CourtConnect posting, seating and cancelling go through pf_post_game /
 * hostAddPlayer / cancelGame and the CourtConnect mailer (inviteMembers /
 * afterCancel) — the rules there (only the poster may seat or cancel; one
 * invite per fitting member; muted and unsubscribed members skipped) are the
 * rules here. Cancelling a lesson does what the LessonMode dashboard does:
 * remove the slot and send LessonMode's own cancellation email to the client.
 *
 * WHAT IT DELIBERATELY CANNOT DO (each says so in plain words):
 *   - Link family members: PlayerVault has no household / parent link.
 *   - Merge two records: there is no merge. A duplicate with NO history can be
 *     removed; one with any history (games, attendance, a login) is refused.
 *   - Move a lesson, or block Open Lesson Time: neither exists in LessonMode
 *     (Open Lesson Time is read from the coach's own calendar).
 *   - Charge anyone, or send through anything but the paths above.
 *
 * Writes need owner/director/platform. A coach may read, and may cancel a
 * lesson that is their own (lesson_coaches.profile_id is their login).
 */

type Ctx = ClubCtx;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const HM = /^\d{1,2}:\d{2}$/;
const EMAIL = /^[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+$/;
/** Most people one bulk add takes, so a pasted spreadsheet cannot seat a whole town. */
export const ADD_CAP = 200;
const LIST_CAP = 60;

// --------------------------------------------------------------- utilities

const norm = (s: unknown) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
const normEmail = (s: unknown) => String(s ?? '').trim().toLowerCase();
const hash = (v: unknown) => crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex').slice(0, 16);

const todayIn = (tz: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

const addDays = (ymd: string, days: number): string => {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

const when = (iso: string, tz: string) =>
  new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(
    new Date(iso),
  );
const clock = (iso: string, tz: string) =>
  new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
const mdy = (iso: string, tz: string) =>
  new Intl.DateTimeFormat('en-US', { timeZone: tz, month: '2-digit', day: '2-digit', year: 'numeric' }).format(new Date(iso));

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Does a typed name refer to this person? Every word typed must be a word of the
 * name ("Chan" → Simon Chan; "Simon Chan" → Simon Chan). Never a substring —
 * "Ann" is not "Anne-Marie".
 */
export function nameMatches(term: string, name: string | null | undefined): boolean {
  const words = norm(name).split(/[\s,.'-]+/).filter(Boolean);
  const typed = norm(term).split(/[\s,.'-]+/).filter(Boolean);
  if (!typed.length || !words.length) return false;
  return typed.every((t) => words.includes(t));
}

function canWrite(ctx: Ctx): ToolResult | null {
  if (MANAGER_ROLES.has(ctx.role)) return null;
  return {
    ok: false,
    error: `Your role here is "${ctx.role}", which can look people, games and lessons up but not change them. An owner or director can.`,
  };
}

// --------------------------------------------------------------- people

type Person = {
  id: string;
  club_id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  gender: string | null;
  age: number | null;
  usta_rating: number | null;
  wtn: number | null;
  utr_singles: number | null;
  membership_status: string | null;
  user_id: string | null;
  created_at: string | null;
};

const PERSON_COLS =
  'id, club_id, full_name, email, phone, gender, age, usta_rating, wtn, utr_singles, membership_status, user_id, created_at';

async function vault(ctx: Ctx): Promise<Person[]> {
  const { data } = await ctx.db.from('cc_vault_players').select(PERSON_COLS).eq('club_id', ctx.clubId).limit(10000);
  return (data as Person[] | null) ?? [];
}

type Found = { person: Person } | { error: string; candidates?: unknown };

/** One person at this club, by id or by name. Several matches → ask, never pick. */
async function findOne(ctx: Ctx, term: string, people?: Person[], label = 'person'): Promise<Found> {
  const t = String(term ?? '').trim();
  if (!t) return { error: `Say which ${label}.` };
  const all = people ?? (await vault(ctx));
  const hits = UUID.test(t) ? all.filter((p) => p.id === t) : all.filter((p) => nameMatches(t, p.full_name));
  if (!hits.length) return { error: `Nobody on ${ctx.clubName}'s PlayerVault matches "${t}".` };
  if (hits.length > 1) {
    return {
      error: `"${t}" matches ${hits.length} people. Ask which one, then pass their id.`,
      candidates: hits.slice(0, 15).map((p) => ({ id: p.id, name: p.full_name, email: p.email, added: p.created_at?.slice(0, 10) ?? null })),
    };
  }
  return { person: hits[0] };
}

/** Logins at this club, with role and name. Email comes from auth, one lookup each. */
async function clubAccounts(ctx: Ctx): Promise<Map<string, { role: string; name: string | null }>> {
  const { data } = await ctx.db.from('cc_club_members').select('user_id, role').eq('club_id', ctx.clubId);
  const rows = (data as { user_id: string; role: string }[] | null) ?? [];
  const ids = rows.map((r) => r.user_id);
  const { data: profs } = ids.length
    ? await ctx.db.from('profiles').select('id, full_name').in('id', ids)
    : { data: [] as { id: string; full_name: string | null }[] };
  const names = new Map(((profs as { id: string; full_name: string | null }[] | null) ?? []).map((p) => [p.id, p.full_name]));
  return new Map(rows.map((r) => [r.user_id, { role: r.role, name: names.get(r.user_id) ?? null }]));
}

async function authEmail(ctx: Ctx, userId: string): Promise<string | null> {
  try {
    const r = await ctx.db.auth.admin.getUserById(userId);
    return r.data?.user?.email ?? null;
  } catch {
    return null;
  }
}

const accessLabel = (role: string | undefined) =>
  !role ? 'roster only — no login' : `${ROLE_LABEL[role] ?? role}${role === 'member' ? ' (member login, no staff access)' : ''}`;

/** What a record has hanging off it. Anything here makes it unsafe to remove. */
async function history(ctx: Ctx, p: Person): Promise<{ lines: string[]; blocking: boolean }> {
  const [{ data: seats }, { data: links }, { data: friends }, { data: att }, { data: prefs }] = await Promise.all([
    ctx.db.from('pf_game_players').select('status').eq('person_id', p.id),
    ctx.db.from('pf_links').select('emailed_at').eq('person_id', p.id),
    ctx.db.from('pf_guest_contacts').select('id').eq('owner_person_id', p.id),
    ctx.db.from('club_program_attendance').select('id').eq('vault_player_id', p.id),
    ctx.db.from('pf_member_prefs').select('notify_games, phone').eq('person_id', p.id),
  ]);
  const posted = p.user_id
    ? (((await ctx.db.from('pf_games').select('id').eq('club_id', ctx.clubId).eq('posted_by', p.user_id)).data as unknown[] | null) ?? [])
    : [];
  const s = (seats as { status: string }[] | null) ?? [];
  const emailed = ((links as { emailed_at: string | null }[] | null) ?? []).filter((l) => l.emailed_at).length;
  const pr = ((prefs as { notify_games: boolean; phone: string | null }[] | null) ?? [])[0];
  const lines: string[] = [];
  if (p.user_id) lines.push('has a login');
  if (s.length) lines.push(`${s.length} CourtConnect game answer${s.length === 1 ? '' : 's'} (${s.filter((x) => x.status === 'in').length} in)`);
  if (posted.length) lines.push(`posted ${posted.length} game${posted.length === 1 ? '' : 's'}`);
  if (emailed) lines.push(`emailed about ${emailed} game${emailed === 1 ? '' : 's'}`);
  if ((friends as unknown[] | null)?.length) lines.push(`${(friends as unknown[]).length} saved guest contact(s)`);
  if ((att as unknown[] | null)?.length) lines.push(`${(att as unknown[]).length} class attendance mark(s)`);
  if (pr && (pr.notify_games === false || pr.phone)) lines.push('changed their CourtConnect settings');
  return { lines, blocking: lines.length > 0 };
}

const card = (p: Person) => ({
  id: p.id,
  name: p.full_name,
  email: p.email,
  phone: p.phone,
  added: p.created_at?.slice(0, 10) ?? null,
});

// ---------------------------------------------------------------- find_person

async function findPerson(input: { name?: string }, ctx: Ctx): Promise<ToolResult> {
  const term = String(input?.name ?? '').trim();
  if (!term) return { ok: false, error: 'Say who to look up.' };
  const [people, accounts] = await Promise.all([vault(ctx), clubAccounts(ctx)]);
  const hits = UUID.test(term) ? people.filter((p) => p.id === term) : people.filter((p) => nameMatches(term, p.full_name));

  const ids = hits.map((h) => h.id);
  const { data: prefRows } = ids.length
    ? await ctx.db.from('pf_member_prefs').select('person_id, notify_games').eq('club_id', ctx.clubId).in('person_id', ids)
    : { data: [] };
  const muted = new Set(((prefRows as { person_id: string; notify_games: boolean }[] | null) ?? []).filter((r) => r.notify_games === false).map((r) => r.person_id));

  const out = await Promise.all(
    hits.slice(0, 20).map(async (p) => {
      const acct = p.user_id ? accounts.get(p.user_id) : undefined;
      const email = p.email || (p.user_id ? await authEmail(ctx, p.user_id) : null);
      const sharers = email
        ? people.filter((o) => o.id !== p.id && normEmail(o.email) === normEmail(email)).map((o) => o.full_name)
        : [];
      return {
        id: p.id,
        name: p.full_name,
        email,
        phone: p.phone,
        on_playervault: true,
        membership: p.membership_status === 'inactive' ? 'inactive (CourtConnect skips them)' : p.membership_status || 'active',
        access: accessLabel(acct?.role),
        level: p.usta_rating ?? null,
        wtn: p.wtn ?? null,
        utr: p.utr_singles ?? null,
        gender: p.gender,
        age: p.age,
        courtconnect_game_emails: !email ? 'no email on file' : muted.has(p.id) ? 'turned off by them' : 'on',
        shares_inbox_with: sharers.length ? sharers : undefined,
      };
    }),
  );

  // Staff/members with a login but no PlayerVault row (a coach added by role only).
  const vaultUsers = new Set(people.map((p) => p.user_id).filter(Boolean));
  const loginOnly: { name: string | null; email: string | null; access: string }[] = [];
  for (const [uid, a] of accounts) {
    if (vaultUsers.has(uid) || !a.name || !nameMatches(term, a.name)) continue;
    loginOnly.push({ name: a.name, email: await authEmail(ctx, uid), access: accessLabel(a.role) });
  }

  if (!out.length && !loginOnly.length) {
    return { ok: true, found: 0, note: `Nobody at ${ctx.clubName} matches "${term}" — not on PlayerVault and no login. Not a member here.` };
  }
  return {
    ok: true,
    found: out.length + loginOnly.length,
    people: out,
    login_only: loginOnly.length ? loginOnly : undefined,
    more: hits.length > 20 ? `${hits.length - 20} more — narrow the name.` : undefined,
    note: loginOnly.length ? 'login_only people have a ClubMode login here but no PlayerVault row.' : undefined,
  };
}

// --------------------------------------------------------------- update_person

type UpdatePlan = { error: string; candidates?: unknown } | { person: Person; patch: Record<string, string | null>; changes: string[]; warnings: string[] };

async function planUpdate(input: any, ctx: Ctx): Promise<UpdatePlan> {
  const people = await vault(ctx);
  const f = await findOne(ctx, input?.person, people);
  if ('error' in f) return f;
  const p = f.person;
  const patch: Record<string, string | null> = {};
  const changes: string[] = [];
  const warnings: string[] = [];
  if (input?.full_name !== undefined) {
    const n = String(input.full_name).trim().replace(/\s+/g, ' ');
    if (!n) return { error: 'The new name is blank.' };
    if (n !== p.full_name) {
      patch.full_name = n;
      changes.push(`name: "${p.full_name}" → "${n}"`);
      const clash = people.filter((o) => o.id !== p.id && norm(o.full_name) === norm(n));
      if (clash.length) warnings.push(`${clash.length} other record(s) are already called "${n}" — this may be a duplicate (ids: ${clash.map((c) => c.id).join(', ')}).`);
    }
  }
  if (input?.email !== undefined) {
    const e = normEmail(input.email);
    if (e && !EMAIL.test(e)) return { error: `"${input.email}" does not look like an email address.` };
    if ((e || null) !== (p.email ? normEmail(p.email) : null)) {
      patch.email = e || null;
      changes.push(`email: ${p.email || '(none)'} → ${e || '(none)'}`);
      const sharers = e ? people.filter((o) => o.id !== p.id && normEmail(o.email) === e) : [];
      if (sharers.length) warnings.push(`That inbox is also on file for ${sharers.map((s) => s.full_name).join(', ')} — fine for a household; they stay separate people.`);
    }
  }
  if (input?.phone !== undefined) {
    const ph = String(input.phone ?? '').trim();
    if ((ph || null) !== (p.phone || null)) {
      patch.phone = ph || null;
      changes.push(`phone: ${p.phone || '(none)'} → ${ph || '(none)'}`);
    }
  }
  if (!changes.length) return { error: `Nothing to change — ${p.full_name}'s record already says that.` };
  if (p.user_id && patch.full_name) warnings.push('They have a login; the name on their own account settings is theirs and is not changed.');
  return { person: p, patch, changes, warnings };
}

// ---------------------------------------------------------- remove_duplicate

type DupPlan =
  | { error: string; candidates?: unknown; keep_has?: string[]; remove_has?: string[] }
  | { keep: Person; remove: Person; keepHas: string[]; removeHas: string[] };

async function planDuplicate(input: any, ctx: Ctx): Promise<DupPlan> {
  const people = await vault(ctx);
  const withHistory = async (term: string, label: string) => {
    const f = await findOne(ctx, term, people, label);
    if ('error' in f && Array.isArray(f.candidates)) {
      // Show what each candidate has, so the director can tell the real one from the copy.
      const c = await Promise.all(
        (f.candidates as { id: string }[]).map(async (x) => {
          const p = people.find((pp) => pp.id === x.id)!;
          return { ...card(p), has: (await history(ctx, p)).lines };
        }),
      );
      return { error: f.error, candidates: c };
    }
    return f;
  };
  const k = await withHistory(input?.keep, 'record to keep');
  if ('error' in k) return k;
  const r = await withHistory(input?.remove, 'record to remove');
  if ('error' in r) return r;
  if (k.person.id === r.person.id) return { error: 'Keep and remove are the same record. Pass the two different ids.' };
  const [kh, rh] = await Promise.all([history(ctx, k.person), history(ctx, r.person)]);
  if (rh.blocking) {
    return {
      error:
        `The record to remove (${r.person.full_name}, ${r.person.email || 'no email'}) has history: ${rh.lines.join('; ')}. ` +
        'ClubMode has no merge, and removing it would lose that history, so it was not removed. Fix the details on the ' +
        'record that has the history instead, or remove the other one if it is the empty copy.',
      keep_has: kh.lines,
      remove_has: rh.lines,
    };
  }
  return { keep: k.person, remove: r.person, keepHas: kh.lines, removeHas: rh.lines };
}

// --------------------------------------------------------------- why_no_emails

async function whyNoEmails(input: { name?: string }, ctx: Ctx): Promise<ToolResult> {
  const term = String(input?.name ?? '').trim();
  const people = await vault(ctx);
  const hits = UUID.test(term) ? people.filter((p) => p.id === term) : people.filter((p) => nameMatches(term, p.full_name));

  // Team rosters keep their OWN email per player — a common reason the vault looks right and mail still misses.
  const { data: teams } = await ctx.db.from('captain_teams').select('id, name, archived').eq('club_id', ctx.clubId);
  const teamRows = ((teams as { id: string; name: string; archived: boolean | null }[] | null) ?? []).filter((t) => !t.archived);
  const { data: cps } = teamRows.length
    ? await ctx.db.from('captain_players').select('team_id, name, email, contact2_email, active').in('team_id', teamRows.map((t) => t.id))
    : { data: [] };
  const onTeams = ((cps as { team_id: string; name: string; email: string | null; contact2_email: string | null; active: boolean }[] | null) ?? [])
    .filter((c) => nameMatches(term, c.name))
    .map((c) => ({
      team: teamRows.find((t) => t.id === c.team_id)?.name ?? 'team',
      name: c.name,
      emails: [c.email, c.contact2_email].filter(Boolean),
      active: c.active !== false,
    }));
  const { data: lg } = await ctx.db.from('leagues').select('id').eq('club_id', ctx.clubId);
  const leagueIds = ((lg as { id: string }[] | null) ?? []).map((l) => l.id);
  const { data: lteams } = leagueIds.length ? await ctx.db.from('league_clubs').select('id, name').in('league_id', leagueIds) : { data: [] };
  const lt = (lteams as { id: string; name: string }[] | null) ?? [];
  const { data: lr } = lt.length
    ? await ctx.db.from('league_team_rosters').select('club_id, player_name, player_email, parent_email, status').in('club_id', lt.map((t) => t.id))
    : { data: [] };
  const onLeague = ((lr as { club_id: string; player_name: string; player_email: string | null; parent_email: string | null; status: string }[] | null) ?? [])
    .filter((r) => nameMatches(term, r.player_name))
    .map((r) => ({ team: lt.find((t) => t.id === r.club_id)?.name ?? 'league team', name: r.player_name, emails: [r.player_email, r.parent_email].filter(Boolean), active: !r.status || r.status === 'active' }));

  if (!hits.length && !onTeams.length && !onLeague.length) {
    return { ok: true, findings: [`Nobody at ${ctx.clubName} matches "${term}" — not on PlayerVault or any team roster, so no club email can reach them.`] };
  }
  if (hits.length > 1) {
    return { ok: false, error: `"${term}" matches ${hits.length} people. Ask which one.`, candidates: hits.map(card) };
  }

  const findings: string[] = [];
  const p = hits[0];
  const emails = new Set<string>();
  if (p) {
    const email = p.email || (p.user_id ? await authEmail(ctx, p.user_id) : null);
    if (!email) findings.push('No email on their PlayerVault record, so CourtConnect and club email have nowhere to send.');
    else emails.add(normEmail(email));
    if (p.membership_status === 'inactive') findings.push('Their PlayerVault record is marked inactive — CourtConnect leaves inactive members out.');
    const [{ data: pr }, { data: mem }] = await Promise.all([
      ctx.db.from('pf_member_prefs').select('notify_games').eq('club_id', ctx.clubId).eq('person_id', p.id),
      p.user_id ? ctx.db.from('cc_club_members').select('role').eq('club_id', ctx.clubId).eq('user_id', p.user_id) : Promise.resolve({ data: [] }),
    ]);
    if (((pr as { notify_games: boolean }[] | null) ?? [])[0]?.notify_games === false) {
      findings.push('They turned off CourtConnect game emails themselves (the stop link). Only they can turn it back on, from the board.');
    }
    if (((mem as { role: string }[] | null) ?? [])[0]?.role === 'maintenance') findings.push('Their login is maintenance crew, which CourtConnect never emails.');
    if (p.usta_rating == null) findings.push('No level on PlayerVault. Games posted for a level range skip unrated members unless the poster allowed "unrated".');

    // The last 30 days of games: how many fit them, how many they were emailed about.
    const since = new Date(Date.now() - 30 * 864e5).toISOString();
    const { data: games } = await ctx.db.from('pf_games').select(GAME_COLS).eq('club_id', ctx.clubId).gte('created_at', since);
    const gs = (games as Game[] | null) ?? [];
    if (gs.length) {
      const { data: lk } = await ctx.db.from('pf_links').select('game_id, emailed_at').eq('person_id', p.id);
      const emailedIds = new Set(((lk as { game_id: string; emailed_at: string | null }[] | null) ?? []).filter((l) => l.emailed_at).map((l) => l.game_id));
      const fit = gs.filter((g) => g.posted_by !== p.user_id && levelFits({ ...g, rating_min: g.rating_min == null ? null : Number(g.rating_min), rating_max: g.rating_max == null ? null : Number(g.rating_max) }, p.usta_rating == null ? null : Number(p.usta_rating)) && genderFits(g, p.gender?.toLowerCase()));
      findings.push(
        `CourtConnect, last 30 days: ${gs.length} game(s) posted, ${fit.length} fit their level, they were emailed about ${gs.filter((g) => emailedIds.has(g.id)).length}.`,
      );
    } else findings.push('No CourtConnect games were posted at the club in the last 30 days.');

    const sharers = email ? people.filter((o) => o.id !== p.id && normEmail(o.email) === normEmail(email)).map((o) => o.full_name) : [];
    if (sharers.length) findings.push(`Their inbox is shared with ${sharers.join(', ')} — one email per inbox; check it is the inbox they read.`);
  } else {
    findings.push('Not on PlayerVault, so CourtConnect games and member emails never include them.');
  }

  for (const t of [...onTeams, ...onLeague]) for (const e of t.emails) emails.add(normEmail(e));
  if (emails.size) {
    const { data: un } = await ctx.db.from('email_unsubscribes').select('email, unsubscribed_at').eq('scope', 'all').in('email', [...emails]);
    for (const u of (un as { email: string; unsubscribed_at: string | null }[] | null) ?? []) {
      findings.push(`${u.email} is on the unsubscribe list${u.unsubscribed_at ? ` (since ${u.unsubscribed_at.slice(0, 10)})` : ''} — nothing from ClubMode reaches it. The comms pack can put it back only if they asked.`);
    }
  }
  if (!onTeams.length && !onLeague.length) {
    findings.push('Not on any team or league roster here, so captains\' lineup / match emails do not include them.');
  } else {
    for (const t of [...onTeams, ...onLeague]) {
      const vaultEmail = p?.email ? normEmail(p.email) : null;
      const differs = vaultEmail && t.emails.length && !t.emails.map(normEmail).includes(vaultEmail);
      findings.push(
        `On "${t.team}"${t.active ? '' : ' (inactive on that roster)'} with ${t.emails.length ? t.emails.join(', ') : 'NO email'}` +
          (differs ? ` — different from PlayerVault's ${p!.email}; match emails go to the roster's address.` : '.'),
      );
    }
  }
  findings.push('ClubMode does not record bounces or spam-folder delivery; if nothing above explains it, ask them to check spam and add the club address.');
  return { ok: true, person: p ? card(p) : null, findings };
}

// --------------------------------------------------------------- add_members

type NewPerson = { name: string; email: string | null; phone: string | null };
type AddPlan = {
  add: (NewPerson & { note?: string })[];
  already: string[];
  possibleDuplicates: string[];
  invalid: string[];
};

async function planAdd(input: any, ctx: Ctx): Promise<AddPlan | { error: string }> {
  const list = Array.isArray(input?.people) ? input.people : [];
  if (!list.length) return { error: 'Give the people to add: name, and email/phone where known.' };
  if (list.length > ADD_CAP) return { error: `That is ${list.length} people; add ${ADD_CAP} or fewer at a time.` };
  const anyway = new Set(((input?.add_anyway as string[]) ?? []).map(norm));
  const people = await vault(ctx);
  const plan: AddPlan = { add: [], already: [], possibleDuplicates: [], invalid: [] };
  const seen = new Set<string>();
  for (const raw of list) {
    const name = String(raw?.name ?? '').trim().replace(/\s+/g, ' ');
    const email = normEmail(raw?.email) || null;
    const phone = String(raw?.phone ?? '').trim() || null;
    if (!name) {
      plan.invalid.push(`(no name)${email ? ` ${email}` : ''}`);
      continue;
    }
    if (email && !EMAIL.test(email)) {
      plan.invalid.push(`${name} — "${raw.email}" is not an email address`);
      continue;
    }
    const key = `${norm(name)}|${email ?? ''}`;
    if (seen.has(key)) continue; // repeated in the list
    seen.add(key);
    const sameName = people.filter((p) => norm(p.full_name) === norm(name));
    if (sameName.some((p) => !email || !p.email || normEmail(p.email) === email)) {
      plan.already.push(`${name}${email ? ` (${email})` : ''}`);
      continue;
    }
    if (sameName.length && !anyway.has(norm(name))) {
      plan.possibleDuplicates.push(`${name} (${email}) — PlayerVault already has ${name} at ${sameName.map((s) => s.email).join(', ')}`);
      continue;
    }
    // Same inbox, different name: a household. A different person — added, and said so.
    const sharers = email ? people.filter((p) => normEmail(p.email) === email).map((p) => p.full_name) : [];
    plan.add.push({ name, email, phone, note: sharers.length ? `shares an inbox with ${sharers.join(', ')}` : undefined });
  }
  return plan;
}

// --------------------------------------------------------------- CourtConnect

/** The director as a CourtConnect person: their PlayerVault row with their login. */
async function me(ctx: Ctx, roster: RosterRow[]): Promise<RosterRow | null> {
  return roster.find((r) => r.user_id === ctx.userId) ?? null;
}

const NOT_ON_VAULT = (club: string) =>
  `You have no PlayerVault row at ${club} tied to your login, so CourtConnect cannot act as you (games are posted, ` +
  'seated and cancelled by their poster). Add yourself on PlayerVault with your login email first.';

async function findGame(ctx: Ctx, term: unknown): Promise<{ game: Game } | { error: string; candidates?: unknown }> {
  const t = String(term ?? '').trim();
  if (UUID.test(t)) {
    const g = await loadGame(ctx.db, t);
    if (!g || g.club_id !== ctx.clubId) return { error: `No CourtConnect game with that id at ${ctx.clubName}.` };
    return { game: g };
  }
  if (!YMD.test(t)) return { error: 'Name the game by its id, or by its date (YYYY-MM-DD). list_games shows both.' };
  const from = zonedWallTimeToIso(`${t}T00:00`, ctx.timeZone)!;
  const to = zonedWallTimeToIso(`${addDays(t, 1)}T00:00`, ctx.timeZone)!;
  const { data } = await ctx.db.from('pf_games').select(GAME_COLS).eq('club_id', ctx.clubId).gte('starts_at', from).lt('starts_at', to);
  const gs = (data as Game[] | null) ?? [];
  if (!gs.length) return { error: `No CourtConnect game on ${t} at ${ctx.clubName}.` };
  if (gs.length > 1) {
    return { error: `${gs.length} games on ${t}. Ask which, then pass its id.`, candidates: gs.map((g) => ({ id: g.id, game: gameTitle(g, ctx.timeZone), status: g.status })) };
  }
  return { game: gs[0] };
}

async function listGames(input: { days_back?: number; days_ahead?: number }, ctx: Ctx): Promise<ToolResult> {
  const back = Math.min(Math.max(Number(input?.days_back ?? 0) || 0, 0), 60);
  const ahead = Math.min(Math.max(Number(input?.days_ahead ?? 14) || 14, 0), 60);
  const today = todayIn(ctx.timeZone);
  const from = zonedWallTimeToIso(`${addDays(today, -back)}T00:00`, ctx.timeZone)!;
  const to = zonedWallTimeToIso(`${addDays(today, ahead + 1)}T00:00`, ctx.timeZone)!;
  const { data } = await ctx.db.from('pf_games').select(GAME_COLS).eq('club_id', ctx.clubId).gte('starts_at', from).lt('starts_at', to).order('starts_at');
  const gs = ((data as Game[] | null) ?? []).slice(0, LIST_CAP);
  if (!gs.length) return { ok: true, games: [], note: 'No CourtConnect games in that window.' };
  const club = await loadClub(ctx.db, ctx.clubId);
  const roster = await clubRoster(ctx.db, ctx.clubId);
  const { data: seats } = await ctx.db.from('pf_game_players').select('game_id, status').in('game_id', gs.map((g) => g.id));
  const inCount = new Map<string, number>();
  for (const s of (seats as { game_id: string; status: string }[] | null) ?? []) if (s.status === 'in') inCount.set(s.game_id, (inCount.get(s.game_id) ?? 0) + 1);
  return {
    ok: true,
    games: gs.map((g) => ({
      id: g.id,
      game: gameTitle(g, ctx.timeZone),
      level: ratingLabel(g.rating_min, g.rating_max, club?.levels) || 'any level',
      poster: roster.find((r) => r.user_id === g.posted_by)?.full_name ?? 'a member',
      yours: g.posted_by === ctx.userId,
      players_in: `${inCount.get(g.id) ?? 0} of ${g.spots_needed}`,
      status: g.status,
      court: g.court,
    })),
  };
}

async function gameAnswers(input: { game?: string }, ctx: Ctx): Promise<ToolResult> {
  const f = await findGame(ctx, input?.game);
  if ('error' in f) return { ok: false, ...f };
  const g = f.game;
  const roster = await clubRoster(ctx.db, ctx.clubId);
  const byId = new Map(roster.map((r) => [r.person_id, r]));
  const [{ data: seats }, { data: links }, friends] = await Promise.all([
    ctx.db.from('pf_game_players').select('person_id, guest_name, status, via, joined_at').eq('game_id', g.id).order('joined_at'),
    ctx.db.from('pf_links').select('person_id, emailed_at').eq('game_id', g.id),
    gameGuestLinks(ctx.db, g.id),
  ]);
  const s = (seats as { person_id: string | null; guest_name: string | null; status: string; via: string | null }[] | null) ?? [];
  const nm = (x: { person_id: string | null; guest_name: string | null }) =>
    x.person_id ? byId.get(x.person_id)?.full_name ?? 'a member' : `${x.guest_name || 'Guest'} (guest)`;
  const heard = new Set(s.map((x) => x.person_id).filter(Boolean));
  const emailed = ((links as { person_id: string; emailed_at: string | null }[] | null) ?? []).filter((l) => l.emailed_at);
  const poster = roster.find((r) => r.user_id === g.posted_by)?.full_name ?? 'a member';
  return {
    ok: true,
    game: gameTitle(g, ctx.timeZone),
    id: g.id,
    status: g.status,
    poster,
    yes: [poster + ' (poster)', ...s.filter((x) => x.status === 'in').map((x) => nm(x) + (x.via === 'host' ? ' — added by host' : ''))],
    spots: `${s.filter((x) => x.status === 'in').length} of ${g.spots_needed} filled`,
    waiting_list: s.filter((x) => x.status === 'wait').map(nm),
    no: s.filter((x) => x.status === 'no').map(nm),
    dropped_out: s.filter((x) => x.status === 'left').map(nm),
    emailed: emailed.length,
    emailed_no_reply: emailed.filter((l) => !heard.has(l.person_id)).map((l) => byId.get(l.person_id)?.full_name ?? 'a member'),
    friends_invited: friends.length ? friends.map((f2) => `${f2.name}: ${f2.status}`) : undefined,
  };
}

type PostPlan =
  | { error: string; candidates?: unknown }
  | {
      club: Club;
      mePerson: RosterRow;
      startsAt: string;
      format: string;
      duration: number;
      spots: number;
      min: number | null;
      max: number | null;
      includeUnrated: boolean;
      gender: string | null;
      court: string;
      note: string;
      partners: { personId: string | null; guest: string | null; name: string }[];
      recipients: RosterRow[];
      skipped: { muted: number; unsubscribed: number; no_email: number; other_level_or_gender: number };
      key: string;
    };

const DEFAULT_NEEDED: Record<string, number> = { doubles: 3, mixed: 3, singles: 1, hitting: 1 };

async function planPost(input: any, ctx: Ctx): Promise<PostPlan> {
  const club = await loadClub(ctx.db, ctx.clubId);
  if (!club) return { error: 'Club not found.' };
  const { data: mem } = await ctx.db.from('cc_club_members').select('role').eq('club_id', ctx.clubId).eq('user_id', ctx.userId);
  const myRole = ((mem as { role: string }[] | null) ?? [])[0]?.role;
  if (!myRole || myRole === 'maintenance') return { error: `Your login is not a member of ${ctx.clubName}, so CourtConnect will not post as you.` };
  const roster = await clubRoster(ctx.db, ctx.clubId);
  const mine = await me(ctx, roster);
  if (!mine) return { error: NOT_ON_VAULT(ctx.clubName) };

  const date = String(input?.date ?? '');
  const time = String(input?.time ?? '');
  if (!YMD.test(date) || !HM.test(time)) return { error: 'Give the date as YYYY-MM-DD and the time as HH:MM (24h, club time).' };
  const startsAt = zonedWallTimeToIso(`${date}T${time.padStart(5, '0')}`, ctx.timeZone);
  if (!startsAt) return { error: 'That date/time did not parse.' };
  const ms = new Date(startsAt).getTime();
  if (ms <= Date.now()) return { error: 'That time has already passed.' };
  if (ms > Date.now() + 60 * 864e5) return { error: 'Games can be posted up to 60 days ahead.' };
  const format = String(input?.format ?? 'doubles');
  if (!isFormat(format)) return { error: 'Format must be doubles, singles, mixed or hitting.' };
  const duration = Number(input?.duration_minutes ?? 90);
  if (!Number.isInteger(duration) || duration < 30 || duration > 240) return { error: 'Length must be 30–240 minutes.' };

  // Already playing: club members by name, or outside guests by name.
  const partners: { personId: string | null; guest: string | null; name: string }[] = [];
  for (const term of (input?.partners as string[]) ?? []) {
    const hits = roster.filter((r) => r.person_id !== mine.person_id && (UUID.test(term) ? r.person_id === term : nameMatches(term, r.full_name)));
    if (!hits.length) return { error: `No club member matches "${term}". If they are from outside the club, pass them in guest_partners.` };
    if (hits.length > 1) return { error: `"${term}" matches ${hits.length} members — which?`, candidates: hits.map((h) => ({ id: h.person_id, name: h.full_name })) };
    partners.push({ personId: hits[0].person_id, guest: null, name: hits[0].full_name ?? 'member' });
  }
  for (const gname of (input?.guest_partners as string[]) ?? []) {
    const n = String(gname).trim().slice(0, 60);
    if (n) partners.push({ personId: null, guest: n, name: `${n} (guest)` });
  }

  const spots = input?.players_needed != null ? Number(input.players_needed) : Math.max((DEFAULT_NEEDED[format] ?? 1) - partners.length, 1);
  if (!Number.isInteger(spots) || spots < 1 || spots > MAX_SPOTS) return { error: `Players needed must be 1–${MAX_SPOTS}.` };
  if (spots + partners.length > MAX_SPOTS) return { error: `That is more than ${MAX_SPOTS + 1} players on one court.` };

  let min = input?.rating_min ?? null;
  let max = input?.rating_max ?? null;
  if (input?.at_my_level) {
    if (mine.ntrp == null) return { error: 'You have no level on PlayerVault, so "at my level" has nothing to match. Give a level instead.' };
    min ??= mine.ntrp;
    max ??= mine.ntrp;
  }
  min = min == null ? null : Number(min);
  max = max == null ? null : Number(max);
  if ((min != null && !isLevelValue(club.levels, min)) || (max != null && !isLevelValue(club.levels, max)) || (min != null && max != null && min > max)) {
    return { error: 'That level range is not on the club\'s scale.' };
  }
  const includeUnrated = input?.include_unrated === true || (min == null && max == null);
  const gender = isGender(input?.gender) && format !== 'mixed' ? input.gender : null;
  const court = String(input?.court ?? '').trim().slice(0, 60);
  const note = String(input?.note ?? '').trim().slice(0, 500);

  const { count: recent } = await ctx.db
    .from('pf_games')
    .select('id', { count: 'exact', head: true })
    .eq('club_id', ctx.clubId)
    .eq('posted_by', ctx.userId)
    .gt('created_at', new Date(Date.now() - 864e5).toISOString());
  if ((recent ?? 0) >= DAILY_POST_LIMIT) return { error: `You have posted ${DAILY_POST_LIMIT} games in the last 24 hours — CourtConnect's daily limit.` };

  // Who the invitation reaches: the same filter as pf_game_recipients, read before anything is written.
  const partnerIds = new Set(partners.map((p) => p.personId).filter(Boolean));
  const pool = roster.filter((r) => r.person_id !== mine.person_id && !partnerIds.has(r.person_id));
  const emails = [...new Set(pool.map((r) => normEmail(r.email)).filter(Boolean))];
  const unsub = new Set<string>();
  for (let i = 0; i < emails.length; i += 200) {
    const { data } = await ctx.db.from('email_unsubscribes').select('email').eq('scope', 'all').in('email', emails.slice(i, i + 200));
    for (const u of (data as { email: string }[] | null) ?? []) unsub.add(normEmail(u.email));
  }
  let genders = new Map<string, string | null>();
  if (gender) {
    const { data } = await ctx.db.from('cc_vault_players').select('id, gender').eq('club_id', ctx.clubId);
    genders = new Map(((data as { id: string; gender: string | null }[] | null) ?? []).map((v) => [v.id, v.gender ? v.gender.toLowerCase() : null]));
  }
  const fake = { rating_min: min, rating_max: max, include_unrated: includeUnrated, gender };
  const skipped = { muted: 0, unsubscribed: 0, no_email: 0, other_level_or_gender: 0 };
  const eligible: RosterRow[] = [];
  for (const r of pool) {
    if (!r.email) skipped.no_email++;
    else if (!r.notify_games) skipped.muted++;
    else if (unsub.has(normEmail(r.email))) skipped.unsubscribed++;
    else if (!levelFits(fake, r.ntrp) || !genderFits(fake, genders.get(r.person_id))) skipped.other_level_or_gender++;
    else eligible.push(r);
  }
  const mid = ((min ?? 1) + (max ?? 7)) / 2;
  eligible.sort((a, b) => Number(a.ntrp == null) - Number(b.ntrp == null) || Math.abs((a.ntrp ?? 0) - mid) - Math.abs((b.ntrp ?? 0) - mid) || String(a.full_name).localeCompare(String(b.full_name)));
  const recipients = eligible.slice(0, MAX_RECIPIENTS);
  const key = hash([startsAt, format, duration, spots, min, max, includeUnrated, gender, court, note, partners, recipients.map((r) => r.person_id)]);
  return { club, mePerson: mine, startsAt, format, duration, spots, min, max, includeUnrated, gender, court, note, partners, recipients, skipped, key };
}

type GameCtx = { error: string; candidates?: unknown } | { game: Game; club: Club; roster: RosterRow[]; mine: RosterRow; poster: string };

/** A live game this director posted. Only the poster may seat or cancel — CourtConnect's rule. */
async function posterGame(ctx: Ctx, term: unknown): Promise<GameCtx> {
  const f = await findGame(ctx, term);
  if ('error' in f) return f;
  const g = f.game;
  const [club, roster] = await Promise.all([loadClub(ctx.db, ctx.clubId), clubRoster(ctx.db, ctx.clubId)]);
  if (!club) return { error: 'Club not found.' };
  const poster = roster.find((r) => r.user_id === g.posted_by)?.full_name ?? 'another member';
  const mine = await me(ctx, roster);
  if (!mine) return { error: NOT_ON_VAULT(ctx.clubName) };
  if (g.posted_by !== ctx.userId) {
    return { error: `That game was posted by ${poster}. In CourtConnect only the poster can add players to or cancel their game — ask ${poster}.` };
  }
  if (g.status === 'cancelled') return { error: 'That game is already cancelled.' };
  if (g.status === 'expired' || new Date(g.starts_at).getTime() <= Date.now()) return { error: 'That game has already started.' };
  return { game: g, club, roster, mine, poster };
}

async function planHostAdd(input: any, ctx: Ctx) {
  const pg = await posterGame(ctx, input?.game);
  if ('error' in pg) return pg;
  const guest = String(input?.guest_name ?? '').trim().slice(0, 60);
  const member = String(input?.member ?? '').trim();
  if (!!guest === !!member) return { error: 'Give either guest_name (someone from outside the club) or member (a club member) — one.' };
  let personId: string | null = null;
  let label = `${guest} (guest)`;
  if (member) {
    const hits = pg.roster.filter((r) => (UUID.test(member) ? r.person_id === member : nameMatches(member, r.full_name)));
    if (!hits.length) return { error: `No club member matches "${member}". If they are from outside the club, use guest_name.` };
    if (hits.length > 1) return { error: `"${member}" matches ${hits.length} members — which?`, candidates: hits.map((h) => ({ id: h.person_id, name: h.full_name })) };
    personId = hits[0].person_id;
    label = hits[0].full_name ?? 'member';
  }
  const group = await gameGroup(ctx.db, pg.game, pg.roster);
  const taken = group.length - 1; // the poster is not a seat
  if (taken >= pg.game.spots_needed) return { error: 'That game is already full.' };
  const fills = taken + 1 >= pg.game.spots_needed;
  const told = fills
    ? [...group.filter((m) => m.email).map((m) => m.name), ...(personId ? [label] : [])]
    : [`you (${pg.poster}) — the usual "someone joined" note`];
  return { pg, personId, guest: personId ? null : guest, label, fills, told };
}

// --------------------------------------------------------------- lessons

type Coach = { id: string; display_name: string | null; email: string | null; profile_id: string | null; club_id: string | null; timezone: string | null };
type Slot = {
  id: string;
  coach_id: string;
  start_time: string;
  end_time: string;
  status: string;
  source: string | null;
  location: string | null;
  booked_by_client_id: string | null;
  guest_name: string | null;
  guest_email: string | null;
};

async function clubCoaches(ctx: Ctx): Promise<Coach[]> {
  const { data } = await ctx.db.from('lesson_coaches').select('id, display_name, email, profile_id, club_id, timezone').eq('club_id', ctx.clubId);
  return (data as Coach[] | null) ?? [];
}

async function lessonsSchedule(input: { coach?: string; from?: string; to?: string; include_open?: boolean }, ctx: Ctx): Promise<ToolResult> {
  const coaches = await clubCoaches(ctx);
  if (!coaches.length) return { ok: true, lessons: [], note: `${ctx.clubName} has no LessonMode coaches.` };
  let pick = coaches;
  const term = String(input?.coach ?? '').trim();
  if (term && !/^(all|everyone)$/i.test(term)) {
    pick = /^(me|my|mine|i)$/i.test(term) ? coaches.filter((c) => c.profile_id === ctx.userId) : coaches.filter((c) => nameMatches(term, c.display_name));
    if (!pick.length) {
      return { ok: false, error: /^(me|my|mine|i)$/i.test(term) ? 'You are not set up as a LessonMode coach here.' : `No LessonMode coach here matches "${term}".`, coaches: coaches.map((c) => c.display_name) };
    }
  }
  const today = todayIn(ctx.timeZone);
  const from = YMD.test(String(input?.from)) ? String(input.from) : today;
  const to = YMD.test(String(input?.to)) ? String(input.to) : from;
  if (to < from) return { ok: false, error: '"to" is before "from".' };
  const { data } = await ctx.db
    .from('lesson_slots')
    .select('id, coach_id, start_time, end_time, status, source, location, booked_by_client_id, guest_name, guest_email')
    .in('coach_id', pick.map((c) => c.id))
    .gte('start_time', zonedWallTimeToIso(`${from}T00:00`, ctx.timeZone)!)
    .lt('start_time', zonedWallTimeToIso(`${addDays(to, 1)}T00:00`, ctx.timeZone)!)
    .order('start_time');
  const slots = ((data as Slot[] | null) ?? []).filter((s) => s.status !== 'cancelled' && (input?.include_open || s.status === 'booked'));
  const clientIds = [...new Set(slots.map((s) => s.booked_by_client_id).filter(Boolean))] as string[];
  const { data: cl } = clientIds.length ? await ctx.db.from('lesson_clients').select('id, name').in('id', clientIds) : { data: [] };
  const clients = new Map(((cl as { id: string; name: string }[] | null) ?? []).map((c) => [c.id, c.name]));
  return {
    ok: true,
    range: from === to ? from : `${from} – ${to}`,
    coaches: pick.map((c) => c.display_name),
    lessons: slots.map((s) => ({
      id: s.id,
      coach: coaches.find((c) => c.id === s.coach_id)?.display_name,
      when: `${when(s.start_time, ctx.timeZone)}–${clock(s.end_time, ctx.timeZone)}`,
      status: s.status === 'booked' ? 'booked' : 'open slot',
      client: s.status === 'booked' ? (s.booked_by_client_id && clients.get(s.booked_by_client_id)) || s.guest_name || 'client' : undefined,
      via: s.source === 'open' || s.source === 'google_open' ? 'Open Lesson Time' : undefined,
      location: s.location,
    })),
    note: slots.length ? undefined : `No ${input?.include_open ? '' : 'booked '}lessons in that range.`,
  };
}

type LessonPlan =
  | { error: string }
  | { slot: Slot; coach: Coach; client: { name: string; email: string | null } | null; whenLabel: string };

async function planCancelLesson(input: any, ctx: Ctx): Promise<LessonPlan> {
  const id = String(input?.lesson_id ?? '').trim();
  if (!UUID.test(id)) return { error: 'Pass the lesson id from lessons_schedule.' };
  const { data } = await ctx.db
    .from('lesson_slots')
    .select('id, coach_id, start_time, end_time, status, source, location, booked_by_client_id, guest_name, guest_email')
    .eq('id', id)
    .maybeSingle();
  const slot = data as Slot | null;
  const coach = slot ? (await clubCoaches(ctx)).find((c) => c.id === slot.coach_id) : undefined;
  if (!slot || !coach) return { error: `No lesson with that id at ${ctx.clubName}.` };
  if (!MANAGER_ROLES.has(ctx.role) && coach.profile_id !== ctx.userId) {
    return { error: `Your role here is "${ctx.role}": you can cancel only your own lessons. This one is ${coach.display_name}'s.` };
  }
  if (slot.status === 'cancelled') return { error: 'That lesson is already cancelled.' };
  if (new Date(slot.start_time).getTime() <= Date.now()) return { error: 'That lesson has already started.' };
  if (slot.source === 'open' || slot.source === 'google_open') {
    return {
      error:
        `That lesson was booked through Open Lesson Time and sits on ${coach.display_name}'s own calendar under the client's name. ` +
        'LessonMode has no cancel for those: the coach removes it from their calendar and replies to the client\'s booking confirmation.',
    };
  }
  let client: { name: string; email: string | null } | null = null;
  if (slot.status === 'booked') {
    if (slot.booked_by_client_id) {
      const { data: c } = await ctx.db.from('lesson_clients').select('name, email').eq('id', slot.booked_by_client_id).maybeSingle();
      const cc = c as { name: string; email: string | null } | null;
      client = { name: cc?.name || 'the client', email: cc?.email || null };
    } else client = { name: slot.guest_name || 'the client', email: slot.guest_email || null };
  }
  const tz = coach.timezone || ctx.timeZone;
  return { slot, coach, client, whenLabel: `${when(slot.start_time, tz)}–${clock(slot.end_time, tz)}` };
}

// --------------------------------------------------------------- tools

const S = (name: string, description: string, properties: Record<string, unknown>, required: string[] = []): Anthropic.Messages.Tool => ({
  name,
  description,
  input_schema: { type: 'object', properties, required },
});

const tools: ToolDef<Ctx>[] = [
  {
    schema: S(
      'find_person',
      'Look someone up on PlayerVault: email, phone, member or not, access level (owner/director/coach/front desk/member login or roster only), ' +
        'level/WTN, whether they get CourtConnect game emails, and who shares their inbox. Also finds staff with a login but no PlayerVault row. ' +
        'Several matches come back as a list — ask which.',
      { name: { type: 'string', description: 'Name (any words of it) or PlayerVault id.' } },
      ['name'],
    ),
    run: findPerson,
  },
  {
    schema: S(
      'update_person',
      'Fix a PlayerVault person\'s name, email or phone ("Lawrence Browne is actually Walden Browne"). Same update the PlayerVault edit form makes. ' +
        'Pass only the fields that change.',
      {
        person: { type: 'string', description: 'Current name or PlayerVault id.' },
        full_name: { type: 'string' },
        email: { type: 'string', description: 'Empty string clears it.' },
        phone: { type: 'string', description: 'Empty string clears it.' },
      },
      ['person'],
    ),
    destructive: true,
    preview: async (input, ctx) => {
      const deny = canWrite(ctx);
      if (deny) return deny;
      const p = await planUpdate(input, ctx);
      if ('error' in p) return { ok: false, ...p };
      return { ok: true, person: card(p.person), changes: p.changes, warnings: p.warnings.length ? p.warnings : undefined, sends: 'nothing' };
    },
    run: async (input, ctx) => {
      const deny = canWrite(ctx);
      if (deny) return deny;
      const p = await planUpdate(input, ctx);
      if ('error' in p) return { ok: false, ...p };
      const { error } = await ctx.db
        .from('cc_vault_players')
        .update({ ...p.patch, updated_at: new Date().toISOString() })
        .eq('id', p.person.id)
        .eq('club_id', ctx.clubId);
      if (error) return { ok: false, error: `Not saved: ${error.message}` };
      return { ok: true, updated: p.person.full_name, changes: p.changes, warnings: p.warnings.length ? p.warnings : undefined };
    },
  },
  {
    schema: S(
      'remove_duplicate_person',
      'Remove a duplicate PlayerVault record, keeping the other. There is no merge: a record with ANY history (login, games, attendance, ' +
        'saved settings) is refused. Pass both by id once known; by name, the preview lists each candidate with what it has.',
      {
        keep: { type: 'string', description: 'The record to keep (id, or name).' },
        remove: { type: 'string', description: 'The duplicate to remove (id, or name).' },
      },
      ['keep', 'remove'],
    ),
    destructive: true,
    preview: async (input, ctx) => {
      const deny = canWrite(ctx);
      if (deny) return deny;
      const p = await planDuplicate(input, ctx);
      if ('error' in p) return { ok: false, ...p };
      return {
        ok: true,
        keep: { ...card(p.keep), has: p.keepHas.length ? p.keepHas : ['no history'] },
        remove: { ...card(p.remove), has: ['no history — safe to remove'] },
        sends: 'nothing',
      };
    },
    run: async (input, ctx) => {
      const deny = canWrite(ctx);
      if (deny) return deny;
      const p = await planDuplicate(input, ctx);
      if ('error' in p) return { ok: false, ...p };
      const { error } = await ctx.db.from('cc_vault_players').delete().eq('id', p.remove.id).eq('club_id', ctx.clubId);
      if (error) return { ok: false, error: `Not removed: ${error.message}` };
      return { ok: true, removed: card(p.remove), kept: card(p.keep) };
    },
  },
  {
    schema: S(
      'why_no_emails',
      'Diagnose why someone is not getting club / match / game emails: no email on file, unsubscribed, turned off CourtConnect game emails, ' +
        'inactive, unrated vs level-limited games, not on a team roster, a different email on the team roster, shared inbox. Read-only.',
      { name: { type: 'string', description: 'Name or PlayerVault id.' } },
      ['name'],
    ),
    run: whyNoEmails,
  },
  {
    schema: S(
      'add_members',
      'Add people to PlayerVault (the club\'s member list) — one or a pasted list. Deduped against who is already there: same name ' +
        '(and same/blank email) is skipped; same name with a different email is held as a possible duplicate unless named in add_anyway. ' +
        'A shared household inbox is fine — each name is its own person. Sends nothing.',
      {
        people: {
          type: 'array',
          items: { type: 'object', properties: { name: { type: 'string' }, email: { type: 'string' }, phone: { type: 'string' } }, required: ['name'] },
        },
        add_anyway: { type: 'array', items: { type: 'string' }, description: 'Names the director confirmed are different people from the existing record.' },
      },
      ['people'],
    ),
    destructive: true,
    preview: async (input, ctx) => {
      const deny = canWrite(ctx);
      if (deny) return deny;
      const p = await planAdd(input, ctx);
      if ('error' in p) return { ok: false, ...p };
      if (!p.add.length) return { ok: false, error: 'Nobody new to add.', already: p.already, possible_duplicates: p.possibleDuplicates, invalid: p.invalid };
      return {
        ok: true,
        will_add: p.add.length,
        add: p.add.map((a) => `${a.name}${a.email ? ` — ${a.email}` : ''}${a.note ? ` (${a.note})` : ''}`),
        already_on_playervault: p.already.length ? p.already : undefined,
        possible_duplicates_held_back: p.possibleDuplicates.length ? p.possibleDuplicates : undefined,
        invalid: p.invalid.length ? p.invalid : undefined,
        sends: 'nothing now. Those with an email will start getting CourtConnect "game needs players" emails when a game fits their level (each carries a stop link).',
      };
    },
    run: async (input, ctx) => {
      const deny = canWrite(ctx);
      if (deny) return deny;
      const p = await planAdd(input, ctx);
      if ('error' in p) return { ok: false, ...p };
      if (!p.add.length) return { ok: false, error: 'Nobody new to add.' };
      const club = await loadClub(ctx.db, ctx.clubId);
      const sport = club?.sports?.[0] ?? 'tennis';
      const rows = p.add.map((a) => ({
        director_id: ctx.userId,
        club_id: ctx.clubId,
        full_name: a.name,
        email: a.email,
        phone: a.phone,
        rating_source: 'manual',
        primary_sport: sport,
        membership_status: 'active',
      }));
      const { error } = await ctx.db.from('cc_vault_players').insert(rows);
      if (error) return { ok: false, error: `Not added: ${error.message}` };
      return { ok: true, added: p.add.length, names: p.add.map((a) => a.name), skipped_already_there: p.already.length, held_back_possible_duplicates: p.possibleDuplicates };
    },
  },
  {
    schema: S(
      'list_games',
      'CourtConnect pickup games at the club (default: today through 2 weeks ahead): id, when, format, level, poster, how many are in, status.',
      { days_back: { type: 'number' }, days_ahead: { type: 'number' } },
    ),
    run: listGames,
  },
  {
    schema: S(
      'game_answers',
      'Who said yes / no / is on the waiting list / was emailed and has not answered, for one CourtConnect game. Read-only.',
      { game: { type: 'string', description: 'Game id, or its date YYYY-MM-DD.' } },
      ['game'],
    ),
    run: gameAnswers,
  },
  {
    schema: S(
      'post_game',
      'Post a CourtConnect game as the director ("doubles tomorrow 1pm, 4.0, invite players at my level"). Posting EMAILS every club member ' +
        'whose level fits (max 50) — the preview lists them. at_my_level uses the director\'s own PlayerVault level for min and max.',
      {
        date: { type: 'string', description: 'YYYY-MM-DD (club time).' },
        time: { type: 'string', description: 'HH:MM 24h (club time).' },
        format: { type: 'string', enum: ['doubles', 'singles', 'mixed', 'hitting'] },
        duration_minutes: { type: 'number', description: 'Default 90.' },
        players_needed: { type: 'number', description: 'How many MORE players (default: fills the court).' },
        rating_min: { type: 'number' },
        rating_max: { type: 'number' },
        at_my_level: { type: 'boolean' },
        include_unrated: { type: 'boolean', description: 'Also invite members with no level (default false when a level is set).' },
        gender: { type: 'string', enum: ['male', 'female'] },
        partners: { type: 'array', items: { type: 'string' }, description: 'Club members already playing (names) — seated, not emailed the invite.' },
        guest_partners: { type: 'array', items: { type: 'string' }, description: 'Outside guests already playing (names).' },
        court: { type: 'string' },
        note: { type: 'string' },
        send_key: { type: 'string', description: 'From the preview. Required to post.' },
      },
      ['date', 'time', 'format'],
    ),
    destructive: true,
    preview: async (input, ctx) => {
      const deny = canWrite(ctx);
      if (deny) return deny;
      const p = await planPost(input, ctx);
      if ('error' in p) return { ok: false, ...p };
      return {
        ok: true,
        game: `${gameTitle({ starts_at: p.startsAt, format: p.format, gender: p.gender }, ctx.timeZone)} · ${p.duration} min · needs ${p.spots}`,
        level: ratingLabel(p.min, p.max, p.club.levels) || 'any level',
        include_unrated: p.includeUnrated,
        already_playing: [p.mePerson.full_name + ' (you, poster)', ...p.partners.map((x) => x.name)],
        emails_to: p.recipients.length,
        recipients: p.recipients.map((r) => `${r.full_name}${r.ntrp != null ? ` (${r.ntrp})` : ''}`),
        not_emailed: p.skipped,
        send_key: p.key,
      };
    },
    run: async (input, ctx) => {
      const deny = canWrite(ctx);
      if (deny) return deny;
      const p = await planPost(input, ctx);
      if ('error' in p) return { ok: false, ...p };
      if (input?.send_key !== p.key) {
        return { ok: false, error: 'Something changed since the preview (the game details or who would be emailed). Nothing was posted. Preview again.' };
      }
      const { data, error } = await ctx.db.rpc('pf_post_game', {
        p_club: ctx.clubId,
        p_user: ctx.userId,
        p_starts_at: p.startsAt,
        p_duration: p.duration,
        p_format: p.format,
        p_spots: p.spots + p.partners.length,
        p_rating_min: p.min,
        p_rating_max: p.max,
        p_include_unrated: p.includeUnrated,
        p_court: p.court,
        p_note: p.note,
        p_daily_limit: DAILY_POST_LIMIT,
      });
      const r = data as { ok: boolean; error?: string; game_id?: string } | null;
      if (error || !r?.ok || !r.game_id) return { ok: false, error: `Not posted: ${error?.message ?? r?.error ?? 'unknown error'}` };
      if (p.gender) await ctx.db.from('pf_games').update({ gender: p.gender }).eq('id', r.game_id);
      const seated: string[] = [];
      for (const x of p.partners) {
        const { data: added } = await ctx.db.rpc('pf_host_add', {
          p_game: r.game_id,
          p_actor: p.mePerson.person_id,
          p_person: x.personId,
          p_guest_name: x.personId ? null : x.guest,
        });
        if ((added as { result: string } | null)?.result === 'added') seated.push(x.name);
      }
      const game = await loadGame(ctx.db, r.game_id);
      let emailed = 0;
      try {
        emailed = game ? await inviteMembers(ctx.db, game, p.club) : 0;
      } catch (e) {
        return { ok: true, game_id: r.game_id, posted: true, emailed: 0, warning: `Posted, but the invitations failed: ${(e as Error).message}` };
      }
      return { ok: true, game_id: r.game_id, posted: true, seated, emailed, expected: p.recipients.length };
    },
  },
  {
    schema: S(
      'add_player_to_game',
      'Seat someone in a CourtConnect game the director posted, without an invitation — an outside friend (guest_name) or a club member who ' +
        'said yes in person (member). Only the poster can do this. If it fills the game, the group gets the line-up email.',
      {
        game: { type: 'string', description: 'Game id or date YYYY-MM-DD.' },
        guest_name: { type: 'string' },
        member: { type: 'string', description: 'Club member name or PlayerVault id.' },
      },
      ['game'],
    ),
    destructive: true,
    preview: async (input, ctx) => {
      const deny = canWrite(ctx);
      if (deny) return deny;
      const p = await planHostAdd(input, ctx);
      if ('error' in p) return { ok: false, ...p };
      return {
        ok: true,
        game: gameTitle(p.pg.game, ctx.timeZone),
        add: p.label,
        fills_the_game: p.fills,
        emails: p.fills ? `the full line-up goes to: ${p.told.join(', ')}` : p.told[0],
        guest_note: p.personId ? undefined : 'A guest gets no email and no link — tell them yourself.',
      };
    },
    run: async (input, ctx) => {
      const deny = canWrite(ctx);
      if (deny) return deny;
      const p = await planHostAdd(input, ctx);
      if ('error' in p) return { ok: false, ...p };
      const r = await hostAddPlayer(ctx.db, p.pg.game.id, p.pg.mine.person_id, { personId: p.personId, guestName: p.guest });
      return { ok: r.ok, result: r.result, message: r.message };
    },
  },
  {
    schema: S(
      'cancel_game',
      'Cancel a CourtConnect game the director posted. CourtConnect emails the cancellation ONLY to the people who said yes (are in) — not ' +
        'to those who said no, are waiting, or never answered. Only the poster can cancel.',
      { game: { type: 'string', description: 'Game id or date YYYY-MM-DD.' }, send_key: { type: 'string', description: 'From the preview.' } },
      ['game'],
    ),
    destructive: true,
    preview: async (input, ctx) => {
      const deny = canWrite(ctx);
      if (deny) return deny;
      const pg = await posterGame(ctx, input?.game);
      if ('error' in pg) return { ok: false, ...pg };
      const group = (await gameGroup(ctx.db, pg.game, pg.roster)).filter((m) => !m.isPoster);
      const told = group.filter((m) => m.email);
      return {
        ok: true,
        game: gameTitle(pg.game, ctx.timeZone),
        emails_cancellation_to: told.map((m) => m.name + (m.isGuest ? ' (invited friend)' : '')),
        not_told: group.filter((m) => !m.email).map((m) => `${m.name} (${m.isGuest ? 'guest, no email' : 'no email'}) — tell them yourself`),
        note: told.length ? undefined : 'Nobody has said yes yet, so no email goes out.',
        send_key: hash([pg.game.id, told.map((m) => m.personId)]),
      };
    },
    run: async (input, ctx) => {
      const deny = canWrite(ctx);
      if (deny) return deny;
      const pg = await posterGame(ctx, input?.game);
      if ('error' in pg) return { ok: false, ...pg };
      const told = (await gameGroup(ctx.db, pg.game, pg.roster)).filter((m) => !m.isPoster && m.email);
      if (input?.send_key !== hash([pg.game.id, told.map((m) => m.personId)])) {
        return { ok: false, error: 'Who is in the game changed since the preview. Nothing was cancelled. Preview again.' };
      }
      const r = await cancelGame(ctx.db, pg.game.id, pg.mine.person_id);
      return { ok: r.ok, result: r.result, message: r.ok ? `Cancelled. Emailing ${told.length}: ${told.map((m) => m.name).join(', ') || 'nobody'}.` : r.message };
    },
  },
  {
    schema: S(
      'lessons_schedule',
      'LessonMode lessons for a coach ("me", a name, or all) over a date range (default today). Booked lessons by default; include_open adds ' +
        'unbooked slots. Returns lesson ids for cancel_lesson.',
      {
        coach: { type: 'string', description: '"me", a coach name, or "all".' },
        from: { type: 'string', description: 'YYYY-MM-DD, default today.' },
        to: { type: 'string', description: 'YYYY-MM-DD, default = from.' },
        include_open: { type: 'boolean' },
      },
    ),
    run: lessonsSchedule,
  },
  {
    schema: S(
      'cancel_lesson',
      'Cancel a LessonMode lesson the way the coach dashboard does: the slot is removed and, if a client booked it, they get LessonMode\'s ' +
        'cancellation email. Coaches may cancel their own. Open Lesson Time bookings are refused (they live on the coach\'s calendar).',
      { lesson_id: { type: 'string' } },
      ['lesson_id'],
    ),
    destructive: true,
    preview: async (input, ctx) => {
      const p = await planCancelLesson(input, ctx);
      if ('error' in p) return { ok: false, ...p };
      return {
        ok: true,
        lesson: `${p.coach.display_name} · ${p.whenLabel}${p.slot.location ? ` · ${p.slot.location}` : ''}`,
        booked_by: p.client?.name ?? 'nobody (open slot)',
        emails: p.client?.email ? `${p.client.name} <${p.client.email}> gets LessonMode's cancellation email from ${p.coach.display_name}` : 'nobody',
        note: p.client && !p.client.email ? `${p.client.name} has no email on file — tell them yourself.` : undefined,
      };
    },
    run: async (input, ctx) => {
      const p = await planCancelLesson(input, ctx);
      if ('error' in p) return { ok: false, ...p };
      const { error } = await ctx.db.from('lesson_slots').delete().eq('id', p.slot.id).eq('coach_id', p.coach.id);
      if (error) return { ok: false, error: `Not cancelled: ${error.message}` };
      if (!p.client?.email) return { ok: true, cancelled: p.whenLabel, emailed: 'nobody' };
      const tz = p.coach.timezone || ctx.timeZone;
      try {
        const r = await sendBilledEmail(await resolveCoachUserId(p.coach.id, p.coach.email), {
          ...lessonCancelEmail({
            recipientName: esc(p.client.name),
            cancelledBy: 'coach',
            otherPartyName: esc(p.coach.display_name || 'Your coach'),
            slotDate: mdy(p.slot.start_time, tz),
            slotTime: `${clock(p.slot.start_time, tz)} - ${clock(p.slot.end_time, tz)}`,
            location: p.slot.location ? esc(p.slot.location) : null,
          }),
          to: p.client.email,
          clubId: ctx.clubId,
        });
        return { ok: true, cancelled: p.whenLabel, emailed: r.sent ? p.client.name : `not delivered (${r.reason ?? 'error'})` };
      } catch (e) {
        const why = e instanceof CreditLimitError ? 'the email allowance is used up' : (e as Error).message;
        return { ok: true, cancelled: p.whenLabel, emailed: `not sent — ${why}. Tell ${p.client.name} yourself.` };
      }
    },
  },
];

export const peoplePack: DomainPack<Ctx> = {
  domain: 'people',
  actionsPrompt: `
PEOPLE — PlayerVault members, CourtConnect pickup games, LessonMode lessons.

Reads (any staff): find_person, why_no_emails, list_games, game_answers, lessons_schedule.
Writes (owner/director; a coach may cancel only their own lessons): update_person, remove_duplicate_person, add_members,
post_game, add_player_to_game, cancel_game, cancel_lesson.

Rules:
- A person is a PlayerVault row, never an email. Households share inboxes; never merge or match people by email.
- Several name matches → ask which (show emails/added dates); then use the id.
- Every write previews first. Relay the specifics — who is changed, who gets an email — and wait for a clear yes.
- post_game / cancel_game: pass back the send_key from the preview. Read the recipient list back before posting.
- CourtConnect: only the poster can seat or cancel. A guest gets no email; tell the director to tell them.

You CANNOT, and must say so plainly: link family members (no household link exists), merge records (a duplicate with
history cannot be removed), move a lesson (cancel and rebook), block Open Lesson Time (the coach adds an "Open Lesson
Time" event on their own calendar), cancel an Open Lesson Time booking, charge anyone, or see bounces.`,
  async resolve(userId) {
    return resolveClubCtx(userId);
  },
  tools,
};
