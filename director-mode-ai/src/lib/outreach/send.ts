/**
 * Sending an approved card.
 *
 * ── THE ONLY GATE THAT MATTERS ──────────────────────────────────────────
 * `status = 'approved'`. It is in the WHERE clause of the only query that
 * feeds this module, it is re-checked on the row before Resend is called, and
 * there is no exported function that takes a body and an address. A planned
 * row, a snoozed row and a rejected row are all equally unsendable, and the
 * way a row becomes approved is that a human swiped right on the actual text.
 *
 * ── A DIFFERENT DOMAIN, ON PURPOSE ──────────────────────────────────────
 * OUTREACH_FROM_EMAIL is outreach.clubmode.ai, newly verified. mail.clubmode.ai
 * carries customers' real club email — registration confirmations, match
 * reminders, the things a member has to receive. Cold mail earns complaints
 * even when it is good, and a complaint rate is a property of a DOMAIN. So the
 * two never share one: the worst a bad week on this list can do is burn the
 * domain that exists to be burned.
 *
 * ── THE DEMO GUARD, SURFACED ────────────────────────────────────────────
 * Same trap as the CRM's send path (see lib/crm/send.ts). safeResendSend
 * returns `{ sent: true, demo: ... }` when it holds a message, which is the
 * right answer for a demo tour and the worst possible answer here. We pass no
 * clubId/clubSlug/billToUserId at all, and any `demo` on the result is
 * recorded as a FAILURE with the reason on it.
 */

import { Resend } from 'resend';
import { safeResendSend } from '@/lib/emailUnsubscribe';
import type { getSupabaseAdmin } from '@/lib/supabase/admin';
import { BLOCK_MESSAGE, compose, replyToFor } from '@/lib/crm/compose';
import { postalAddress } from '@/lib/crm/send';
import type { Contact, Org } from '@/lib/crm/types';
import { capForDay, insideWindow, outreachToday } from './settings';
import { loadSettings, MIN_DAYS_BETWEEN_EMAILS } from './plan';
import { QUEUE_COLS, type QueueRow } from './types';

type Db = ReturnType<typeof getSupabaseAdmin>;

/**
 * Where cold mail comes from. NOT mail.clubmode.ai — see the header.
 * Overridable so moving to another subdomain is one variable, no deploy.
 */
export const OUTREACH_FROM =
  process.env.OUTREACH_FROM_EMAIL || 'ClubMode <hello@outreach.clubmode.ai>';

/** How many the cron pushes through in one tick. Small on purpose. */
export const BATCH_SIZE = 4;

export type SendOutcome = 'sent' | 'held' | 'blocked' | 'failed' | 'skipped';

export interface SendReport {
  date: string;
  cap: number;
  sent_today_before: number;
  attempted: number;
  results: { queue_id: string; org_name: string; to: string; outcome: SendOutcome; message: string }[];
  note?: string;
}

/** How many of today's queue rows actually went out. The cap counts these. */
async function sentToday(db: Db, today: string): Promise<number> {
  const { count } = await db
    .from('crm_outreach_queue')
    .select('id', { count: 'exact', head: true })
    .eq('send_date', today)
    .eq('status', 'sent');
  return count ?? 0;
}

async function finish(
  db: Db,
  row: QueueRow,
  status: 'sent' | 'failed',
  detail: string | null,
  resendId: string | null,
) {
  await db
    .from('crm_outreach_queue')
    .update({
      status,
      detail,
      resend_id: resendId,
      sent_at: status === 'sent' ? new Date().toISOString() : null,
    })
    .eq('id', row.id);
}

/**
 * One approved row, all the way out.
 *
 * Exported so a test can drive exactly one send with a stubbed Resend, and so
 * the route that says "send this one now" and the cron that says "send the
 * next four" are the same code path.
 */
export async function sendQueued(
  db: Db,
  row: QueueRow,
  deps: { resend?: { emails: { send(args: unknown): Promise<unknown> } } } = {},
): Promise<{ outcome: SendOutcome; message: string; org_name: string; to: string }> {
  // Re-read the row's own status rather than trusting the caller's copy: two
  // cron ticks overlapping must not send the same card twice.
  const { data: fresh } = await db
    .from('crm_outreach_queue')
    .select('status')
    .eq('id', row.id)
    .maybeSingle();
  if ((fresh as { status?: string } | null)?.status !== 'approved') {
    return { outcome: 'skipped', message: 'Not approved any more.', org_name: '', to: '' };
  }

  const [{ data: org }, { data: contact }] = await Promise.all([
    db.from('crm_orgs').select('*').eq('id', row.org_id).maybeSingle(),
    row.contact_id
      ? db.from('crm_contacts').select('*').eq('id', row.contact_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const o = org as unknown as (Org & { region?: string | null }) | null;
  const c = contact as unknown as Contact | null;
  if (!o || !c) {
    await finish(db, row, 'failed', 'org_or_contact_missing', null);
    return { outcome: 'failed', message: 'The club or the person is gone.', org_name: o?.name ?? '', to: '' };
  }

  // Suppressed since the swipe — a bounce on another address at the club, or
  // the rep logging a reply. The approval is stale; do not send it.
  const { data: supp } = await db
    .from('crm_outreach_suppression')
    .select('id')
    .or(`org_id.eq.${row.org_id},email.eq.${(c.email ?? '').toLowerCase()}`)
    .limit(1);
  if ((supp as unknown[] | null)?.length) {
    await finish(db, row, 'failed', 'suppressed', null);
    return { outcome: 'blocked', message: 'Suppressed since it was approved.', org_name: o.name, to: c.email ?? '' };
  }

  // The 30-day floor, checked against the ledger rather than against our own
  // queue: a hand-written CRM email yesterday counts.
  const since = new Date(Date.now() - MIN_DAYS_BETWEEN_EMAILS * 86_400_000).toISOString();
  const { count: recent } = await db
    .from('crm_email_sends')
    .select('id', { count: 'exact', head: true })
    .eq('org_id', row.org_id)
    .eq('status', 'sent')
    .gte('created_at', since);
  if ((recent ?? 0) > 0) {
    await finish(db, row, 'failed', 'thirty_day_rule', null);
    return {
      outcome: 'blocked',
      message: `${o.name} already got an email in the last ${MIN_DAYS_BETWEEN_EMAILS} days.`,
      org_name: o.name,
      to: c.email ?? '',
    };
  }

  const replyTo = replyToFor('', row.rep_email);
  const built = compose({
    org: o,
    contact: c,
    repName: repNameFrom(row.rep_email),
    replyTo: row.rep_email,
    subject: row.subject,
    body: row.body,
    postalAddress: postalAddress(),
  });
  if (built.blocks.length) {
    const message = built.blocks.map((b) => BLOCK_MESSAGE[b]).join(' ');
    await finish(db, row, 'failed', built.blocks.join(','), null);
    await ledger(db, row, o, c, built, replyTo, 'blocked', built.blocks.join(','), null);
    return { outcome: 'blocked', message, org_name: o.name, to: built.to };
  }

  const resend = deps.resend ?? new Resend(process.env.RESEND_API_KEY);
  const result = await safeResendSend(resend as Resend, {
    from: OUTREACH_FROM,
    to: built.to,
    subject: built.subject,
    html: built.html,
    replyTo,
    // No clubId / clubSlug / billToUserId ON PURPOSE. See the header.
  });

  if (result.sent && result.demo) {
    await finish(db, row, 'failed', `demo_guard:${result.demo}`, null);
    await ledger(db, row, o, c, built, replyTo, 'held', `demo_guard:${result.demo}`, null);
    return {
      outcome: 'held',
      message:
        `NOT SENT. The demo email guard held this one (${result.demo}). Nothing reached the inbox.`,
      org_name: o.name,
      to: built.to,
    };
  }
  if (!result.sent) {
    const blocked = result.reason === 'unsubscribed';
    await finish(db, row, 'failed', blocked ? 'unsubscribed' : result.error ?? 'unknown', null);
    await ledger(db, row, o, c, built, replyTo, blocked ? 'blocked' : 'failed', result.error ?? result.reason, null);
    if (blocked) {
      // An unsubscribe is permanent and global; never propose this address again.
      await db.from('crm_outreach_suppression').insert({
        email: built.to.toLowerCase(),
        org_id: row.org_id,
        reason: 'no thanks',
        note: 'On the unsubscribe list already.',
        queue_id: row.id,
      });
    }
    return {
      outcome: blocked ? 'blocked' : 'failed',
      message: blocked ? `${built.to} has unsubscribed. Not sent.` : result.error || 'The send failed.',
      org_name: o.name,
      to: built.to,
    };
  }

  const messageId = result.messageId ?? null;
  await finish(db, row, 'sent', null, messageId);
  await ledger(db, row, o, c, built, replyTo, 'sent', null, messageId);

  /*
   * The club has now heard from us, so it is no longer research. Guarded on
   * the stage it was: a club a rep has since dragged to 'meeting_set' must not
   * be dragged back by a cron.
   */
  await db.from('crm_orgs').update({ stage: 'contacted' }).eq('id', row.org_id).eq('stage', 'researching');

  /*
   * Day one of the warmup is the day the domain first sent something, not the
   * day somebody first opened the planner. Stamped here, once, guarded by the
   * IS NULL so a later send never restarts the ramp.
   */
  await db
    .from('crm_outreach_settings')
    .update({ warmup_start_date: outreachToday(new Date()) })
    .eq('id', 1)
    .is('warmup_start_date', null);

  return { outcome: 'sent', message: `Sent to ${built.to}.`, org_name: o.name, to: built.to };
}

/** The ledger row + the timeline note, exactly as the CRM's send path writes them. */
async function ledger(
  db: Db,
  row: QueueRow,
  org: Org,
  contact: Contact,
  built: { to: string; subject: string; text: string },
  replyTo: string,
  status: 'sent' | 'held' | 'blocked' | 'failed',
  detail: string | null,
  messageId: string | null,
) {
  await db.from('crm_email_sends').insert({
    org_id: org.id,
    contact_id: contact.id,
    to_email: built.to || '(none)',
    from_email: OUTREACH_FROM,
    reply_to: replyTo,
    subject: built.subject || '(none)',
    body: built.text,
    template_slug: row.kind === 'followup' ? 'outreach-followup' : 'outreach-intro',
    status,
    detail,
    message_id: messageId,
    sent_by_email: row.rep_email,
  });
  // Only a real send is a story about this club. A held or blocked attempt is
  // a fact about our plumbing and would make the timeline lie.
  if (status === 'sent') {
    await db.from('crm_activities').insert({
      org_id: org.id,
      contact_id: contact.id,
      kind: 'email',
      body: `Outreach deck (${row.kind}) — to ${contact.full_name} <${built.to}> — ${built.subject}\n\n${built.text}`,
      created_by_email: row.rep_email,
    });
  }
}

/** "darrinjco@gmail.com" is nobody's signature. Falls back to the product. */
function repNameFrom(email: string): string {
  const local = (email.split('@')[0] ?? '').replace(/[._-]+/g, ' ').trim();
  if (!local) return 'ClubMode';
  return local
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/**
 * The cron's tick: send what is approved, due, inside its club's window, and
 * still under today's cap.
 *
 * Every one of those four is re-derived here rather than trusted from the
 * approval — an approval at 9 PM on Friday is a decision about the EMAIL, not
 * a decision about when it lands.
 */
export async function sendDue(
  db: Db,
  opts: { now?: Date; limit?: number; resend?: { emails: { send(args: unknown): Promise<unknown> } } } = {},
): Promise<SendReport> {
  const now = opts.now ?? new Date();
  const today = outreachToday(now);
  const settings = await loadSettings(db);
  const cap = capForDay(settings, today);
  const already = await sentToday(db, today);

  const report: SendReport = { date: today, cap, sent_today_before: already, attempted: 0, results: [] };
  if (settings.paused) {
    report.note = 'Outreach is paused in settings. Nothing sent.';
    return report;
  }
  if (already >= cap) {
    report.note = `Today's cap of ${cap} is already spent.`;
    return report;
  }

  const { data } = await db
    .from('crm_outreach_queue')
    .select(QUEUE_COLS)
    .eq('status', 'approved')
    .lte('send_date', today)
    .order('approved_at', { ascending: true })
    .limit(50);

  const rows = (data as QueueRow[] | null) ?? [];
  const room = Math.min(cap - already, opts.limit ?? BATCH_SIZE);

  for (const row of rows) {
    if (report.results.filter((r) => r.outcome === 'sent').length >= room) break;
    // The club's clock, not ours. A card approved last night waits for 8 AM
    // where the club is, and a Saturday waits for Monday.
    const { data: org } = await db.from('crm_orgs').select('region, notes').eq('id', row.org_id).maybeSingle();
    const region = (org as { region?: string | null } | null)?.region ?? null;
    if (!insideWindow(settings, region, now)) continue;

    report.attempted += 1;
    const r = await sendQueued(db, row, { resend: opts.resend });
    report.results.push({ queue_id: row.id, org_name: r.org_name, to: r.to, outcome: r.outcome, message: r.message });
  }

  if (!report.attempted && !report.note) {
    report.note = rows.length
      ? 'Nothing is inside its club\'s send window right now.'
      : 'Nothing is approved and waiting.';
  }
  return report;
}
