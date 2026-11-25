import type { DomainPack, ToolDef } from '../framework';
import { resolveClubCtx, type ClubCtx } from '../clubContext';
import { clubspotClubId, runOnBridge } from '@/lib/bridge/jobs';

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

export const clubspotPack: DomainPack<ClubCtx> = {
  domain: 'clubspot',
  actionsPrompt: `CLUBSPOT COURTS (Sleepy Hollow). The club's courts and court blocks live in ClubSpot. You can read a day's blocks and block courts; both run on the club computer, so a reply can take a few seconds or come later by text.
- Times are Pacific. Convert "4 to 6" into 16:00-18:00, "tomorrow" etc. into a date.
- To block courts: call clubspot_block_courts without confirm to get the preview, show it in one line, and ask "Reply YES to block." Only run it after a clear yes.
- If a result says pending, tell the director it's on the way and you'll text when it's done. Never claim it happened.`,
  resolve: async (userId) => {
    const ctx = await resolveClubCtx(userId);
    return ctx && ctx.clubId === clubspotClubId() ? ctx : null;
  },
  tools,
};
