/**
 * The club's court bookings — who has what, and who still owes.
 *
 * Upcoming first, because that is what a front desk is looking at. Past
 * bookings are the revenue record and stay available behind a flag.
 *
 * The start time lives on `reservations` and is read through the embed rather
 * than copied onto court_bookings, so there is only ever one answer to when a
 * booking is.
 */

import { NextResponse } from 'next/server';
import { requireStaffForClub } from '@/lib/courtsheet/routeAuth';

export const dynamic = 'force-dynamic';

type BookingRow = {
  id: string;
  booker_name: string;
  booker_email: string;
  booker_phone: string | null;
  rate_applied: 'member' | 'public';
  minutes: number;
  amount_cents: number;
  payment_status: string;
  status: string;
  notes: string | null;
  created_at: string;
  courts: { name: string | null; number: number | null } | null;
  reservations: { starts_at: string; ends_at: string; status: string } | null;
};

export async function GET(req: Request) {
  const ctx = await requireStaffForClub();
  if ('error' in ctx) return ctx.error;

  const past = new URL(req.url).searchParams.get('past') === '1';
  const nowIso = new Date().toISOString();

  const { data, error } = await ctx.db
    .from('court_bookings')
    .select(
      'id, booker_name, booker_email, booker_phone, rate_applied, minutes, amount_cents, payment_status, status, notes, created_at, courts(name, number), reservations!inner(starts_at, ends_at, status)',
    )
    .eq('club_id', ctx.club.id)
    .order('created_at', { ascending: false })
    .limit(300);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = ((data as unknown as BookingRow[]) ?? []).filter((r) => {
    const starts = r.reservations?.starts_at;
    if (!starts) return false;
    return past ? starts < nowIso : starts >= nowIso;
  });

  // Soonest first when looking forward, most recent first when looking back.
  rows.sort((a, b) => {
    const av = a.reservations?.starts_at ?? '';
    const bv = b.reservations?.starts_at ?? '';
    return past ? bv.localeCompare(av) : av.localeCompare(bv);
  });

  const unpaid = rows.filter(
    (r) => r.status === 'booked' && r.payment_status === 'pending' && r.amount_cents > 0,
  );

  return NextResponse.json({
    bookings: rows,
    unpaid_count: unpaid.length,
    unpaid_cents: unpaid.reduce((sum, r) => sum + (r.amount_cents || 0), 0),
    timezone: ctx.club.timezone,
  });
}

export async function PATCH(req: Request) {
  const ctx = await requireStaffForClub({ requireWrite: true });
  if ('error' in ctx) return ctx.error;

  const body = (await req.json().catch(() => ({}))) as {
    booking_id?: string;
    payment_status?: 'pending' | 'paid' | 'waived' | 'refunded';
    cancel?: boolean;
  };
  const id = (body.booking_id || '').trim();
  if (!id) return NextResponse.json({ error: 'Which booking?' }, { status: 400 });

  const { data: booking } = await ctx.db
    .from('court_bookings')
    .select('id, reservation_id, payment_status')
    .eq('id', id)
    .eq('club_id', ctx.club.id)
    .maybeSingle();
  if (!booking) return NextResponse.json({ error: 'No such booking.' }, { status: 404 });

  const row = booking as { id: string; reservation_id: string; payment_status: string };

  if (body.cancel) {
    await ctx.db
      .from('court_bookings')
      .update({
        status: 'cancelled',
        // A payment already taken stays 'paid' so the club refunds it
        // deliberately rather than having the record quietly rewritten.
        payment_status: row.payment_status === 'paid' ? 'paid' : 'waived',
      })
      .eq('id', id);
    // Status change, not a delete: the no_double_booking constraint skips
    // cancelled rows, so the court frees up and the history survives.
    await ctx.db.from('reservations').update({ status: 'cancelled' }).eq('id', row.reservation_id);
    return NextResponse.json({ ok: true, cancelled: true });
  }

  if (!body.payment_status) {
    return NextResponse.json({ error: 'Nothing to change.' }, { status: 400 });
  }
  const { error } = await ctx.db
    .from('court_bookings')
    .update({ payment_status: body.payment_status })
    .eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
