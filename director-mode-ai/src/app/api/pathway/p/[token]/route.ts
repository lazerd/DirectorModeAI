/**
 * GET /api/pathway/p/[token]
 *
 * Public — no auth. The family magic link. Returns one player's position on
 * the Junior Pathway: their level, every stripe they hold (with dates), and
 * nothing about any other kid. The curriculum itself ships with the client
 * (src/lib/pathway/curriculum.ts); this only returns the player's state.
 */

import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(_req: Request, { params }: { params: { token: string } }) {
  const token = params.token;
  if (!token || token.length < 8) {
    return NextResponse.json({ error: 'Invalid link.' }, { status: 400 });
  }
  const admin = getSupabaseAdmin();

  const { data: player } = await admin
    .from('pathway_players')
    .select('id, name, level, enrolled, active, created_at')
    .eq('family_token', token)
    .maybeSingle();
  if (!player || !(player as any).active) {
    return NextResponse.json({ error: 'Link not recognized.' }, { status: 404 });
  }

  const [{ data: awards }, { data: checks }] = await Promise.all([
    admin
      .from('pathway_awards')
      .select('stripe_key, awarded_on')
      .eq('player_id', (player as any).id)
      .order('awarded_on', { ascending: true }),
    admin
      .from('pathway_test_checks')
      .select('stripe_key, test_index, passed_on')
      .eq('player_id', (player as any).id),
  ]);

  return NextResponse.json({
    player: {
      name: (player as any).name,
      level: (player as any).level,
      enrolled: (player as any).enrolled,
    },
    awards: awards ?? [],
    checks: checks ?? [],
  });
}
