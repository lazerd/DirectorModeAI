/**
 * DELETE /api/crm/scheduled/[id] — cancel one.
 *
 * A cancel is a status change, not a row deletion: what was going to go out,
 * to whom, and who stopped it, are all worth keeping. The `.eq('status',
 * 'scheduled')` on the update is the important half — it is the same guard the
 * cron's claim uses from the other side, so a row already being sent cannot be
 * "cancelled" into a lie, and the rep is told it was too late.
 *
 * Either rep may cancel either rep's. They are two partners, not two tenants,
 * and a scheduled email only its author can stop is a trap.
 *
 * There is no PATCH. Editing a scheduled email re-opens it in the composer and
 * saves a NEW row with `replaces` set — see POST /api/crm/scheduled — because
 * an edit must go back through the preview, like every other send.
 */
import { NextResponse } from 'next/server';
import { isCrmAuthError, requireCrm } from '@/lib/crm/server';

export const dynamic = 'force-dynamic';

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const ctx = await requireCrm();
  if (isCrmAuthError(ctx)) return ctx.error;

  const { data } = await ctx.db
    .from('crm_scheduled_emails')
    .update({
      status: 'cancelled',
      cancelled_at: new Date().toISOString(),
      cancelled_by_email: ctx.repEmail,
      detail: `Cancelled by ${ctx.repEmail}.`,
    })
    .eq('id', params.id)
    .eq('status', 'scheduled')
    .select('id, to_email');

  const rows = (data as { id: string; to_email: string }[] | null) || [];
  if (!rows.length) {
    // Either it was never there, or it has already gone out / is going out
    // right now. Say which, rather than reporting a cancel that did not happen.
    const { data: still } = await ctx.db
      .from('crm_scheduled_emails')
      .select('status')
      .eq('id', params.id)
      .maybeSingle();
    if (!still) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const status = (still as { status: string }).status;
    return NextResponse.json(
      {
        error:
          status === 'sent'
            ? 'Too late — that one has already gone out.'
            : status === 'sending'
              ? 'Too late — that one is going out right now.'
              : `That one is already ${status}.`,
        status,
      },
      { status: 409 },
    );
  }

  return NextResponse.json({ ok: true, cancelled: rows[0].id });
}
