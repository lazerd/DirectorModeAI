/**
 * POST /api/crm/orgs/[id]/activities — log what happened.
 *
 * `occurred_at` defaults to now, and a date-only value is anchored at midday
 * in the reps' zone. Storing a bare "2026-09-16" as UTC midnight would show up
 * as the 15th on the card, which is exactly the class of bug that makes a
 * timeline untrustworthy.
 */
import { NextResponse } from 'next/server';
import { bad, isCrmAuthError, requireCrm, text } from '@/lib/crm/server';
import { isISODate } from '@/lib/crm/dates';
import { isActivityKind } from '@/lib/crm/stages';
import { ACTIVITY_COLS, type Activity } from '@/lib/crm/types';

export const dynamic = 'force-dynamic';

/**
 * A YYYY-MM-DD from a date input, as an instant.
 *
 * Noon Pacific is -07:00 or -08:00 depending on the season, and 19:00Z is
 * inside the same calendar day for both — so the row reads back as the day the
 * rep picked, in every month of the year.
 */
function atMiddayPacific(iso: string): string {
  return `${iso}T19:00:00.000Z`;
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const ctx = await requireCrm();
  if (isCrmAuthError(ctx)) return ctx.error;

  const { data: org } = await ctx.db.from('crm_orgs').select('id').eq('id', params.id).maybeSingle();
  if (!org) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const note = text(body.body, 8000);
  if (!note) return bad('What happened?');
  const kind = body.kind ?? 'note';
  if (!isActivityKind(kind)) return bad('Pick a kind.');

  let occurredAt: string | undefined;
  if (body.occurred_at) {
    const raw = String(body.occurred_at);
    if (isISODate(raw)) occurredAt = atMiddayPacific(raw);
    else if (!Number.isNaN(new Date(raw).getTime())) occurredAt = new Date(raw).toISOString();
    else return bad('That date is not a date.');
  }

  const contactId = typeof body.contact_id === 'string' && body.contact_id ? body.contact_id : null;

  const { data, error } = await ctx.db
    .from('crm_activities')
    .insert({
      org_id: params.id,
      contact_id: contactId,
      kind,
      body: note,
      created_by_email: ctx.repEmail,
      ...(occurredAt ? { occurred_at: occurredAt } : {}),
    })
    .select(ACTIVITY_COLS)
    .single();
  if (error) return bad(error.message, 500);
  return NextResponse.json({ activity: data as Activity });
}
