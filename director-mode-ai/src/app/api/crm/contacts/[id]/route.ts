/**
 * PATCH  /api/crm/contacts/[id] — inline edits, including the "don't contact" toggle.
 * DELETE /api/crm/contacts/[id] — remove someone added by mistake.
 *
 * do_not_contact is set here and enforced in lib/crm/compose.ts, so the toggle
 * is not advisory: the Compose panel refuses to pick the contact, and the send
 * route refuses again if something manages to ask anyway.
 */
import { NextResponse } from 'next/server';
import { bad, isCrmAuthError, requireCrm, text } from '@/lib/crm/server';
import { CONTACT_COLS, type Contact } from '@/lib/crm/types';

export const dynamic = 'force-dynamic';

const TEXT_FIELDS: Record<string, number> = {
  full_name: 160,
  title: 160,
  phone: 60,
  role: 120,
  notes: 4000,
};

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const ctx = await requireCrm();
  if (isCrmAuthError(ctx)) return ctx.error;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const patch: Record<string, unknown> = {};
  for (const [key, max] of Object.entries(TEXT_FIELDS)) {
    if (!(key in body)) continue;
    const v = text(body[key], max);
    if (key === 'full_name' && !v) return bad('A contact needs a name.');
    patch[key] = v;
  }
  if ('email' in body) patch.email = text(body.email, 200)?.toLowerCase() ?? null;
  if ('do_not_contact' in body) patch.do_not_contact = body.do_not_contact === true;
  if ('is_primary' in body) patch.is_primary = body.is_primary === true;
  if (!Object.keys(patch).length) return bad('Nothing to change.');

  // One primary per club, so promoting someone demotes whoever held it. Done
  // before the write, so a failure leaves the old primary in place.
  if (patch.is_primary === true) {
    const { data: row } = await ctx.db.from('crm_contacts').select('org_id').eq('id', params.id).maybeSingle();
    if (row) {
      await ctx.db
        .from('crm_contacts')
        .update({ is_primary: false })
        .eq('org_id', (row as { org_id: string }).org_id)
        .neq('id', params.id);
    }
  }

  const { data, error } = await ctx.db
    .from('crm_contacts')
    .update(patch)
    .eq('id', params.id)
    .select(CONTACT_COLS)
    .maybeSingle();
  if (error) return bad(error.message, 500);
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ contact: data as Contact });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const ctx = await requireCrm();
  if (isCrmAuthError(ctx)) return ctx.error;
  const { error } = await ctx.db.from('crm_contacts').delete().eq('id', params.id);
  if (error) return bad(error.message, 500);
  return NextResponse.json({ ok: true });
}
