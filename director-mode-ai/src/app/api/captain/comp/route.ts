/**
 * POST /api/captain/comp { user_id, on, note? } — give (or take back) free
 * CaptainMode for one of your own club's people.
 *
 * Owner/director only, and it writes status 'comped' rather than 'active': a
 * gift and a sale must never look the same in the data. The billing webhook
 * only ever writes rows it has a LemonSqueezy subscription for, so a comp is
 * not something it can silently overwrite — and this route refuses to touch
 * anyone who IS paying, because cancelling someone's paid subscription by
 * "comping" them would be the worst possible way to be generous.
 */
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as {
    user_id?: string;
    on?: boolean;
    note?: string;
  };
  if (!body.user_id) return NextResponse.json({ error: 'Missing person.' }, { status: 400 });

  const db = getSupabaseAdmin();

  // Which club is the caller running, and are they entitled to give it away?
  const { data: owned } = await db
    .from('cc_clubs')
    .select('id, name')
    .eq('owner_id', user.id)
    .order('created_at')
    .limit(1)
    .maybeSingle();
  const { data: staff } = owned
    ? { data: null }
    : await db
        .from('cc_club_members')
        .select('club_id, cc_clubs(name)')
        .eq('user_id', user.id)
        .in('role', ['owner', 'director'])
        .limit(1)
        .maybeSingle();

  const clubId = (owned?.id as string) || (staff?.club_id as string) || null;
  const clubName =
    (owned?.name as string) ||
    ((staff as unknown as { cc_clubs: { name: string } | null })?.cc_clubs?.name) ||
    'your club';
  if (!clubId) {
    return NextResponse.json(
      { error: 'Only a club owner or director can comp CaptainMode.' },
      { status: 403 },
    );
  }

  /**
   * You may only comp your own people. Otherwise this is a way to hand out a
   * paid product to anyone whose user id you can guess.
   */
  const { data: membership } = await db
    .from('cc_club_members')
    .select('user_id')
    .eq('club_id', clubId)
    .eq('user_id', body.user_id)
    .maybeSingle();
  if (!membership) {
    return NextResponse.json(
      { error: `They need to be at ${clubName} first — invite them, then comp them.` },
      { status: 400 },
    );
  }

  const { data: existing } = await db
    .from('captain_subscriptions')
    .select('status, stripe_subscription_id')
    .eq('user_id', body.user_id)
    .maybeSingle();

  // Never cancel a paying customer in the name of a favour.
  if (existing?.stripe_subscription_id) {
    return NextResponse.json(
      {
        error:
          'They already pay for CaptainMode. Cancel their subscription in billing first, or they will be charged twice over.',
      },
      { status: 409 },
    );
  }

  if (body.on === false) {
    if (existing?.status !== 'comped') {
      return NextResponse.json({ error: 'They are not comped.' }, { status: 400 });
    }
    const { error } = await db
      .from('captain_subscriptions')
      .update({
        status: 'inactive',
        comp_note: null,
        comped_by: null,
        comped_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', body.user_id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, comped: false });
  }

  const { error } = await db.from('captain_subscriptions').upsert(
    {
      user_id: body.user_id,
      club_id: clubId,
      // The rate a comp would have been charged at, kept honest for reporting.
      rate_type: 'club_linked',
      status: 'comped',
      comp_note: (body.note || '').trim() || `Comped by ${clubName}`,
      comped_by: user.id,
      comped_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' },
  );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, comped: true });
}
