/**
 * POST /api/crm/autopilot — the autopilot's on/off switch.
 *
 *   { auto_send: true | false }
 *
 * Turning it ON also approves today's already-planned autopilot cards, so the
 * letters the page was showing are the ones that go out; turning it OFF puts
 * approved-but-unsent autopilot cards back to planned, so nothing queued
 * slips out after someone hit stop.
 */
import { NextResponse } from 'next/server';
import { bad, isCrmAuthError, requireCrm } from '@/lib/crm/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const ctx = await requireCrm();
  if (isCrmAuthError(ctx)) return ctx.error;
  const body = (await req.json().catch(() => ({}))) as { auto_send?: unknown };
  if (typeof body.auto_send !== 'boolean') return bad('Say on or off.');

  const db = getSupabaseAdmin();
  await db.from('crm_outreach_settings').update({ auto_send: body.auto_send }).eq('id', 1);
  if (body.auto_send) {
    await db
      .from('crm_outreach_queue')
      .update({ status: 'approved', approved_at: new Date().toISOString(), rep_email: ctx.repEmail })
      .eq('status', 'planned')
      .not('variant', 'is', null);
  } else {
    await db.from('crm_outreach_queue').update({ status: 'planned', approved_at: null }).eq('status', 'approved').not('variant', 'is', null);
  }
  return NextResponse.json({ ok: true, auto_send: body.auto_send });
}
