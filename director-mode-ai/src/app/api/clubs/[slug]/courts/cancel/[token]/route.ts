/**
 * POST /api/clubs/[slug]/courts/cancel/[token]
 *
 * How somebody with no account releases their own court.
 *
 * The token IS the authorisation — it is 16 random bytes, unique-indexed, and
 * the only thing that proves this is your booking. Without it a club's phone
 * rings every time plans change, and the court sits empty because nobody could
 * give it back.
 *
 * Cancelling sets the reservation to 'cancelled' rather than deleting it: the
 * no_double_booking constraint ignores cancelled rows, so the slot frees up
 * while the club keeps the record of what happened.
 */

import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ slug: string; token: string }> },
) {
  const { token } = await params;
  const clean = (token || '').trim();
  // Shape-check before touching the database: the column is hex from
  // gen_random_bytes, so anything else is not a token anyone was ever given.
  if (!/^[0-9a-f]{32}$/.test(clean)) {
    return NextResponse.json({ error: 'That cancellation link is not valid.' }, { status: 404 });
  }

  const db = getSupabaseAdmin();
  const { data } = await db
    .from('court_bookings')
    .select('id, status, reservation_id, amount_cents, payment_status')
    .eq('cancel_token', clean)
    .maybeSingle();

  const booking = data as
    | { id: string; status: string; reservation_id: string; amount_cents: number; payment_status: string }
    | null;
  if (!booking) {
    return NextResponse.json({ error: 'That cancellation link is not valid.' }, { status: 404 });
  }
  if (booking.status === 'cancelled') {
    // Idempotent: a second click on the link in an email should read as done,
    // not as an error.
    return NextResponse.json({ ok: true, already: true });
  }

  const { error } = await db
    .from('court_bookings')
    .update({
      status: 'cancelled',
      // Nothing is owed on a court nobody used. A payment already taken is
      // left as 'paid' for the club to refund deliberately.
      payment_status: booking.payment_status === 'paid' ? 'paid' : 'waived',
    })
    .eq('id', booking.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Free the court. Status change, not a delete — the constraint skips
  // cancelled rows, so the slot reopens and the history survives.
  await db
    .from('reservations')
    .update({ status: 'cancelled' })
    .eq('id', booking.reservation_id);

  return NextResponse.json({ ok: true, refund_owed: booking.payment_status === 'paid' });
}
