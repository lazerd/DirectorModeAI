/**
 * GET   /api/clubs/members — the caller's owned club, its join code, and roster.
 * PATCH /api/clubs/members — change a member's role.
 *
 * Owner-only (a director managing their club). Service role so we can read
 * members' profile names past RLS.
 *
 * Roles are what one subscription buys: the club pays once, and the owner
 * decides who on their team gets staff access. The boundary that matters is
 * is_club_team() in Postgres — owner/director/coach/front_desk can see and run
 * the club's events; role 'member' (what the public join link grants) cannot,
 * because entry lists carry members' contact details.
 */
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';

// Not exported — Next route files may only export handlers.
/** Ordered loosest-to-tightest for display. Must match is_club_team(). */
const CLUB_ROLES = ['owner', 'director', 'coach', 'front_desk', 'member'] as const;
type ClubRole = (typeof CLUB_ROLES)[number];

/** Roles that count as staff — kept in sync with the SQL helper. */
const STAFF_ROLES: ClubRole[] = ['owner', 'director', 'coach', 'front_desk'];

export async function GET() {
  const userClient = await createClient();
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admin = getSupabaseAdmin();
  const { data: club } = await admin
    .from('cc_clubs')
    .select('id, name, join_code')
    .eq('owner_id', user.id)
    .maybeSingle();
  if (!club) return NextResponse.json({ club: null, members: [] });

  const { data: members } = await admin
    .from('cc_club_members')
    .select('user_id, role, created_at')
    .eq('club_id', club.id)
    .order('created_at');

  const ids = (members || []).map((m) => m.user_id);
  const { data: profs } = ids.length
    ? await admin.from('profiles').select('id, email, full_name').in('id', ids)
    : { data: [] as any[] };
  const pmap = Object.fromEntries((profs || []).map((p: any) => [p.id, p]));

  const roster = (members || []).map((m) => ({
    userId: m.user_id,
    role: m.role,
    isStaff: STAFF_ROLES.includes(m.role as ClubRole),
    isOwner: m.role === 'owner',
    name: pmap[m.user_id]?.full_name || pmap[m.user_id]?.email || 'Member',
    email: pmap[m.user_id]?.email || null,
  }));

  return NextResponse.json({
    club: { name: club.name, join_code: club.join_code },
    members: roster,
    staffCount: roster.filter((r) => r.isStaff).length,
  });
}

export async function PATCH(req: Request) {
  const userClient = await createClient();
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => null);
  const targetUserId = String(body?.userId || '');
  const role = String(body?.role || '') as ClubRole;

  if (!targetUserId) return NextResponse.json({ error: 'Missing userId.' }, { status: 400 });
  if (!CLUB_ROLES.includes(role)) return NextResponse.json({ error: 'Unknown role.' }, { status: 400 });
  if (role === 'owner') {
    return NextResponse.json(
      { error: 'Ownership transfer isn\'t available here — it moves the subscription too.' },
      { status: 400 },
    );
  }

  const admin = getSupabaseAdmin();
  const { data: club } = await admin
    .from('cc_clubs')
    .select('id, owner_id')
    .eq('owner_id', user.id)
    .maybeSingle();
  if (!club) return NextResponse.json({ error: 'You do not own a club.' }, { status: 403 });

  // The owner is the payer; demoting them would orphan the subscription.
  if (targetUserId === club.owner_id) {
    return NextResponse.json({ error: 'You cannot change your own role.' }, { status: 400 });
  }

  const { data, error } = await admin
    .from('cc_club_members')
    .update({ role })
    .eq('club_id', club.id)
    .eq('user_id', targetUserId)
    .select('user_id, role')
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  if (!data) return NextResponse.json({ error: 'That person is not in your club.' }, { status: 404 });

  return NextResponse.json({
    userId: data.user_id,
    role: data.role,
    isStaff: STAFF_ROLES.includes(data.role as ClubRole),
  });
}
