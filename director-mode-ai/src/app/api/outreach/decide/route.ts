/**
 * POST /api/outreach/decide — one swipe.
 *
 *   { queue_id, action: 'approve' | 'skip' | 'snooze' | 'edit' | 'undo', ... }
 *
 * Every action is a status change on one queue row (lib/outreach/deck.ts).
 * NOTHING here sends: 'approve' sets the row to `approved` and stops. The
 * sender is a different module behind a different trigger, so the worst a bug
 * on this route can do is queue an email nobody wanted — which Undo reverses.
 */
import { NextResponse } from 'next/server';
import { bad, isCrmAuthError, requireCrm, text } from '@/lib/crm/server';
import { approve, reject, saveEdit, snooze, undo } from '@/lib/outreach/deck';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const ctx = await requireCrm();
  if (isCrmAuthError(ctx)) return ctx.error;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const queueId = typeof body.queue_id === 'string' ? body.queue_id : '';
  const action = typeof body.action === 'string' ? body.action : '';
  if (!queueId) return bad('Which card?');

  const subject = text(body.subject, 300) ?? undefined;
  const message = text(body.body, 20_000) ?? undefined;

  const result = await (async () => {
    switch (action) {
      case 'approve':
        return approve(ctx.db, queueId, ctx.repEmail, { subject, body: message });
      case 'skip':
        return reject(ctx.db, queueId, ctx.repEmail, text(body.reason, 200));
      case 'snooze':
        return snooze(ctx.db, queueId, ctx.repEmail, 7);
      case 'edit':
        return saveEdit(ctx.db, queueId, { subject, body: message });
      case 'undo':
        return undo(ctx.db, queueId, ctx.repEmail);
      default:
        return { ok: false as const, error: 'Unknown action.' };
    }
  })();

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: ('status' in result && result.status) || 400 });
  }
  return NextResponse.json(result);
}
