/**
 * GET /api/clubs/members — the caller's owned club, its join code, and its roster.
 * Owner-only (a director managing their club). Service role so we can read
 * members' profile names past RLS.
 */
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';

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
    role: m.role,
    name: pmap[m.user_id]?.full_name || pmap[m.user_id]?.email || 'Member',
    email: pmap[m.user_id]?.email || null,
  }));

  return NextResponse.json({ club: { name: club.name, join_code: club.join_code }, members: roster });
}
