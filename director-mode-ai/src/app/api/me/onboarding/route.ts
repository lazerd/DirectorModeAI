/**
 * GET /api/me/onboarding — first-run checklist state for the current user.
 */
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

export async function GET() {
  const userClient = await createClient();
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return NextResponse.json({ signedIn: false });

  const admin = getSupabaseAdmin();
  const [{ count: events }, { data: club }, { count: vault }] = await Promise.all([
    admin.from('events').select('*', { count: 'exact', head: true }).eq('user_id', user.id),
    admin.from('cc_clubs').select('id, name').eq('owner_id', user.id).maybeSingle(),
    admin.from('cc_vault_players').select('*', { count: 'exact', head: true }).eq('director_id', user.id),
  ]);

  let courts = 0, members = 0;
  if (club) {
    const [{ count: c }, { count: m }] = await Promise.all([
      admin.from('courts').select('*', { count: 'exact', head: true }).eq('club_id', (club as any).id),
      admin.from('cc_club_members').select('*', { count: 'exact', head: true }).eq('club_id', (club as any).id),
    ]);
    courts = c ?? 0;
    members = m ?? 0;
  }

  return NextResponse.json({
    signedIn: true,
    clubName: (club as any)?.name ?? null,
    hasEvent: (events ?? 0) > 0,
    hasCourts: courts > 0,
    hasMembers: members > 1, // owner + at least one other
    hasVault: (vault ?? 0) > 0,
  });
}
