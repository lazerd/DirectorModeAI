/**
 * PATCH /api/crm/templates/[id] — overwrite a template, or rename it.
 * DELETE /api/crm/templates/[id] — remove one.
 *
 * Overwriting goes through the SAME un-merge-then-refuse check as saving a new
 * one (lib/crm/templates.ts). "Update Intro (warm)" is exactly the move that
 * bakes a recipient's name into a template everybody then sends — it is the
 * more dangerous of the two, not the safer one, because the template already
 * looked fine yesterday.
 *
 * A rename carries no message text, so it needs no check.
 *
 * ── THE TWO THE DECK NEEDS ───────────────────────────────────────────────
 * `outreach-intro` and `outreach-followup` are looked up BY SLUG by the cold
 * outreach engine (src/lib/outreach/write.ts) and are its fallback when a
 * generated draft fails validation. Deleting one does not make the deck worse,
 * it makes it stop. Refused here, by slug, on the server — the UI hides the
 * button too, but the UI is not the lock.
 */
import { NextResponse } from 'next/server';
import { bad, isCrmAuthError, requireCrm, text } from '@/lib/crm/server';
import { mergeValuesFor } from '@/lib/crm/compose';
import { loadTemplates } from '@/lib/crm/load';
import { isProtectedTemplate, templateFromDraft } from '@/lib/crm/templates';
import { CONTACT_COLS, ORG_COLS, type Contact, type Org } from '@/lib/crm/types';

export const dynamic = 'force-dynamic';

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const ctx = await requireCrm();
  if (isCrmAuthError(ctx)) return ctx.error;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const { data: existing } = await ctx.db
    .from('crm_templates')
    .select('id, slug, name, subject, body')
    .eq('id', params.id)
    .maybeSingle();
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const tpl = existing as { id: string; slug: string; name: string; subject: string; body: string };

  const patch: Record<string, unknown> = {};

  // ------------------------------------------------------------- a rename
  const name = text(body.name, 60);
  if (name && name !== tpl.name) patch.name = name;

  // --------------------------------------------------- new subject + body
  const hasText = typeof body.subject === 'string' || typeof body.body === 'string';
  if (hasText) {
    const subject = text(body.subject, 300) ?? '';
    const draftBody = text(body.body, 20_000) ?? '';
    if (!subject || !draftBody) return bad('A template needs a subject and a message.');

    const orgId = typeof body.org_id === 'string' ? body.org_id : '';
    const contactId = typeof body.contact_id === 'string' ? body.contact_id : '';
    if (!orgId || !contactId) return bad('Which club and which person this was written for.');

    const [{ data: org }, { data: contact }] = await Promise.all([
      ctx.db.from('crm_orgs').select(ORG_COLS).eq('id', orgId).maybeSingle(),
      ctx.db.from('crm_contacts').select(CONTACT_COLS).eq('id', contactId).maybeSingle(),
    ]);
    if (!org || !contact) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if ((contact as unknown as Contact).org_id !== orgId) return bad('That person is not at that club.');

    const values = mergeValuesFor(org as unknown as Org, contact as unknown as Contact, ctx.repName);
    const check = templateFromDraft(
      { subject, body: draftBody },
      values,
      org as unknown as Org,
      contact as unknown as Contact,
    );
    if (!check.ok) {
      return NextResponse.json(
        { error: check.message, leaks: check.leaks, template: check.template },
        { status: 422 },
      );
    }
    patch.subject = check.template.subject;
    patch.body = check.template.body;
  }

  if (!Object.keys(patch).length) return bad('Nothing to change.');

  const { data: updated, error } = await ctx.db
    .from('crm_templates')
    .update(patch)
    .eq('id', params.id)
    .select('id, slug, name, subject, body')
    .maybeSingle();
  if (error || !updated) return bad(error?.message || 'Could not save that template.');

  return NextResponse.json({ template: updated, templates: await loadTemplates(ctx.db) });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const ctx = await requireCrm();
  if (isCrmAuthError(ctx)) return ctx.error;

  const { data: existing } = await ctx.db
    .from('crm_templates')
    .select('id, slug, name')
    .eq('id', params.id)
    .maybeSingle();
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const tpl = existing as { id: string; slug: string; name: string };

  if (isProtectedTemplate(tpl.slug)) {
    return bad(
      `"${tpl.name}" is what the cold outreach deck writes from — deleting it would stop the deck. ` +
        'Edit its wording instead.',
      409,
    );
  }

  const { error } = await ctx.db.from('crm_templates').delete().eq('id', params.id);
  if (error) return bad(error.message);
  return NextResponse.json({ ok: true, templates: await loadTemplates(ctx.db) });
}
