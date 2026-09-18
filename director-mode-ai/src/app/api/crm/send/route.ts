/**
 * POST /api/crm/send — preview one email, then send that exact email.
 *
 *   { org_id, contact_id, subject, body }                 → the preview
 *   { org_id, contact_id, subject, body, confirm: true }  → send it
 *
 * ONE ENDPOINT, TWO MODES, ON PURPOSE. The house rule is a preview before
 * every send, and the only way to guarantee the rep approved the message that
 * actually goes out is for both to be rendered by the same call to compose().
 * A separate /preview route would be a second implementation that could drift
 * — and the drift would only ever be discovered by a club president reading
 * "Hi {{first_name}}".
 *
 * `confirm` is required, so a first click can never send. There is no way to
 * reach the send branch without having asked for a preview first, because the
 * UI only enables the button once it has one — and even if something skipped
 * the UI, the send is still one recipient, still rate-limited, still blocked
 * by do_not_contact.
 */
import { NextResponse } from 'next/server';
import { bad, isCrmAuthError, requireCrm, text } from '@/lib/crm/server';
import { compose, CRM_FROM, replyToFor } from '@/lib/crm/compose';
import { postalAddress, sendCrmEmail } from '@/lib/crm/send';
import { CONTACT_COLS, ORG_COLS, type Contact, type Org } from '@/lib/crm/types';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const ctx = await requireCrm();
  if (isCrmAuthError(ctx)) return ctx.error;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const orgId = typeof body.org_id === 'string' ? body.org_id : '';
  const contactId = typeof body.contact_id === 'string' ? body.contact_id : '';
  if (!orgId || !contactId) return bad('Pick a club and one person.');

  const [{ data: org }, { data: contact }] = await Promise.all([
    ctx.db.from('crm_orgs').select(ORG_COLS).eq('id', orgId).maybeSingle(),
    ctx.db.from('crm_contacts').select(CONTACT_COLS).eq('id', contactId).maybeSingle(),
  ]);
  if (!org || !contact) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  // A contact id from another org would otherwise let a mis-wired client send
  // Rossmoor's intro to Lafayette's owner.
  if ((contact as unknown as Contact).org_id !== orgId) return bad('That person is not at that club.');

  const subject = text(body.subject, 300) ?? '';
  const message = text(body.body, 20_000) ?? '';
  const replyTo = replyToFor(ctx.repName, ctx.repEmail);

  const built = compose({
    org: org as unknown as Org,
    contact: contact as unknown as Contact,
    repName: ctx.repName,
    // The signature prints whatever lands here, so it must be the shared
    // address. Passing the rep's own put Kevin's personal email under "The
    // ClubMode Founding Team" in every draft (caught 2026-09-17).
    replyTo,
    subject,
    body: message,
    postalAddress: postalAddress(),
  });

  // --------------------------------------------------------------- preview
  if (body.confirm !== true) {
    return NextResponse.json({
      preview: {
        from: CRM_FROM,
        reply_to: replyTo,
        to: built.to,
        to_name: (contact as Contact).full_name,
        subject: built.subject,
        text: built.text,
      },
      blocks: built.blocks,
      missing: built.missing,
      can_send: built.blocks.length === 0,
    });
  }

  // ------------------------------------------------------------------ send
  const outcome = await sendCrmEmail({
    db: ctx.db,
    org: org as unknown as Org,
    contact: contact as unknown as Contact,
    repName: ctx.repName,
    repEmail: ctx.repEmail,
    subject,
    body: message,
    templateSlug: text(body.template_slug, 80),
  });

  // Only a real send is a 200. A hold reads as success to safeResendSend and
  // must not read as one here — see lib/crm/send.ts.
  return NextResponse.json(outcome, { status: outcome.status === 'sent' ? 200 : 422 });
}
