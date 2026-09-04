/**
 * POST /api/captain/trial — start the free 14-day CaptainMode trial.
 *
 * The landing page for the season-opener email. No card, no checkout, no
 * payment provider in the path at all: the trial is a row in our own table
 * with an end date, and getCaptainAccess enforces that date.
 *
 * Deliberately once per captain, forever. `created_at` is not reset and an
 * existing subscription of any kind is never touched — a paying captain who
 * clicks the link out of curiosity must not be downgraded to a trial, and
 * someone whose trial ran out must not get another by clicking again.
 */
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { getCaptainAccess, resolveCaptainRate, TRIAL_DAYS } from '@/lib/captain/access';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { source?: string };

  const existing = await getCaptainAccess(user.id);
  if (existing.status) {
    // Already known to billing in some form. Say which, so the page can show
    // the right thing rather than pretending the click did nothing.
    return NextResponse.json({
      ok: true,
      already: true,
      status: existing.status,
      active: existing.active,
      trialExpired: existing.trialExpired,
      trialDaysLeft: existing.trialDaysLeft,
    });
  }

  const db = getSupabaseAdmin();

  /*
   * The rate the trial converts to when it ends, so the page can tell the
   * captain what they would pay rather than making them find out at checkout.
   * A captain who belongs to a club on ClubMode Pro gets the $10 rate.
   */
  const { data: membership } = await db
    .from('cc_club_members')
    .select('club_id')
    .eq('user_id', user.id)
    .limit(1)
    .maybeSingle();
  const clubId = (membership as { club_id: string } | null)?.club_id ?? null;
  const rate = await resolveCaptainRate(clubId);

  const now = new Date();
  const ends = new Date(now.getTime() + TRIAL_DAYS * 86_400_000);

  const { error } = await db.from('captain_subscriptions').insert({
    user_id: user.id,
    status: 'trialing',
    rate_type: rate,
    club_id: clubId,
    trial_started_at: now.toISOString(),
    trial_ends_at: ends.toISOString(),
    signup_source: (body.source || '').slice(0, 120) || null,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    ok: true,
    already: false,
    trialEndsAt: ends.toISOString(),
    trialDaysLeft: TRIAL_DAYS,
    rateType: rate,
  });
}
