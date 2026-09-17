/**
 * Actually sending one CRM email.
 *
 * Goes through safeResendSend — the same wrapper every other email in the app
 * uses — so the unsubscribe blocklist and the signed one-click footer come for
 * free and there is no second mail path to keep in step. What is DIFFERENT
 * here, and deliberate:
 *
 * ── THE DEMO GUARD ───────────────────────────────────────────────────────
 * safeResendSend holds any send it decides belongs to a demo, and returns
 * `{ sent: true, messageId: 'demo-suppressed' }` — success-shaped, because for
 * a demo tour that is the right answer. For the CRM it is the worst possible
 * answer: Darrin writes to a club president, sees "Sent", and nothing left the
 * building.
 *
 * Both halves of that risk are real, not hypothetical (checked 2026-09-16):
 *   - cc_clubs.demo_mode is TRUE for rossmoor-tennis-club and
 *     rossmoor-pickleball-club. Passing `clubId` on a send to either club's
 *     board would trip `demo_club` and swallow every one. So a CRM send passes
 *     NO clubId, clubSlug or billToUserId — a CRM send is not a club send, and
 *     crm_orgs.club_id is a pointer to a demo we built, not the audience.
 *   - mail@rossmoortennis.com is that demo club's contact address, so it sits
 *     in the demo snapshot's email set and WOULD be held as `demo_recipient`
 *     however it is attributed.
 *
 * So the guard is not bypassed — it is surfaced. `demo` on the result is
 * checked, recorded as status 'held', and returned to the UI as a refusal with
 * the reason in it. A held CRM email must never read as a sent one.
 *
 * ── RATE LIMITS ──────────────────────────────────────────────────────────
 * Per rep, per hour and per day, counted from crm_email_sends (the ledger the
 * reps cannot edit). Two reps hand-writing to volunteer boards will never come
 * near these; they exist so a bug in a loop cannot turn a warm intro list into
 * a blast from a domain we need for transactional club mail.
 */

import { Resend } from 'resend';
import { safeResendSend } from '@/lib/emailUnsubscribe';
import type { getSupabaseAdmin } from '@/lib/supabase/admin';
import { BLOCK_MESSAGE, compose, CRM_FROM, replyToFor, type ComposeInput } from './compose';
import type { Contact, Org } from './types';

/** Generous for two people writing by hand; fatal to a runaway loop. */
export const HOURLY_CAP = 12;
export const DAILY_CAP = 40;

export type SendStatus = 'sent' | 'held' | 'blocked' | 'failed';

export interface SendOutcome {
  status: SendStatus;
  /** Plain English, shown to the rep. */
  message: string;
  messageId?: string;
}

export interface SendArgs {
  db: ReturnType<typeof getSupabaseAdmin>;
  org: Org;
  contact: Contact;
  repName: string;
  repEmail: string;
  subject: string;
  body: string;
  templateSlug?: string | null;
}

/** The postal address that goes on every message. Missing means no sending. */
export function postalAddress(): string | null {
  const v = (process.env.CRM_POSTAL_ADDRESS || '').trim();
  return v || null;
}

/** How many a rep has logged in the last `hours`, whatever the outcome. */
async function sentSince(
  db: SendArgs['db'],
  repEmail: string,
  hours: number,
): Promise<number> {
  const since = new Date(Date.now() - hours * 3600_000).toISOString();
  const { count } = await db
    .from('crm_email_sends')
    .select('id', { count: 'exact', head: true })
    .eq('sent_by_email', repEmail)
    .eq('status', 'sent')
    .gte('created_at', since);
  return count ?? 0;
}

async function record(
  db: SendArgs['db'],
  args: SendArgs,
  built: { to: string; subject: string; text: string },
  replyTo: string,
  status: SendStatus,
  detail: string | null,
  messageId: string | null,
) {
  await db.from('crm_email_sends').insert({
    org_id: args.org.id,
    contact_id: args.contact.id,
    to_email: built.to || '(none)',
    from_email: CRM_FROM,
    reply_to: replyTo,
    subject: built.subject || '(none)',
    body: built.text,
    template_slug: args.templateSlug ?? null,
    status,
    detail,
    message_id: messageId,
    sent_by_email: args.repEmail,
  });

  /*
   * The narrative copy. Only a real send becomes an activity: a blocked or
   * held attempt is a fact about our plumbing, not about the club, and it
   * would make the timeline lie about what this prospect has heard from us.
   * The ledger above keeps all four, forever.
   */
  if (status === 'sent') {
    await db.from('crm_activities').insert({
      org_id: args.org.id,
      contact_id: args.contact.id,
      kind: 'email',
      body: `To ${args.contact.full_name} <${built.to}> — ${built.subject}\n\n${built.text}`,
      created_by_email: args.repEmail,
    });
  }
}

export async function sendCrmEmail(args: SendArgs): Promise<SendOutcome> {
  const { db } = args;
  const replyTo = replyToFor(args.repName, args.repEmail);
  const input: ComposeInput = {
    org: args.org,
    contact: args.contact,
    repName: args.repName,
    // The shared address, never the rep's own — see CRM_REPLY_TO.
    replyTo,
    subject: args.subject,
    body: args.body,
    postalAddress: postalAddress(),
  };
  const built = compose(input);

  // Everything compose() refuses, refused again here. The UI checks the same
  // list, but the UI is not the gate.
  if (built.blocks.length) {
    const message = built.blocks.map((b) => BLOCK_MESSAGE[b]).join(' ');
    await record(db, args, built, replyTo, 'blocked', built.blocks.join(','), null);
    return { status: 'blocked', message };
  }

  const hourly = await sentSince(db, args.repEmail, 1);
  if (hourly >= HOURLY_CAP) {
    await record(db, args, built, replyTo, 'blocked', 'hourly_cap', null);
    return { status: 'blocked', message: `That is ${HOURLY_CAP} in an hour — give it a rest and try later.` };
  }
  const daily = await sentSince(db, args.repEmail, 24);
  if (daily >= DAILY_CAP) {
    await record(db, args, built, replyTo, 'blocked', 'daily_cap', null);
    return { status: 'blocked', message: `That is ${DAILY_CAP} today. Tomorrow.` };
  }

  const resend = new Resend(process.env.RESEND_API_KEY);
  const result = await safeResendSend(resend, {
    from: CRM_FROM,
    to: built.to,
    subject: built.subject,
    html: built.html,
    replyTo,
    // No clubId / clubSlug / billToUserId ON PURPOSE. See the header.
  });

  if (result.sent && result.demo) {
    await record(db, args, built, replyTo, 'held', `demo_guard:${result.demo}`, null);
    return {
      status: 'held',
      message:
        `NOT SENT. The demo email guard held this one (${result.demo}). ` +
        'Nothing reached the inbox — check whether that address belongs to a demo club.',
    };
  }
  if (result.sent) {
    await record(db, args, built, replyTo, 'sent', null, result.messageId ?? null);
    return { status: 'sent', message: `Sent to ${built.to}.`, messageId: result.messageId };
  }
  if (result.reason === 'unsubscribed') {
    await record(db, args, built, replyTo, 'blocked', 'unsubscribed', null);
    return { status: 'blocked', message: `${built.to} has unsubscribed. Not sent.` };
  }
  await record(db, args, built, replyTo, 'failed', result.error ?? 'unknown', null);
  return { status: 'failed', message: result.error || 'The send failed.' };
}
