/**
 * GET  /api/crm/scheduled?org_id=… — what is queued for this club.
 * POST /api/crm/scheduled           — queue one.
 *
 * ── WHAT GETS STORED IS WHAT GOES OUT ────────────────────────────────────
 * The subject and body are RENDERED here, by the same compose() the preview
 * and the Send button use, and the rendered strings are what land on the row.
 * Nothing is re-read from crm_templates when it fires. That is the deal
 * scheduling makes: the rep approved this exact message on Tuesday, so this
 * exact message is what leaves on Thursday, whoever edits what in between.
 *
 * Everything compose() refuses — no address, do-not-contact, no postal
 * address, an unresolved merge field — is refused HERE too. An email that
 * cannot be sent now must not be allowed to sit in a queue for three days and
 * fail quietly at 8 AM.
 *
 * `replaces` carries the id of a scheduled row being edited: the old one is
 * cancelled in the same request, so "edit and save" replaces rather than
 * duplicates. (Cancel-then-insert rather than update-in-place so the
 * superseded text is still on the table if anyone asks what changed.)
 */
import { NextResponse } from 'next/server';
import { bad, isCrmAuthError, requireCrm, text } from '@/lib/crm/server';
import { BLOCK_MESSAGE, compose, mergeValuesFor, renderTemplate } from '@/lib/crm/compose';
import { postalAddress } from '@/lib/crm/send';
import { loadScheduled } from '@/lib/crm/load';
import { checkLocalSchedule } from '@/lib/crm/schedule';
import { SCHEDULED_COLS } from '@/lib/crm/scheduledSend';
import { CONTACT_COLS, ORG_COLS, type Contact, type Org } from '@/lib/crm/types';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const ctx = await requireCrm();
  if (isCrmAuthError(ctx)) return ctx.error;
  const orgId = new URL(req.url).searchParams.get('org_id') ?? '';
  // Same loader the page rendered with, so the shape the client re-reads is
  // the shape it was given — club and contact names included.
  return NextResponse.json({ scheduled: await loadScheduled(ctx.db, orgId || undefined) });
}

export async function POST(req: Request) {
  const ctx = await requireCrm();
  if (isCrmAuthError(ctx)) return ctx.error;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const orgId = typeof body.org_id === 'string' ? body.org_id : '';
  const contactId = typeof body.contact_id === 'string' ? body.contact_id : '';
  if (!orgId || !contactId) return bad('Pick a club and one person.');

  // ------------------------------------------------------------ when, first
  const when = {
    date: typeof body.date === 'string' ? body.date : '',
    time: typeof body.time === 'string' ? body.time : '',
  };
  const check = checkLocalSchedule(when);
  if (!check.ok) return bad(check.message);

  // --------------------------------------------------------------- what
  const [{ data: org }, { data: contact }] = await Promise.all([
    ctx.db.from('crm_orgs').select(ORG_COLS).eq('id', orgId).maybeSingle(),
    ctx.db.from('crm_contacts').select(CONTACT_COLS).eq('id', contactId).maybeSingle(),
  ]);
  if (!org || !contact) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const person = contact as unknown as Contact;
  if (person.org_id !== orgId) return bad('That person is not at that club.');

  const built = compose({
    org: org as unknown as Org,
    contact: person,
    repName: ctx.repName,
    replyTo: ctx.repEmail,
    subject: text(body.subject, 300) ?? '',
    body: text(body.body, 20_000) ?? '',
    postalAddress: postalAddress(),
  });
  if (built.blocks.length) {
    return NextResponse.json(
      { error: built.blocks.map((b) => BLOCK_MESSAGE[b]).join(' '), blocks: built.blocks },
      { status: 422 },
    );
  }

  /*
   * The MERGED body without the signature — the signature is appended at send
   * time by compose(), inside sendCrmEmail, exactly as it is for an immediate
   * send. Storing the signed text too would be a second copy of a rule that
   * reads the environment, and the postal address is env, not data.
   */
  const renderedBody = renderTemplate(
    text(body.body, 20_000) ?? '',
    mergeValuesFor(org as unknown as Org, person, ctx.repName),
  ).text.trimEnd();

  // ------------------------------------------------- replacing an older one
  const replaces = typeof body.replaces === 'string' ? body.replaces : '';
  if (replaces) {
    await ctx.db
      .from('crm_scheduled_emails')
      .update({
        status: 'cancelled',
        cancelled_at: new Date().toISOString(),
        cancelled_by_email: ctx.repEmail,
        detail: 'Replaced by a newer scheduled copy.',
      })
      .eq('id', replaces)
      .eq('status', 'scheduled');
  }

  const { data: created, error } = await ctx.db
    .from('crm_scheduled_emails')
    .insert({
      org_id: orgId,
      contact_id: contactId,
      to_email: built.to,
      subject: built.subject,
      body: renderedBody,
      template_slug: text(body.template_slug, 80),
      send_at: check.at.toISOString(),
      rep_email: ctx.repEmail,
      rep_name: ctx.repName,
      created_by_email: ctx.repEmail,
    })
    .select(SCHEDULED_COLS)
    .maybeSingle();
  if (error || !created) return bad(error?.message || 'Could not schedule that.');

  return NextResponse.json({ scheduled: created });
}
