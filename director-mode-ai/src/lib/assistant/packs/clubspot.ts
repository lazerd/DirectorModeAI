import type { DomainPack, ToolDef } from '../framework';
import { resolveClubCtx, type ClubCtx } from '../clubContext';
import { clubspotClubId, runOnBridge } from '@/lib/bridge/jobs';
import { MANAGER_ROLES } from '../clubContext';
import { sendBilledEmails } from '@/lib/email';

/*
 * ClubSpot pack (11/25/26): Sleepy Hollow's courts live in ClubSpot, which has no API. The
 * work runs on the club computer through the bridge (court-booker/clubmode-bridge.js), in the
 * director's own signed-in ClubSpot. Two tools: read a day's court blocks, and block courts
 * (preview first, then the director's yes).
 *
 * Court 11 rule (Darrin 10/27/26): 11A and 11B can't be blocked on their own in ClubSpot,
 * so any 11A/11B request blocks all of Court 11, and the preview says so.
 */

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const HHMM = /^([01]?\d|2[0-3]):([0-5]\d)$/;
const COURTS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11'];

function normCourts(raw: unknown): { courts: string[]; note: string | null } {
  const list = (Array.isArray(raw) ? raw : String(raw ?? '').split(/[,\s]+/)).map((c) => String(c).trim().toUpperCase().replace(/^COURT\s*/, '')).filter(Boolean);
  let note: string | null = null;
  const out = new Set<string>();
  for (const c of list) {
    if (c === '11A' || c === '11B') { out.add('11'); note = 'ClubSpot can only block all of Court 11, so 11A/11B means the whole court.'; }
    else if (COURTS.includes(c)) out.add(c);
  }
  return { courts: [...out].sort((a, b) => Number(a) - Number(b)), note };
}
const label = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return `${((h + 11) % 12) + 1}${m ? ':' + String(m).padStart(2, '0') : ''}${h < 12 ? 'am' : 'pm'}`; };
const dayLabel = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });

function blockPlan(input: any): { ok: false; error: string } | { ok: true; plan: { courts: string[]; date: string; start: string; end: string; reason: string }; note: string | null } {
  const { courts, note } = normCourts(input?.courts);
  if (!courts.length) return { ok: false, error: 'Which courts? (1-11)' };
  const date = String(input?.date ?? '');
  if (!YMD.test(date)) return { ok: false, error: 'Which date? (YYYY-MM-DD)' };
  const start = String(input?.start ?? ''), end = String(input?.end ?? '');
  if (!HHMM.test(start) || !HHMM.test(end) || end <= start) return { ok: false, error: 'Start and end times, like 16:00 to 18:00.' };
  const reason = String(input?.reason ?? '').trim().slice(0, 80);
  if (!reason) return { ok: false, error: 'What is it for? That name shows on the court sheet.' };
  return { ok: true, plan: { courts, date, start, end, reason }, note };
}

const tools: ToolDef<ClubCtx>[] = [
  {
    schema: {
      name: 'clubspot_courts',
      description: "What's on Sleepy Hollow's courts in ClubSpot on one date: every court block (lessons, clinics, matches, events) with its courts and times. Runs on the club computer.",
      input_schema: { type: 'object', properties: { date: { type: 'string', description: 'YYYY-MM-DD' } }, required: ['date'] },
    },
    run: async (input, ctx) => {
      const date = String(input?.date ?? '');
      if (!YMD.test(date)) return { ok: false, error: 'Which date? (YYYY-MM-DD)' };
      const r = await runOnBridge({ kind: 'clubspot_day', input: { date }, clubId: ctx.clubId, userId: ctx.userId }, 45_000);
      if (!r.ok) return r;
      if ('queued' in r) return { ok: true, pending: true, note: r.online ? 'The club computer is working on it; the answer will be texted.' : 'The club computer is offline. It will run when it is back on, and the answer will be texted.' };
      return { ok: true, date, ...r.result };
    },
  },
  {
    schema: {
      name: 'clubspot_block_courts',
      description: "Block courts at Sleepy Hollow in ClubSpot (a court time block with a name, e.g. 'Holiday Social'). Preview first; only run after the director says yes. Runs on the club computer.",
      input_schema: {
        type: 'object',
        properties: {
          courts: { type: 'array', items: { type: 'string' }, description: 'Court numbers, e.g. ["5","6"]. 11A/11B block all of 11.' },
          date: { type: 'string', description: 'YYYY-MM-DD' },
          start: { type: 'string', description: '24h HH:MM, e.g. 16:00' },
          end: { type: 'string', description: '24h HH:MM, e.g. 18:00' },
          reason: { type: 'string', description: 'The name that shows on the court sheet.' },
        },
        required: ['courts', 'date', 'start', 'end', 'reason'],
      },
    },
    destructive: true,
    preview: async (input) => {
      const p = blockPlan(input);
      if (!p.ok) return p;
      const { plan, note } = p;
      return { ok: true, needsConfirm: true, summary: `Block court${plan.courts.length === 1 ? '' : 's'} ${plan.courts.join(', ')} on ${dayLabel(plan.date)}, ${label(plan.start)} to ${label(plan.end)}: "${plan.reason}".`, note };
    },
    run: async (input, ctx) => {
      const p = blockPlan(input);
      if (!p.ok) return p;
      const r = await runOnBridge({ kind: 'clubspot_block', input: p.plan, clubId: ctx.clubId, userId: ctx.userId }, 50_000);
      if (!r.ok) return r;
      if ('queued' in r) return { ok: true, pending: true, note: r.online ? 'The club computer is blocking them now; you will get a text when it is done.' : 'The club computer is offline. The block will go in when it is back on, and you will get a text.' };
      return { ok: true, blocked: true, ...r.result };
    },
  },
];


// ---- Events (11/27/26): the camps, socials and clinics people sign up for in ClubSpot.
interface CsAttendee { name: string; email: string | null }
interface CsEvent { id: string; name: string; date: string; endDate: string; startTime: string; cap: number | null; count: number; attendees: CsAttendee[] }

async function readEvents(ctx: ClubCtx, date: string | null, name: string | null) {
  const r = await runOnBridge({ kind: 'clubspot_events', input: { date, name }, clubId: ctx.clubId, userId: ctx.userId }, 60_000);
  if (!r.ok) return { ok: false as const, error: (r as any).error ?? 'ClubSpot did not answer.' };
  if ('queued' in r) return { ok: false as const, error: r.online ? 'ClubSpot is slow right now; try again in a minute.' : 'The club computer is offline, so ClubSpot cannot be read right now.' };
  return { ok: true as const, events: ((r.result as any)?.events ?? []) as CsEvent[] };
}
const hhmm = (t: string) => (/^\d{4}$/.test(t) ? label(`${t.slice(0, 2)}:${t.slice(2)}`) : '');
const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

async function emailPlan(input: any, ctx: ClubCtx) {
  const date = input?.date && YMD.test(String(input.date)) ? String(input.date) : null;
  const name = input?.event ? String(input.event) : null;
  if (!date && !name) return { ok: false as const, error: 'Which event? Give the date or its name.' };
  const subject = String(input?.subject ?? '').trim().slice(0, 140);
  const message = String(input?.message ?? '').trim().slice(0, 3000);
  if (!subject || !message) return { ok: false as const, error: 'The email needs a subject and a message.' };
  const r = await readEvents(ctx, date, name);
  if (!r.ok) return r;
  if (!r.events.length) return { ok: false as const, error: `No ClubSpot event found${date ? ' on ' + dayLabel(date) : ''}${name ? ' called "' + name + '"' : ''}.` };
  if (r.events.length > 1) return { ok: false as const, error: `More than one event matches: ${r.events.map((e) => `${e.name} (${dayLabel(e.date)})`).join('; ')}. Which one?` };
  const ev = r.events[0];
  const emails = [...new Set(ev.attendees.map((a) => a.email?.trim().toLowerCase()).filter((e): e is string => !!e))];
  const noEmail = ev.attendees.filter((a) => !a.email).map((a) => a.name);
  if (!emails.length) return { ok: false as const, error: `Nobody signed up for ${ev.name} has an email in ClubSpot.` };
  return { ok: true as const, ev, emails, noEmail, subject, message };
}

const eventTools: ToolDef<ClubCtx>[] = [
  {
    schema: {
      name: 'clubspot_events',
      description: "Sleepy Hollow's ClubSpot events (camps, socials, clinics with sign-ups) on a date, or by name: each with its time, cap and everyone signed up (names). Runs on the club computer.",
      input_schema: { type: 'object', properties: { date: { type: 'string', description: 'YYYY-MM-DD' }, event: { type: 'string', description: 'Part of the event name, e.g. "Black Friday camp".' } } },
    },
    run: async (input, ctx) => {
      const date = input?.date && YMD.test(String(input.date)) ? String(input.date) : null;
      const r = await readEvents(ctx, date, input?.event ? String(input.event) : null);
      if (!r.ok) return r;
      return { ok: true, events: r.events.map((e) => ({ name: e.name, date: dayLabel(e.date), starts: hhmm(e.startTime), cap: e.cap, signedUp: e.count, names: e.attendees.map((a) => a.name) })) };
    },
  },
  {
    schema: {
      name: 'clubspot_email_event',
      description: "Email everyone signed up for one ClubSpot event (one email each, from the club, replies go to the director). Write the message in the director's voice: short, plain, first names. Preview first; only send after the director says yes.",
      input_schema: {
        type: 'object',
        properties: {
          date: { type: 'string', description: 'YYYY-MM-DD of the event' },
          event: { type: 'string', description: 'Part of the event name' },
          subject: { type: 'string' },
          message: { type: 'string', description: "The email body, plain text, signed with the director's first name." },
        },
        required: ['subject', 'message'],
      },
    },
    destructive: true,
    preview: async (input, ctx) => {
      const p = await emailPlan(input, ctx);
      if (!p.ok) return p;
      return { ok: true, needsConfirm: true, event: p.ev.name, date: dayLabel(p.ev.date), recipients: p.emails.length, people: p.ev.count, noEmail: p.noEmail, subject: p.subject, message: p.message };
    },
    run: async (input, ctx) => {
      if (!MANAGER_ROLES.has(ctx.role)) return { ok: false, error: 'Only the owner or a director can email an event.' };
      const p = await emailPlan(input, ctx);
      if (!p.ok) return p;
      const { data } = await ctx.db.auth.admin.getUserById(ctx.userId);
      const replyTo = data?.user?.email || undefined;
      const html = `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5">${esc(p.message).replace(/\n/g, '<br>')}</div>`;
      const results = await sendBilledEmails(ctx.userId, p.emails.map((to) => ({ to, subject: p.subject, html, text: p.message, replyTo, fromName: ctx.clubName, clubId: ctx.clubId, clubSlug: ctx.clubSlug })));
      const sent = results.filter((r: any) => r?.sent).length;
      return { ok: sent > 0, sent, of: p.emails.length, event: p.ev.name, error: sent ? undefined : 'The emails did not go out (held or failed).' };
    },
  },
];

export const clubspotPack: DomainPack<ClubCtx> = {
  domain: 'clubspot',
  actionsPrompt: `CLUBSPOT (Sleepy Hollow). The club's courts, court blocks AND event sign-ups (camps, socials) live in ClubSpot. You can read a day's court blocks, block courts, see an event's sign-ups, and email everyone signed up for an event; both run on the club computer, so a reply can take a few seconds or come later by text.
- Times are Pacific. Convert "4 to 6" into 16:00-18:00, "tomorrow" etc. into a date.
- To block courts: call clubspot_block_courts without confirm to get the preview, show it in one line, and ask "Reply YES to block." Only run it after a clear yes.
- "Email the people in this morning's camp" = clubspot_email_event with today's date: write the email yourself from what the director said, preview it (subject, message, how many people), and ask "Reply YES to send."
- If a result says pending, tell the director it's on the way and you'll text when it's done. Never claim it happened.`,
  resolve: async (userId) => {
    const ctx = await resolveClubCtx(userId);
    return ctx && ctx.clubId === clubspotClubId() ? ctx : null;
  },
  tools: [...tools, ...eventTools],
};
