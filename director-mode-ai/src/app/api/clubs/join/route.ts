/**
 * POST /api/clubs/join  { code }
 * Attaches the current user to a club as a 'member' via its join code.
 * Uses the service role (members can't self-insert into cc_club_members under RLS).
 */
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';

export async function POST(req: Request) {
  const userClient = await createClient();
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { code } = await req.json().catch(() => ({}));
  if (!code || typeof code !== 'string') return NextResponse.json({ error: 'Missing club code' }, { status: 400 });

  const admin = getSupabaseAdmin();
  const { data: club } = await admin
    .from('cc_clubs')
    .select('id, name, owner_id')
    .ilike('join_code', code.trim())
    .maybeSingle();
  if (!club) return NextResponse.json({ error: "That club code wasn't found." }, { status: 404 });

  const { data: existing } = await admin
    .from('cc_club_members')
    .select('role')
    .eq('club_id', club.id)
    .eq('user_id', user.id)
    .maybeSingle();

  if (!existing) {
    // Don't demote an owner who scans their own link.
    const role = club.owner_id === user.id ? 'owner' : 'member';
    const { error } = await admin.from('cc_club_members').insert({ club_id: club.id, user_id: user.id, role });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ club: club.name, alreadyMember: !!existing });
}
