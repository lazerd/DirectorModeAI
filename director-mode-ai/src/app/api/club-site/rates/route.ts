/**
 * GET / POST the club's court rate cards.
 *
 * These are the numbers a booking is priced against, so they are the numbers a
 * director has to own. Setting up two rows — free to members, $24 to the
 * public — is what switches online court booking on for a club.
 */

import { NextResponse } from 'next/server';
import { requireStaffForClub } from '@/lib/courtsheet/routeAuth';
import { rateCardWriteSchema } from '@/lib/courts/schema';

export const dynamic = 'force-dynamic';

export async function GET() {
  const ctx = await requireStaffForClub();
  if ('error' in ctx) return ctx.error;

  const { data } = await ctx.db
    .from('court_rate_cards')
    .select('*')
    .eq('club_id', ctx.club.id)
    .order('display_order')
    .order('applies_to');

  // Bookings made so far, so a director can see the feature working rather
  // than wondering whether anyone used it.
  const { count: bookings } = await ctx.db
    .from('court_bookings')
    .select('id', { count: 'exact', head: true })
    .eq('club_id', ctx.club.id)
    .eq('status', 'booked');

  return NextResponse.json({
    rates: data ?? [],
    bookings: bookings ?? 0,
    club: { slug: ctx.club.slug, name: ctx.club.name, timezone: ctx.club.timezone },
  });
}

export async function POST(req: Request) {
  const ctx = await requireStaffForClub({ requireWrite: true });
  if ('error' in ctx) return ctx.error;

  const parsed = rateCardWriteSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return NextResponse.json(
      { error: `${first?.path?.join('.') || 'That'}: ${first?.message || 'not valid'}` },
      { status: 400 },
    );
  }

  const { data, error } = await ctx.db
    .from('court_rate_cards')
    .insert({ ...parsed.data, club_id: ctx.club.id })
    .select('*')
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, rate: data });
}
