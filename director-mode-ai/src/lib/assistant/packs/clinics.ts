import type { DomainPack, ToolDef } from '../framework';
import { resolveClubCtx, MANAGER_ROLES, type ClubCtx } from '../clubContext';
import { programSessions } from '@/lib/programs/sessions';
import {
  CLINIC_PROGRAM_COLS, alreadySent, clinicPageLink, clinicWhen, regularsFor, rsvp, sendClinic, signupsFor, spotsLeft, spotsPerMeeting,
  type ClinicClub, type ClinicProgram,
} from '@/lib/programs/clinicSignups';

/*
 * Clinics pack: per-date signups and the reminders that fill clinics (the TopDog feature).
 * "Remind everyone for Friday's Drills & Thrills", "2 spots left Tuesday, tell the
 * regulars", "turn on automatic reminders for the ladies clinic", "who's in Friday?".
 * Sends are destructive tools: preview first (who and how many), send on confirm.
 */

const UUID = /^[0-9a-f-]{36}$/i;
const YMD = /^\d{4}-\d{2}-\d{2}$/;

async function findClinic(ctx: ClubCtx, ref: unknown): Promise<{ program: ClinicProgram } | { error: string; candidates?: unknown }> {
  const key = String(ref ?? '').trim();
  if (!key) return { error: 'Which clinic? Give its name.' };
  const base = ctx.db.from('club_programs').select(CLINIC_PROGRAM_COLS).eq('club_id', ctx.clubId);
  if (UUID.test(key)) {
    const { data } = await base.eq('id', key).maybeSingle();
    if (data) return { program: data as unknown as ClinicProgram };
  }
  const { data } = await ctx.db.from('club_programs').select(CLINIC_PROGRAM_COLS).eq('club_id', ctx.clubId).neq('status', 'archived');
  const rows = (data as unknown as ClinicProgram[] | null) ?? [];
  const k = key.toLowerCase();
  const hits = rows.filter((r) => r.title.toLowerCase() === k).length ? rows.filter((r) => r.title.toLowerCase() === k) : rows.filter((r) => r.title.toLowerCase().includes(k));
  if (hits.length === 1) return { program: hits[0] };
  if (!hits.length) return { error: `No clinic at ${ctx.clubName} matches "${key}".` };
  return { error: `"${key}" matches ${hits.length} clinics. Ask which one.`, candidates: hits.map((h) => ({ id: h.id, title: h.title })) };
}

const todayIn = (tz: string) => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());

/** The date asked for, or the clinic's next meeting from today. */
function pickDate(ctx: ClubCtx, program: ClinicProgram, date: unknown): { date: string } | { error: string } {
  const dates = programSessions(program, ctx.timeZone).dates;
  if (date && YMD.test(String(date))) {
    return dates.includes(String(date)) ? { date: String(date) } : { error: `${program.title} doesn't meet on ${date}. Next dates: ${dates.filter((d) => d >= todayIn(ctx.timeZone)).slice(0, 4).join(', ') || 'none'}.` };
  }
  const next = dates.find((d) => d >= todayIn(ctx.timeZone));
  return next ? { date: next } : { error: `${program.title} has no upcoming dates.` };
}

const club = (ctx: ClubCtx): ClinicClub => ({ id: ctx.clubId, name: ctx.clubName, slug: ctx.clubSlug, timeZone: ctx.timeZone });

async function sender(ctx: ClubCtx) {
  const { data } = await ctx.db.auth.admin.getUserById(ctx.userId);
  const u = data?.user;
  const name = (u?.user_metadata as any)?.full_name || (u?.user_metadata as any)?.name || ctx.clubName;
  return { replyTo: u?.email || '', senderName: String(name) };
}

const canWrite = (ctx: ClubCtx) => MANAGER_ROLES.has(ctx.role);

function sendTool(kind: 'reminder' | 'spots_left'): ToolDef<ClubCtx> {
  const label = kind === 'reminder' ? 'reminder to everyone signed up' : '"spots left" note to the clinic\'s regulars who haven\'t signed up';
  const run = async (input: any, ctx: ClubCtx, mode: 'preview' | 'live') => {
    if (!canWrite(ctx)) return { ok: false, error: 'Only the owner or director can send clinic emails.' };
    const f = await findClinic(ctx, input?.clinic);
    if ('error' in f) return { ok: false, ...f };
    const d = pickDate(ctx, f.program, input?.date);
    if ('error' in d) return { ok: false, error: d.error };
    const s = await sender(ctx);
    if (!s.replyTo) return { ok: false, error: 'Your account has no email to reply to.' };
    const res = await sendClinic(ctx.db, { program: f.program, club: club(ctx), date: d.date, kind, mode, ownerId: ctx.userId, ...s, sentBy: ctx.userId });
    const when = clinicWhen(f.program, d.date, ctx.timeZone);
    const earlier = await alreadySent(ctx.db, f.program.id, d.date, kind);
    if (res.mode === 'preview') {
      if (!res.count) return { ok: false, error: kind === 'reminder' ? `Nobody is signed up for ${f.program.title} on ${when.day} yet.` : `No regulars left to tell for ${when.day}: everyone has answered, or nobody has come before.` };
      if (kind === 'spots_left' && res.spotsLeft === 0) return { ok: false, error: `${f.program.title} on ${when.day} is already full.` };
      return { ok: true, clinic: f.program.title, date: when.day, time: when.time, recipients: res.count, emails: (res.recipients as string[]).slice(0, 25), subject: res.subject, spotsLeft: res.spotsLeft, signedUp: res.signedUp, alreadySentOnce: earlier };
    }
    if (res.mode === 'live') return { ok: true, sent: res.sent, attempted: res.attempted, failures: res.failures.length, creditLimited: !!res.creditLimited, clinic: f.program.title, date: when.day };
    return { ok: false, error: 'unexpected' };
  };
  return {
    schema: {
      name: kind === 'reminder' ? 'send_clinic_reminder' : 'send_clinic_spots_left',
      description: `Email a ${label} for one clinic date (one personal email each, with a one-tap link). Date defaults to the clinic's next meeting.`,
      input_schema: {
        type: 'object',
        properties: { clinic: { type: 'string', description: 'Clinic name or id.' }, date: { type: 'string', description: 'YYYY-MM-DD; omit for the next meeting.' } },
        required: ['clinic'],
      },
    },
    destructive: true,
    preview: (input, ctx) => run(input, ctx, 'preview'),
    run: (input, ctx) => run(input, ctx, 'live'),
  };
}

const tools: ToolDef<ClubCtx>[] = [
  {
    schema: {
      name: 'clinic_signups',
      description: "Who is in (and who said can't make it) for a clinic date, spots left, how many regulars haven't answered, the public signup link, and whether a reminder or spots-left email already went out.",
      input_schema: { type: 'object', properties: { clinic: { type: 'string' }, date: { type: 'string', description: 'YYYY-MM-DD; omit for next meeting.' } }, required: ['clinic'] },
    },
    run: async (input, ctx) => {
      const f = await findClinic(ctx, input?.clinic);
      if ('error' in f) return { ok: false, ...f };
      const d = pickDate(ctx, f.program, input?.date);
      if ('error' in d) return { ok: false, error: d.error };
      const signups = await signupsFor(ctx.db, f.program.id, d.date);
      const when = clinicWhen(f.program, d.date, ctx.timeZone);
      return {
        ok: true, clinic: f.program.title, date: d.date, day: when.day, time: when.time,
        spots: spotsPerMeeting(f.program), spotsLeft: spotsLeft(f.program, signups),
        in: signups.filter((s) => s.status === 'in').map((s) => s.name),
        out: signups.filter((s) => s.status === 'out').map((s) => s.name),
        regularsNotAnswered: (await regularsFor(ctx.db, f.program, d.date)).length,
        reminderSent: await alreadySent(ctx.db, f.program.id, d.date, 'reminder'),
        spotsLeftSent: await alreadySent(ctx.db, f.program.id, d.date, 'spots_left'),
        autoReminders: f.program.auto_reminders,
        signupLink: clinicPageLink(f.program.id, d.date),
      };
    },
  },
  sendTool('reminder'),
  sendTool('spots_left'),
  {
    schema: {
      name: 'set_clinic_auto_reminders',
      description: 'Turn automatic clinic emails on or off for a clinic, and optionally set spots per date. When on, every day before a clinic at about 8am: a reminder to everyone signed up, and if spots are still open, a spots-left note to the regulars who haven\'t answered. Each is sent at most once per date.',
      input_schema: {
        type: 'object',
        properties: { clinic: { type: 'string' }, on: { type: 'boolean' }, spots_per_date: { type: 'integer', minimum: 1, maximum: 200 } },
        required: ['clinic', 'on'],
      },
    },
    destructive: true,
    preview: async (input, ctx) => {
      if (!canWrite(ctx)) return { ok: false, error: 'Only the owner or director can change this.' };
      const f = await findClinic(ctx, input?.clinic);
      if ('error' in f) return { ok: false, ...f };
      return { ok: true, clinic: f.program.title, autoNow: f.program.auto_reminders, autoAfter: !!input?.on, spotsPerDate: input?.spots_per_date ?? spotsPerMeeting(f.program) };
    },
    run: async (input, ctx) => {
      if (!canWrite(ctx)) return { ok: false, error: 'Only the owner or director can change this.' };
      const f = await findClinic(ctx, input?.clinic);
      if ('error' in f) return { ok: false, ...f };
      const patch: Record<string, unknown> = { auto_reminders: !!input?.on };
      if (Number.isInteger(input?.spots_per_date)) patch.meeting_capacity = input.spots_per_date;
      const { error } = await ctx.db.from('club_programs').update(patch).eq('id', f.program.id).eq('club_id', ctx.clubId);
      return error ? { ok: false, error: error.message } : { ok: true, clinic: f.program.title, autoReminders: !!input?.on };
    },
  },
  {
    schema: {
      name: 'add_clinic_signup',
      description: 'Sign someone up for (or take them off) a clinic date for them, e.g. "put Maria in for Friday". Respects the spot limit.',
      input_schema: {
        type: 'object',
        properties: { clinic: { type: 'string' }, date: { type: 'string' }, name: { type: 'string' }, email: { type: 'string' }, status: { type: 'string', enum: ['in', 'out'] } },
        required: ['clinic', 'name', 'email'],
      },
    },
    destructive: true,
    preview: async (input, ctx) => {
      const f = await findClinic(ctx, input?.clinic);
      if ('error' in f) return { ok: false, ...f };
      const d = pickDate(ctx, f.program, input?.date);
      if ('error' in d) return { ok: false, error: d.error };
      const left = spotsLeft(f.program, await signupsFor(ctx.db, f.program.id, d.date));
      return { ok: true, clinic: f.program.title, date: d.date, name: input?.name, email: input?.email, status: input?.status === 'out' ? 'out' : 'in', spotsLeftNow: left };
    },
    run: async (input, ctx) => {
      if (!canWrite(ctx)) return { ok: false, error: 'Only the owner or director can do this.' };
      const f = await findClinic(ctx, input?.clinic);
      if ('error' in f) return { ok: false, ...f };
      const d = pickDate(ctx, f.program, input?.date);
      if ('error' in d) return { ok: false, error: d.error };
      const r = await rsvp(ctx.db, { program: f.program, date: d.date, name: String(input?.name ?? ''), email: String(input?.email ?? ''), status: input?.status === 'out' ? 'out' : 'in', source: 'staff' });
      return r.ok ? { ...r } : { ok: false, error: r.reason === 'full' ? 'That date is full.' : 'Need a name and a valid email.' };
    },
  },
];

export const clinicsPack: DomainPack<ClubCtx> = {
  domain: 'clinics',
  actionsPrompt: `CLINICS (per-date signups and reminders). Members say "I'm in" for one clinic date. You can show who's in, send a reminder to everyone signed up, send a "spots left" note to the clinic's regulars who haven't answered, sign someone up, and turn on automatic reminders (the day before, about 8am). Each email is personal, one per person, with a one-tap link. Always preview a send and tell the director exactly who and how many before sending. If a send already went out for that date, say so before sending another.`,
  resolve: async (userId) => resolveClubCtx(userId),
  tools,
};
