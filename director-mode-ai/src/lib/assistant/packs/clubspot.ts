import type { DomainPack, ToolDef } from '../framework';
import { resolveClubCtx, type ClubCtx } from '../clubContext';
import { clubspotClubId, runOnBridge } from '@/lib/bridge/jobs';
import { MANAGER_ROLES } from '../clubContext';
import { sendBilledEmails } from '@/lib/email';
import { readDayEvents } from '@/lib/lessons/dayEvents';

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
      const goesTo = p.emails.length === p.ev.count ? `${p.ev.count} people` : `${p.ev.count} people (${p.emails.length} emails; some families share one)`;
      return { ok: true, needsConfirm: true, event: p.ev.name, date: dayLabel(p.ev.date), goesTo, noEmail: p.noEmail, subject: p.subject, message: p.message, sayExactly: `Goes to ${goesTo}.` };
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


// ---- Billing (11/27/26): who was charged for an event, and charges on household MEMBER TABS.
// Lines go on the tab (monthly statement), the way the club bills; a wrong line is reversed in
// ClubSpot. Every charge is previewed and needs the director's YES.
const LESSON_PRODUCTS: Record<string, string> = { darrin: '60kPSCIIUT', cc: 'aYd5ndCd9Z', alex: 'xXn6KVUtlh', julia: 'Ylq9AY1RQ2', jim: 'vVHi2M3CMB', josh: 'bL52QLwbCo' };
// Team clinic drop-ins bill to the clinic's own ClubSpot product (not a lesson).
const CLINIC_PRODUCTS: Record<string, string> = { ladies_b: '2PXvXePdkQ', ladies_c: 'hvm5Fixqux', mens: 'z8fnpg9tJj' };
const NO_CHARGE_WHY = (st: string) => (/^RULED/.test(st) ? 'make-up, $0 (Darrin ruled)' : /^MAKE-UP/.test(st) ? 'make-up, $0' : /^CHARGED/.test(st) ? 'already charged' : /^WRITTEN/.test(st) ? 'older than a week, written off' : /^REGISTERED/.test(st) ? 'registered' : st.toLowerCase());
const CLINIC_OF_TAB: Record<string, string> = { 'LADIES B Team': 'ladies_b', 'LADIES B Team PM': 'ladies_b', 'LADIES C Team AM': 'ladies_c', 'LADIES C Team PM': 'ladies_c', 'MENS Combo Team': 'mens' };
const NEVER_BILL = /\b(gavin|vivian) cohen\b/i; // the director's own kids (house rule, enforced here too)
const usd = (c: number) => '$' + `${(c / 100).toFixed(c % 100 ? 2 : 0)}`;
const slug = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 24);

async function bridgeRead(ctx: ClubCtx, kind: 'clubspot_event_billing' | 'clubspot_find_member' | 'clinic_attendance', input: Record<string, unknown>) {
  const r = await runOnBridge({ kind, input, clubId: ctx.clubId, userId: ctx.userId }, 75_000);
  if (!r.ok) return { ok: false as const, error: (r as any).error ?? 'ClubSpot did not answer.' };
  if ('queued' in r) return { ok: false as const, error: r.online ? 'ClubSpot is slow right now; try again in a minute.' : 'The club computer is offline, so ClubSpot cannot be read right now.' };
  return { ok: true as const, result: r.result as any };
}

interface BillRow { membershipId: string | null; memberNumber: string; people: string[]; charged: number; owes: number }
async function eventBilling(input: any, ctx: ClubCtx) {
  const date = input?.date && YMD.test(String(input.date)) ? String(input.date) : null;
  const name = input?.event ? String(input.event) : null;
  if (!date && !name) return { ok: false as const, error: 'Which event? Give the date or its name.' };
  const r = await bridgeRead(ctx, 'clubspot_event_billing', { date, name });
  if (!r.ok) return r;
  const b = r.result;
  if (!b.event) return { ok: false as const, error: b.events?.length ? `More than one event matches: ${b.events.map((e: any) => `${e.name} (${dayLabel(e.date)})`).join('; ')}. Which one?` : 'No ClubSpot event found for that.' };
  return { ok: true as const, event: b.event as { id: string; name: string; date: string }, productId: b.productId as string | null, price: b.price as number, rows: b.rows as BillRow[] };
}

function chargePlan(b: { event: { id: string; name: string }; productId: string | null; price: number; rows: BillRow[] }, input: any) {
  const only = (input?.only ?? []).map((s: string) => s.toLowerCase());
  const skip = (input?.skip ?? []).map((s: string) => s.toLowerCase());
  const hit = (row: BillRow, list: string[]) => list.some((n) => row.people.some((p) => p.toLowerCase().includes(n)));
  const owing = b.rows.filter((r) => r.owes > 0 && r.membershipId && (!only.length || hit(r, only)) && !hit(r, skip));
  const blocked = owing.filter((r) => r.people.some((p) => NEVER_BILL.test(p)));
  const lines = owing.filter((r) => !blocked.includes(r)).map((r) => ({
    membershipId: r.membershipId!, productId: b.productId!, amountCents: r.owes,
    description: `${b.event.name} - ${r.people.join(', ')}`, key: `ev-${b.event.id}-${r.membershipId}-${r.owes}`, who: r.people.join(' + '),
  }));
  return { lines, blocked: blocked.map((r) => r.people.join(' + ')), noHousehold: b.rows.filter((r) => r.owes > 0 && !r.membershipId).map((r) => r.people.join(' + ')) };
}

interface ChargeIn { person: string; amount: number; what: string; date?: string; pro?: string; household?: string; product?: string }
async function memberChargePlan(input: any, ctx: ClubCtx) {
  const charges: ChargeIn[] = Array.isArray(input?.charges) ? input.charges.slice(0, 20) : [];
  if (!charges.length) return { ok: false as const, error: 'Who should be charged, for what and how much?' };
  for (const c of charges) {
    if (!c.person || !(Number(c.amount) > 0) || Number(c.amount) > 1000 || !c.what) return { ok: false as const, error: 'Each charge needs a person, an amount ($1-$1000) and what it is for.' };
    if (NEVER_BILL.test(c.person)) return { ok: false as const, error: `${c.person} is never billed (house rule).` };
  }
  const r = await bridgeRead(ctx, 'clubspot_find_member', { names: charges.map((c) => c.person) });
  if (!r.ok) return r;
  const lines: any[] = [], problems: string[] = [];
  charges.forEach((c, i) => {
    const found = r.result.results?.[i]?.households ?? [];
    let hh = found;
    if (c.household) hh = found.filter((h: any) => h.membershipId === c.household || h.memberNumber === String(c.household));
    if (!hh.length) { problems.push(`${c.person}: not found in ClubSpot${c.household ? ' under that household' : ''}. Are they set up in ClubSpot?`); return; }
    if (hh.length > 1) { problems.push(`${c.person}: in more than one household (${hh.map((h: any) => `#${h.memberNumber} ${h.household.slice(0, 3).join('/')}`).join('; ')}). Which one? (say the # )`); return; }
    const h = hh[0];
    if (h.household.some((p: string) => NEVER_BILL.test(p)) && /cohen/i.test(c.person)) { problems.push(`${c.person}: Cohen household, never billed.`); return; }
    const pro = String(c.pro ?? 'darrin').toLowerCase().split(/\s+/)[0];
    const productId = (c.product && CLINIC_PRODUCTS[c.product]) || LESSON_PRODUCTS[pro] || LESSON_PRODUCTS.darrin;
    const date = c.date && YMD.test(c.date) ? c.date : null;
    const md = date ? `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}` : '';
    const description = `${c.what}${md ? ' ' + md : ''} - ${c.person}`.slice(0, 200);
    const cents = Math.round(Number(c.amount) * 100);
    const dup = (h.recent ?? []).find((l: any) => l.amount === cents && md && String(l.description).includes(md) && String(l.description).toLowerCase().includes(c.person.split(/\s+/)[0].toLowerCase()));
    lines.push({ membershipId: h.membershipId, productId, amountCents: cents, description, key: `mt-${h.membershipId}-${date ?? 'nodate'}-${slug(c.person)}-${slug(c.what)}-${cents}`,
      who: c.person, household: `#${h.memberNumber} ${h.household.slice(0, 4).join(', ')}`, pastDue: h.status === 'past_due', alreadyOnTab: dup ? `${dup.description} (${usd(dup.amount)}, ${dup.at})` : null });
  });
  return { ok: true as const, lines, problems };
}

async function postLines(ctx: ClubCtx, lines: any[]) {
  const r = await runOnBridge({ kind: 'clubspot_tab_charge', input: { lines: lines.map(({ membershipId, productId, amountCents, description, key }) => ({ membershipId, productId, amountCents, description, key })) }, clubId: ctx.clubId, userId: ctx.userId }, 90_000);
  if (!r.ok) return { ok: false, error: (r as any).error };
  if ('queued' in r) return { ok: true, pending: true, note: r.online ? 'Posting on the club computer now; I will text when it is done.' : 'The club computer is offline; it will post when it is back on.' };
  const res = ((r.result as any)?.results ?? []) as any[];
  return { ok: res.some((x) => x.ok), posted: res.filter((x) => x.ok).map((x) => `${x.description}: ${usd(x.amountCents)}`), failed: res.filter((x) => !x.ok).map((x) => `${x.description}: ${x.error}`), where: 'ClubSpot member tabs (go out on the monthly statement)' };
}

const billingTools: ToolDef<ClubCtx>[] = [
  {
    schema: {
      name: 'clinic_attendance_billing',
      description: "Team clinic attendance for one date (Ladies B Thu AM, B Wed PM, C Thu AM, C Mon PM = CC's, Men's Combo) from the attendance sheet, each person classified by the club's rules: registered, DROP-IN $35 (half session $17.50), EXTRA $35 (ahead of their own clinic), MAKE-UP $0, already charged, or written off (older than a week). Use for \"attendance is in, bill away\" / \"who needs to be charged from tonight's clinic\". Runs on the club computer.",
      input_schema: { type: 'object', properties: { date: { type: 'string', description: 'YYYY-MM-DD' } }, required: ['date'] },
    },
    run: async (input, ctx) => {
      const date = String(input?.date ?? '');
      if (!YMD.test(date)) return { ok: false, error: 'Which day?' };
      const r = await bridgeRead(ctx, 'clinic_attendance', { date, asOf: process.env.CLINIC_ASOF || undefined });
      if (!r.ok) return r;
      const rows = (r.result.rows ?? []) as { clinic: string; tab: string; name: string; status: string; amount: number; note: string }[];
      if (!rows.length) return { ok: true, date: dayLabel(date), note: 'No clinic attendance marked on the sheet for that day (not run, rained out, or not entered yet).' };
      return { ok: true, date: dayLabel(date),
        toCharge: rows.filter((x) => x.amount > 0).map((x) => ({ person: x.name, amount: x.amount, product: CLINIC_OF_TAB[x.tab], what: `${x.clinic} clinic ${x.status.startsWith('EXTRA') ? 'extra session' : x.amount < 35 ? 'drop-in (half)' : 'drop-in'}`, date, why: x.status })),
        noCharge: rows.filter((x) => !(x.amount > 0)).map((x) => `${x.name} (${x.clinic}): ${NO_CHARGE_WHY(x.status)}`) };
    },
  },
  {
    schema: {
      name: 'my_calendar_day',
      description: "The director's own Google Calendar for one day: every event with time, title and notes. Use it for \"charge my lessons from today\" (titles name the players and often the price or \"don't charge\"), and for what is on my calendar.",
      input_schema: { type: 'object', properties: { date: { type: 'string', description: 'YYYY-MM-DD' } }, required: ['date'] },
    },
    run: async (input, ctx) => {
      const date = String(input?.date ?? '');
      if (!YMD.test(date)) return { ok: false, error: 'Which day?' };
      const r = await readDayEvents(ctx.userId, date);
      return r.ok ? { ok: true, date: dayLabel(date), events: r.events } : r;
    },
  },
  {
    schema: {
      name: 'clubspot_event_billing',
      description: "Who has been charged for a ClubSpot event/camp/social and who still owes (paid at sign-up or on their member tab), per household, with the event price. Runs on the club computer.",
      input_schema: { type: 'object', properties: { date: { type: 'string', description: 'YYYY-MM-DD of the event' }, event: { type: 'string', description: 'Part of the event name' } } },
    },
    run: async (input, ctx) => {
      const b = await eventBilling(input, ctx);
      if (!b.ok) return b;
      return { ok: true, event: b.event.name, date: dayLabel(b.event.date), price: usd(b.price),
        charged: b.rows.filter((r) => r.charged > 0).map((r) => `${r.people.join(' + ')}: ${usd(r.charged)}`),
        owes: b.rows.filter((r) => r.owes > 0).map((r) => `${r.people.join(' + ')}: ${usd(r.owes)}`),
        totalOwed: usd(b.rows.reduce((s, r) => s + r.owes, 0)) };
    },
  },
  {
    schema: {
      name: 'clubspot_charge_event',
      description: "Charge everyone signed up for a ClubSpot event who has not paid yet: puts the event price per person on their household's member tab. Optional only/skip lists of names. Preview first; post only after the director says yes.",
      input_schema: { type: 'object', properties: {
        date: { type: 'string', description: 'YYYY-MM-DD of the event' }, event: { type: 'string', description: 'Part of the event name' },
        only: { type: 'array', items: { type: 'string' }, description: 'Charge only these people' }, skip: { type: 'array', items: { type: 'string' }, description: 'Do not charge these people' } } },
    },
    destructive: true,
    preview: async (input, ctx) => {
      const b = await eventBilling(input, ctx);
      if (!b.ok) return b;
      if (!b.productId || !b.price) return { ok: false, error: `${b.event.name} has no price in ClubSpot, so I don't know what to charge. How much per person?` };
      const p = chargePlan(b, input);
      if (!p.lines.length) return { ok: false, error: `Nobody owes for ${b.event.name}: everyone signed up has been charged.` };
      const paid = b.rows.filter((r) => r.charged > 0).map((r) => r.people.join(' + '));
      const total = usd(p.lines.reduce((s, l) => s + l.amountCents, 0));
      const sayExactly = `${b.event.name}
Paid (${paid.length}): ${paid.join(', ')}
Not charged yet: ${p.lines.map((l) => `${l.who} ${usd(l.amountCents)}`).join(', ')}
Charge ${total} to their member tabs? Reply YES.`;
      return { ok: true, sayExactly, event: b.event.name, willCharge: p.lines.map((l) => `${l.who}: ${usd(l.amountCents)}`), total: usd(p.lines.reduce((s, l) => s + l.amountCents, 0)),
        alreadyCharged: b.rows.filter((r) => r.charged > 0).map((r) => `${r.people.join(' + ')} ${usd(r.charged)}`), neverBilled: p.blocked, notInClubSpot: p.noHousehold, where: 'member tab (monthly statement)' };
    },
    run: async (input, ctx) => {
      if (!MANAGER_ROLES.has(ctx.role)) return { ok: false, error: 'Only the owner or a director can charge.' };
      const b = await eventBilling(input, ctx);
      if (!b.ok) return b;
      if (!b.productId || !b.price) return { ok: false, error: 'That event has no price in ClubSpot.' };
      const p = chargePlan(b, input);
      if (!p.lines.length) return { ok: false, error: 'Nobody owes any more (already charged).' };
      return postLines(ctx, p.lines);
    },
  },
  {
    schema: {
      name: 'clubspot_charge_member',
      description: "Charge people on their household's ClubSpot member tab: lessons (private/semi), drop-ins, stringing, anything with a dollar amount. Finds each person's household, flags the same charge already on the tab, and previews; posts only after the director says yes. Product = the pro's lesson product (default Darrin).",
      input_schema: { type: 'object', properties: { charges: { type: 'array', items: { type: 'object', properties: {
        person: { type: 'string', description: 'Full name of the player' }, amount: { type: 'number', description: 'Dollars' },
        what: { type: 'string', description: 'Short line description, e.g. "Private lesson w/ Darrin", "Semi private lesson"' },
        date: { type: 'string', description: 'YYYY-MM-DD of the lesson/session' }, pro: { type: 'string', description: 'darrin, cc, alex, julia, jim or josh' },
        product: { type: 'string', enum: ['ladies_b', 'ladies_c', 'mens'], description: 'Team clinic drop-ins/extras: the clinic product (from clinic_attendance_billing). Omit for lessons.' },
        household: { type: 'string', description: 'Household # when the person is in more than one' } }, required: ['person', 'amount', 'what'] } } }, required: ['charges'] },
    },
    destructive: true,
    preview: async (input, ctx) => {
      const p = await memberChargePlan(input, ctx);
      if (!p.ok) return p;
      if (!p.lines.length) return { ok: false, error: p.problems.join(' ') };
      return { ok: true, willCharge: p.lines.map((l) => `${l.who} (${l.household}): ${usd(l.amountCents)} "${l.description}"${l.alreadyOnTab ? ` ⚠️ already on tab: ${l.alreadyOnTab}` : ''}${l.pastDue ? ' (account past due)' : ''}`),
        total: usd(p.lines.reduce((s, l) => s + l.amountCents, 0)), needsAnswer: p.problems, where: 'member tab (monthly statement)' };
    },
    run: async (input, ctx) => {
      if (!MANAGER_ROLES.has(ctx.role)) return { ok: false, error: 'Only the owner or a director can charge.' };
      const p = await memberChargePlan(input, ctx);
      if (!p.ok) return p;
      const lines = p.lines.filter((l) => !l.alreadyOnTab);
      if (!lines.length) return { ok: false, error: 'Nothing to post (already on the tab or not found).' };
      const out: any = await postLines(ctx, lines);
      return { ...out, skippedAlreadyOnTab: p.lines.filter((l) => l.alreadyOnTab).map((l) => l.who), notPosted: p.problems };
    },
  },
];

export const clubspotPack: DomainPack<ClubCtx> = {
  domain: 'clubspot',
  actionsPrompt: `CLUBSPOT (Sleepy Hollow). The club's courts, court blocks AND event sign-ups (camps, socials) live in ClubSpot. You can read a day's court blocks, block courts, see an event's sign-ups, email everyone signed up for an event, see who has been charged for an event, and CHARGE people on their household member tab (events, lessons, drop-ins, anything); both run on the club computer, so a reply can take a few seconds or come later by text.
- Times are Pacific. Convert "4 to 6" into 16:00-18:00, "tomorrow" etc. into a date.
- To block courts: call clubspot_block_courts without confirm to get the preview, show it in one line, and ask "Reply YES to block." Only run it after a clear yes.
- "Email the people in this morning's camp" = clubspot_email_event with today's date: write the email yourself from what the director said, preview it (subject, message, how many people), and ask "Reply YES to send."
- BILLING IS YOURS. "Who has been charged for the camp" = clubspot_event_billing. "Charge anyone who hasn't been charged" = clubspot_charge_event (preview the who/how much list, then "Reply YES to charge."). "Charge Max $90 for today's lesson" = clubspot_charge_member. Never say you cannot see or post ClubSpot charges: you can. When a billing preview has sayExactly, send that text as your reply (you may drop the Paid line only if the director did not ask who paid). Text format: short lines, one person per line. Charges go on the member tab and go out on the monthly statement; a mistake is reversed in ClubSpot.
- "Attendance is in for tonight's clinic, bill away" / "charge whoever needs to be charged from the B clinic" = clinic_attendance_billing for that date, then ONE clubspot_charge_member preview of its toCharge list exactly as given (person, amount, what, date, product). Never add registered people, make-ups, already-charged or written-off ones; list those in one short line after the preview. If toCharge is empty, say nobody owes and why. Anything older than a week is written off: never bill it.
- "Charge my lessons from today" (or a date) = my_calendar_day, then ONE clubspot_charge_member preview with every lesson to charge. Use the house-rule rates; a $ amount in the title wins; "each" means per player; semi = each player pays the semi rate. Skip events that say don't charge / paid / Venmo / Zelle, personal or admin events, clinics that bill elsewhere, and anyone the house rules say never to charge. Mark any amount you guessed with (guess). After the preview list what you skipped and why in one line.
- If a result says pending, tell the director it's on the way and you'll text when it's done. Never claim it happened.`,
  resolve: async (userId) => {
    const ctx = await resolveClubCtx(userId);
    return ctx && ctx.clubId === clubspotClubId() ? ctx : null;
  },
  tools: [...tools, ...eventTools, ...billingTools],
};
