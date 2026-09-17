/**
 * POST /api/crm/templates — save what the rep just wrote as a new template.
 *
 * The body is a DRAFT: the merge fields are already filled in, because the rep
 * has been editing the thing they are about to send to one person. Turning it
 * back into a template is lib/crm/templates.ts, and it is allowed to refuse —
 * see the header there for the bug this prevents.
 *
 * org_id and contact_id are required, and not for lookup convenience: they are
 * how we know which real values were merged INTO this draft, so "Mary" becomes
 * {{first_name}} because Mary is who it was addressed to, and not because
 * "Mary" is on some list of names.
 *
 * GET returns the list, so the composer can refresh the "Start from" buttons
 * without a page reload.
 */
import { NextResponse } from 'next/server';
import { bad, isCrmAuthError, requireCrm, text } from '@/lib/crm/server';
import { mergeValuesFor } from '@/lib/crm/compose';
import { loadTemplates } from '@/lib/crm/load';
import { templateFromDraft, templateSlugFrom } from '@/lib/crm/templates';
import { CONTACT_COLS, ORG_COLS, type Contact, type Org } from '@/lib/crm/types';

export const dynamic = 'force-dynamic';

export async function GET() {
  const ctx = await requireCrm();
  if (isCrmAuthError(ctx)) return ctx.error;
  return NextResponse.json({ templates: await loadTemplates(ctx.db) });
}

export async function POST(req: Request) {
  const ctx = await requireCrm();
  if (isCrmAuthError(ctx)) return ctx.error;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const name = text(body.name, 60);
  const orgId = typeof body.org_id === 'string' ? body.org_id : '';
  const contactId = typeof body.contact_id === 'string' ? body.contact_id : '';
  const subject = text(body.subject, 300) ?? '';
  const draftBody = text(body.body, 20_000) ?? '';

  if (!name) return bad('Give it a short name.');
  if (!subject || !draftBody) return bad('A template needs a subject and a message.');
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
    // 422, not 400: the request was well-formed, the CONTENT is the problem,
    // and the half-cleaned text comes back so the rep can finish it by hand.
    return NextResponse.json(
      { error: check.message, leaks: check.leaks, template: check.template },
      { status: 422 },
    );
  }

  // A slug that is free. Names repeat ("Follow-up"), slugs may not.
  const base = templateSlugFrom(name);
  const { data: taken } = await ctx.db.from('crm_templates').select('slug').like('slug', `${base}%`);
  const used = new Set(((taken as { slug: string }[] | null) || []).map((r) => r.slug));
  let slug = base;
  for (let i = 2; used.has(slug) && i < 200; i++) slug = `${base}-${i}`;

  // New ones sort after the seeded four and before the deck's two, so a rep's
  // own template is where they will look for it rather than last.
  const { data: created, error } = await ctx.db
    .from('crm_templates')
    .insert({ slug, name, subject: check.template.subject, body: check.template.body, sort_order: 50 })
    .select('id, slug, name, subject, body')
    .maybeSingle();
  if (error || !created) return bad(error?.message || 'Could not save that template.');

  return NextResponse.json({ template: created, templates: await loadTemplates(ctx.db) });
}
