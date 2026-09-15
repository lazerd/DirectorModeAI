/**
 * Manual trigger for the JTT match-RSVP confirmation emails.
 *   GET /api/leagues/rsvp-confirmations  (Authorization: Bearer <CRON_SECRET>)
 * It is also the automated daily run: vercel.json calls it at 18:00 UTC, the
 * slot it used to share with the retired /api/courtconnect/event-reminders.
 * The director (or a test) can still fire it on demand.
 */
import { NextRequest, NextResponse } from 'next/server';
import { sendDueRsvpConfirmations } from '@/lib/jttRsvpConfirmations';

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization') || '';
  const secret = process.env.CRON_SECRET;
  if (!secret || auth !== `Bearer ${secret}`)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const result = await sendDueRsvpConfirmations();
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json({ error: (e as Error)?.message || 'failed' }, { status: 500 });
  }
}
