import { createHmac, timingSafeEqual } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { APP_URL } from '@/lib/appUrl';
import { runCampaign, type CampaignData, type CampaignResult, type Person, type SendMode } from '@/lib/campaigns/core';
import { formatSessionDate, formatTimeRange, programSessions } from './sessions';

/*
 * Clinic signups + reminders: the TopDog feature (Belvedere TC, 11/25/26).
 *
 * Members say "I'm in" for ONE clinic date. With one tap the director (or the AI
 * staff) can:
 *   - REMIND everyone signed up for that date ("See you Friday, 9am"), and
 *   - send SPOTS LEFT to the clinic's regulars who haven't signed up yet
 *     ("2 spots left for Friday's Drills & Thrills"), each with a one-tap "Count me in".
 * Directors found these reminders lift participation for everything.
 *
 * RULES
 * - One email per person, written to them, never a CC'd blast.
 * - Regulars who already said "can't make it" for that date are never nudged.
 * - The links in emails only OPEN a confirm page; nothing is signed up by a GET, so
 *   mail scanners that prefetch links can't sign anyone up.
 * - Sends go through the campaigns engine: preview / test / live, billed on the
 *   club's meter like every other email.
 */

type DB = SupabaseClient;

export interface ClinicProgram {
  id: string; club_id: string; title: string; slug: string; status: string;
  range_start: string; range_end: string; days_of_week: number[] | null; exclusions: string[] | null;
  time_start: string; time_end: string; capacity: number | null; meeting_capacity: number | null;
  coach_name: string | null; auto_reminders: boolean;
}
export interface ClinicClub { id: string; name: string; slug: string; timeZone: string }
export interface Signup { id: string; name: string; email: string; status: 'in' | 'out'; created_at: string }

const PROGRAM_COLS =
  'id, club_id, title, slug, status, range_start, range_end, days_of_week, exclusions, time_start, time_end, capacity, meeting_capacity, coach_name, auto_reminders';

export const personKey = (email: string) => email.trim().toLowerCase();
const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
const esc = (s: string) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const firstName = (full: string) => (full || '').trim().split(/\s+/)[0] || 'there';

// ---------------------------------------------------------------- one-tap links

function secret(): string {
  return 'clinic:' + (process.env.UNSUBSCRIBE_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || 'dev-clinic-secret');
}
export interface ClinicToken { p: string; d: string; e: string; n: string }
export function signClinicToken(t: ClinicToken): string {
  const body = Buffer.from(JSON.stringify(t)).toString('base64url');
  const sig = createHmac('sha256', secret()).update(body).digest('base64url').slice(0, 32);
  return `${body}.${sig}`;
}
export function verifyClinicToken(token: string): ClinicToken | null {
  const [body, sig] = String(token || '').split('.');
  if (!body || !sig) return null;
  const want = createHmac('sha256', secret()).update(body).digest('base64url').slice(0, 32);
  if (want.length !== sig.length || !timingSafeEqual(Buffer.from(want), Buffer.from(sig))) return null;
  try {
    const t = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (typeof t?.p === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(t?.d) && isEmail(String(t?.e))) return t as ClinicToken;
  } catch {}
  return null;
}
export const clinicLink = (t: ClinicToken) => `${APP_URL}/clinic?t=${encodeURIComponent(signClinicToken(t))}`;
export const clinicPageLink = (programId: string, date: string) => `${APP_URL}/clinic?p=${programId}&d=${date}`;

// ---------------------------------------------------------------- reads

export async function loadClinic(db: DB, programId: string): Promise<{ program: ClinicProgram; club: ClinicClub } | null> {
  const { data: p } = await db.from('club_programs').select(PROGRAM_COLS).eq('id', programId).maybeSingle();
  if (!p) return null;
  const { data: c } = await db.from('cc_clubs').select('id, name, slug, timezone').eq('id', (p as any).club_id).maybeSingle();
  if (!c) return null;
  return {
    program: p as ClinicProgram,
    club: { id: (c as any).id, name: (c as any).name, slug: (c as any).slug, timeZone: (c as any).timezone || 'America/Los_Angeles' },
  };
}

/** Does the clinic actually meet on this date? */
export function meetsOn(program: ClinicProgram, date: string, timeZone: string): boolean {
  return programSessions(program, timeZone).dates.includes(date);
}

/** Spots per clinic date: meeting_capacity, else the class capacity, else unlimited (null). */
export const spotsPerMeeting = (program: ClinicProgram): number | null => program.meeting_capacity ?? program.capacity ?? null;

export async function signupsFor(db: DB, programId: string, date: string): Promise<Signup[]> {
  const { data } = await db
    .from('club_program_meeting_signups')
    .select('id, name, email, status, created_at')
    .eq('program_id', programId)
    .eq('meeting_date', date)
    .order('created_at');
  return (data as Signup[] | null) ?? [];
}

export function spotsLeft(program: ClinicProgram, signups: Signup[]): number | null {
  const cap = spotsPerMeeting(program);
  if (cap == null) return null;
  return Math.max(0, cap - signups.filter((s) => s.status === 'in').length);
}

/**
 * The clinic's regulars for a date: people who came to or signed up for THIS clinic in
 * the last 10 weeks, plus its season registrants, minus anyone who already answered
 * for this date (in or out). One entry per email.
 */
export async function regularsFor(db: DB, program: ClinicProgram, date: string): Promise<Person[]> {
  const since = new Date(Date.parse(`${date}T12:00:00Z`) - 70 * 86_400_000).toISOString().slice(0, 10);
  const people = new Map<string, Person>();
  const add = (email: string | null | undefined, name: string | null | undefined) => {
    if (!email || !isEmail(email)) return;
    const k = personKey(email);
    if (!people.has(k)) people.set(k, { email: email.trim(), firstName: firstName(name || '') });
  };

  const [past, regs, att] = await Promise.all([
    db.from('club_program_meeting_signups').select('name, email').eq('program_id', program.id).eq('status', 'in').gte('meeting_date', since).neq('meeting_date', date),
    db.from('club_program_registrations').select('participant_name, parent_name, parent_email').eq('program_id', program.id).neq('status', 'cancelled'),
    db.from('club_program_attendance').select('name, registration_id, vault_player_id').eq('program_id', program.id).gte('meeting_date', since),
  ]);
  for (const r of (past.data as any[] | null) ?? []) add(r.email, r.name);
  for (const r of (regs.data as any[] | null) ?? []) add(r.parent_email, r.parent_name || r.participant_name);

  const attRows = (att.data as any[] | null) ?? [];
  const regIds = [...new Set(attRows.map((r) => r.registration_id).filter(Boolean))];
  const vaultIds = [...new Set(attRows.map((r) => r.vault_player_id).filter(Boolean))];
  if (regIds.length) {
    const { data } = await db.from('club_program_registrations').select('parent_email, parent_name, participant_name').in('id', regIds);
    for (const r of (data as any[] | null) ?? []) add(r.parent_email, r.parent_name || r.participant_name);
  }
  if (vaultIds.length) {
    const { data } = await db.from('cc_vault_players').select('email, full_name').in('id', vaultIds);
    for (const r of (data as any[] | null) ?? []) add(r.email, r.full_name);
  }

  const answered = new Set((await signupsFor(db, program.id, date)).map((s) => personKey(s.email)));
  return [...people.entries()].filter(([k]) => !answered.has(k)).map(([, p]) => p);
}

// ---------------------------------------------------------------- writes

export async function rsvp(
  db: DB,
  args: { program: ClinicProgram; date: string; name: string; email: string; status: 'in' | 'out'; source: 'web' | 'email' | 'staff' },
): Promise<{ ok: true; status: 'in' | 'out'; spotsLeft: number | null } | { ok: false; reason: 'full' | 'bad_input' | 'not_a_meeting' }> {
  const name = args.name.trim().slice(0, 120);
  const email = args.email.trim().slice(0, 254);
  if (!name || !isEmail(email)) return { ok: false, reason: 'bad_input' };
  const existing = await signupsFor(db, args.program.id, args.date);
  const mine = existing.find((s) => personKey(s.email) === personKey(email));
  if (args.status === 'in' && mine?.status !== 'in') {
    const left = spotsLeft(args.program, existing);
    if (left !== null && left <= 0) return { ok: false, reason: 'full' };
  }
  const { error } = await db.from('club_program_meeting_signups').upsert(
    {
      club_id: args.program.club_id, program_id: args.program.id, meeting_date: args.date,
      name, email, person_key: personKey(email), status: args.status, source: args.source, updated_at: new Date().toISOString(),
    },
    { onConflict: 'program_id,meeting_date,person_key' },
  );
  if (error) throw new Error(error.message);
  return { ok: true, status: args.status, spotsLeft: spotsLeft(args.program, await signupsFor(db, args.program.id, args.date)) };
}

// ---------------------------------------------------------------- emails

const ACCENT = '#1F4D3A';
const shell = (clubName: string, inner: string) =>
  `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#1f2937;line-height:1.55;max-width:600px;margin:0 auto">
  <div style="background:${ACCENT};border-radius:14px 14px 0 0;padding:18px 24px;color:#fff"><div style="font-size:11px;letter-spacing:.16em;text-transform:uppercase;font-weight:700;opacity:.9">${esc(clubName)}</div></div>
  <div style="border:1px solid #e5e7eb;border-top:none;border-radius:0 0 14px 14px;padding:22px 24px">${inner}</div></div>`;
const button = (href: string, label: string) =>
  `<p style="margin:18px 0"><a href="${esc(href)}" style="display:inline-block;background:#D7F25A;color:#17301F;font-weight:800;text-decoration:none;padding:13px 24px;border-radius:999px;font-size:16px">${esc(label)}</a></p>`;

/** "09:00" -> "9am", "18:30" -> "6:30pm" */
export function startLabel(hhmm: string): string {
  const [h, m] = String(hhmm || '').split(':').map((x) => parseInt(x, 10));
  if (!Number.isFinite(h)) return '';
  const h12 = ((h + 11) % 12) + 1;
  return `${h12}${m ? `:${String(m).padStart(2, '0')}` : ''}${h < 12 ? 'am' : 'pm'}`;
}

export function clinicWhen(program: ClinicProgram, date: string, timeZone: string) {
  return {
    day: formatSessionDate(date, timeZone, { weekday: true }),
    time: formatTimeRange(program.time_start, program.time_end),
  };
}

type Kind = 'reminder' | 'spots_left';

/** The campaign for one clinic date. `everyone` is who'd get it; each has their own link. */
export async function clinicCampaign(
  db: DB,
  opts: { program: ClinicProgram; club: ClinicClub; date: string; kind: Kind; ownerId: string; replyTo: string; senderName: string },
): Promise<{ data: CampaignData; spotsLeft: number | null; signedUp: number }> {
  const { program, club, date, kind } = opts;
  const signups = await signupsFor(db, program.id, date);
  const ins = signups.filter((s) => s.status === 'in');
  const left = spotsLeft(program, signups);
  const when = clinicWhen(program, date, club.timeZone);
  const coach = program.coach_name ? ` with ${program.coach_name}` : '';

  const everyone: Person[] =
    kind === 'reminder'
      ? ins.map((s) => ({ email: s.email, firstName: firstName(s.name), ctaUrl: clinicLink({ p: program.id, d: date, e: s.email, n: s.name }) }))
      : (await regularsFor(db, program, date)).map((p) => ({ ...p, ctaUrl: clinicLink({ p: program.id, d: date, e: p.email, n: p.firstName }) }));

  const spotsLine = left == null ? 'Spots are open' : left === 1 ? '1 spot left' : `${left} spots left`;
  const render = (_d: CampaignData, person: Person) => {
    if (kind === 'reminder') {
      return {
        subject: `See you ${when.day.split(',')[0]}: ${program.title} at ${startLabel(program.time_start)}`,
        html: shell(club.name, `<p>Hi ${esc(person.firstName)},</p>
          <p>Just a reminder that you're in for <strong>${esc(program.title)}</strong>${esc(coach)}.</p>
          <p style="font-size:17px;margin:12px 0"><strong>${esc(when.day)}</strong><br>${esc(when.time)}</p>
          <p>Can't make it anymore? Tap below so someone else can have your spot.</p>
          ${button(person.ctaUrl || '', "Change my answer")}
          <p style="margin:2px 0 0">See you on the court,<br>${esc(opts.senderName)}</p>`),
      };
    }
    return {
      subject: `${spotsLine} for ${program.title} ${when.day.split(',')[0]}`,
      html: shell(club.name, `<p>Hi ${esc(person.firstName)},</p>
        <p><strong>${esc(spotsLine)}</strong> for ${esc(program.title)}${esc(coach)} on <strong>${esc(when.day)}</strong>, ${esc(when.time)}. Want one?</p>
        ${button(person.ctaUrl || '', 'Count me in')}
        <p style="color:#6b7280;font-size:13px">One tap holds your spot. Can't make this one? No need to reply.</p>
        <p style="margin:2px 0 0">${esc(opts.senderName)}</p>`),
    };
  };

  const data: CampaignData = {
    ownerId: opts.ownerId,
    clubName: club.name,
    senderName: opts.senderName,
    replyTo: opts.replyTo,
    title: program.title,
    liveUrl: '',
    liveUrlLabel: '',
    deadlineNote: null,
    stats: [],
    everyone,
    nudge: [],
    copy: { updateSubject: '', updateIntro: '', nudgeSubject: '', nudgeLead: () => '' },
    renderUpdate: render,
  };
  return { data, spotsLeft: left, signedUp: ins.length };
}

/** Preview, test or send one clinic email; a live send is logged so it never repeats by itself. */
export async function sendClinic(
  db: DB,
  opts: { program: ClinicProgram; club: ClinicClub; date: string; kind: Kind; mode: SendMode; ownerId: string; replyTo: string; senderName: string; sentBy?: string | null; auto?: boolean },
): Promise<CampaignResult & { spotsLeft: number | null; signedUp: number }> {
  const { data, spotsLeft: left, signedUp } = await clinicCampaign(db, opts);
  const res = await runCampaign(data, 'update', opts.mode);
  if (res.mode === 'live' && res.sent > 0) {
    await db.from('club_program_meeting_sends').insert({
      club_id: opts.club.id, program_id: opts.program.id, meeting_date: opts.date, kind: opts.kind,
      sent_count: res.sent, spots_left: left, auto: !!opts.auto, sent_by: opts.sentBy ?? null,
    });
  }
  return { ...res, spotsLeft: left, signedUp };
}

export async function alreadySent(db: DB, programId: string, date: string, kind: Kind): Promise<boolean> {
  const { count } = await db
    .from('club_program_meeting_sends')
    .select('id', { count: 'exact', head: true })
    .eq('program_id', programId)
    .eq('meeting_date', date)
    .eq('kind', kind);
  return (count ?? 0) > 0;
}

export { PROGRAM_COLS as CLINIC_PROGRAM_COLS };
