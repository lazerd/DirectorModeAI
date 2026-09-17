/**
 * Firing the emails a rep scheduled.
 *
 * Called by /api/cron/crm-scheduled-send, which a pg_cron job hits every 15
 * minutes with the CRON_SECRET bearer. (pg_cron and not vercel.json: this is
 * a Hobby account, where a more-frequent-than-daily entry in vercel.json
 * fails the whole DEPLOY. Same reason, same pattern, as outreach-send-hourly.)
 *
 * ── IT GOES OUT THE SAME WAY AN IMMEDIATE SEND DOES ──────────────────────
 * The one thing this file must not do is grow a second mail path. It calls
 * sendCrmEmail() — the same function the Send button calls — so the postal
 * address, the opt-out line, the signature, the rate limits, the ledger row,
 * the crm_activities entry and, above all, THE DEMO GUARD behave identically.
 * safeResendSend answers a held message with `{ sent: true }`; sendCrmEmail
 * already turns that into a refusal, and a scheduled send inherits that
 * without restating it. A scheduled email that was silently swallowed must
 * read as failed here, not as sent.
 *
 * What it passes is the text ALREADY RENDERED and already approved, straight
 * off the row. Merge fields were substituted before the rep previewed it, so
 * compose() finds nothing left to merge and the message is byte-for-byte what
 * they read. Nothing is re-read from crm_templates.
 *
 * ── A CANCELLED ROW CAN NEVER SEND ───────────────────────────────────────
 * Every row is CLAIMED first: UPDATE ... SET status='sending' WHERE id = ?
 * AND status = 'scheduled', returning the row. Postgres decides. A row a rep
 * cancelled a millisecond ago comes back empty and is skipped, and two
 * overlapping ticks cannot both take the same row.
 *
 * ── AND IT RE-CHECKS EVERYTHING ──────────────────────────────────────────
 * Tuesday's approval is not Thursday's permission. Before sending it re-reads
 * the contact (still not do_not_contact? still has this address?) and the rep
 * (still on the allowlist?). A failure is written to the row with its reason,
 * never dropped.
 */

import type { getSupabaseAdmin } from '@/lib/supabase/admin';
import { platformOwnerEmails } from '@/lib/platformOwner';
import { sendCrmEmail } from './send';
import { CONTACT_COLS, ORG_COLS, type Contact, type Org } from './types';

type Db = ReturnType<typeof getSupabaseAdmin>;

/**
 * Four per tick, like the outreach deck. At 15-minute ticks that is plenty for
 * two people writing by hand, and it means a bug cannot turn into a blast
 * inside one request.
 */
export const BATCH_SIZE = 4;

/**
 * A row stuck mid-send for this long was orphaned by a crashed or timed-out
 * function. It is marked failed rather than retried: we do not know whether
 * Resend accepted it, and sending a club president the same email twice is
 * worse than sending it late. The reason on the row says to check.
 */
export const STUCK_MS = 30 * 60_000;

export interface ScheduledRow {
  id: string;
  org_id: string;
  contact_id: string;
  to_email: string;
  subject: string;
  body: string;
  template_slug: string | null;
  send_at: string;
  rep_email: string;
  rep_name: string;
  status: 'scheduled' | 'sending' | 'sent' | 'cancelled' | 'failed';
  detail: string | null;
  message_id: string | null;
  attempts: number;
  sent_at: string | null;
  created_by_email: string;
  created_at: string;
  updated_at: string;
}

export const SCHEDULED_COLS =
  'id, org_id, contact_id, to_email, subject, body, template_slug, send_at, rep_email, ' +
  'rep_name, status, detail, message_id, attempts, sent_at, created_by_email, created_at, updated_at';

export interface ScheduledReport {
  considered: number;
  sent: number;
  failed: number;
  skipped: number;
  reaped: number;
  results: { id: string; status: string; message: string }[];
}

/** Is this rep still someone who may send? Checked again at fire time. */
export async function repStillAllowed(db: Db, repEmail: string): Promise<boolean> {
  const email = (repEmail ?? '').trim().toLowerCase();
  if (!email) return false;
  if (platformOwnerEmails().includes(email)) return true;
  const { data } = await db
    .from('crm_users')
    .select('email, active')
    .eq('email', email)
    .eq('active', true)
    .maybeSingle();
  return !!data;
}

async function finish(
  db: Db,
  id: string,
  patch: Record<string, unknown>,
): Promise<void> {
  await db.from('crm_scheduled_emails').update(patch).eq('id', id);
}

/** Orphaned claims, turned into something a human can see. */
async function reapStuck(db: Db, now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - STUCK_MS).toISOString();
  const { data } = await db
    .from('crm_scheduled_emails')
    .update({
      status: 'failed',
      detail:
        'Interrupted while sending — we do not know if it went. Check Resend before scheduling it again.',
    })
    .eq('status', 'sending')
    .lt('claimed_at', cutoff)
    .select('id');
  return ((data as { id: string }[] | null) || []).length;
}

export async function sendDueScheduled(db: Db, now: Date = new Date()): Promise<ScheduledReport> {
  const report: ScheduledReport = {
    considered: 0,
    sent: 0,
    failed: 0,
    skipped: 0,
    reaped: await reapStuck(db, now),
    results: [],
  };

  const { data: due } = await db
    .from('crm_scheduled_emails')
    .select(SCHEDULED_COLS)
    .eq('status', 'scheduled')
    .lte('send_at', now.toISOString())
    .order('send_at')
    .limit(BATCH_SIZE);

  const rows = (due as ScheduledRow[] | null) || [];
  report.considered = rows.length;

  for (const row of rows) {
    /*
     * THE CLAIM. Postgres, not this process, decides who gets the row — and a
     * row that is no longer 'scheduled' (cancelled, rescheduled, or taken by
     * an overlapping tick) simply is not returned.
     */
    const { data: claimedRows } = await db
      .from('crm_scheduled_emails')
      .update({
        status: 'sending',
        claimed_at: now.toISOString(),
        attempts: (row.attempts ?? 0) + 1,
      })
      .eq('id', row.id)
      .eq('status', 'scheduled')
      .select('id');
    if (!((claimedRows as { id: string }[] | null) || []).length) {
      report.skipped++;
      report.results.push({ id: row.id, status: 'skipped', message: 'No longer scheduled.' });
      continue;
    }

    const fail = async (message: string) => {
      await finish(db, row.id, { status: 'failed', detail: message });
      report.failed++;
      report.results.push({ id: row.id, status: 'failed', message });
    };

    // ------------------------------------------ is this still allowed to go?
    if (!(await repStillAllowed(db, row.rep_email))) {
      await fail(`${row.rep_email} is no longer a CRM user, so this was not sent.`);
      continue;
    }

    const [{ data: org }, { data: contact }] = await Promise.all([
      db.from('crm_orgs').select(ORG_COLS).eq('id', row.org_id).maybeSingle(),
      db.from('crm_contacts').select(CONTACT_COLS).eq('id', row.contact_id).maybeSingle(),
    ]);
    if (!org || !contact) {
      await fail('The club or the contact is gone, so this was not sent.');
      continue;
    }
    const person = contact as unknown as Contact;
    if (person.do_not_contact) {
      await fail(`${person.full_name} is marked "don't contact" now, so this was not sent.`);
      continue;
    }
    if ((person.email ?? '').trim().toLowerCase() !== row.to_email.trim().toLowerCase()) {
      await fail(
        `${person.full_name}'s address changed since this was scheduled (${row.to_email} → ${person.email ?? 'none'}). Not sent — write it again.`,
      );
      continue;
    }

    // -------------------------------------- the same path as the Send button
    const outcome = await sendCrmEmail({
      db,
      org: org as unknown as Org,
      contact: person,
      repName: row.rep_name,
      repEmail: row.rep_email,
      // Already rendered and already approved. Nothing is re-merged.
      subject: row.subject,
      body: row.body,
      templateSlug: row.template_slug,
    });

    if (outcome.status === 'sent') {
      await finish(db, row.id, {
        status: 'sent',
        sent_at: new Date().toISOString(),
        message_id: outcome.messageId ?? null,
        detail: null,
      });
      report.sent++;
      report.results.push({ id: row.id, status: 'sent', message: outcome.message });
    } else {
      // held / blocked / failed all land here. A demo hold is NOT a send.
      await fail(outcome.message);
    }
  }

  return report;
}
