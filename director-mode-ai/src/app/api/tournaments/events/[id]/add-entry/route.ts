/**
 * POST /api/tournaments/events/[id]/add-entry
 *
 * Director-only. Adds a player directly without going through the public
 * signup flow. Useful for hybrid tournaments (some public signups + some
 * director-invited) or fully private setups.
 *
 * Skips Stripe (payment marked 'waived'). Director controls the position
 * (in_draw if there's room, else waitlist).
 *
 * Body: { player_name, player_email?, parent_email?, gender?, ntrp?, utr?, partner_name? }
 * Returns: { entry_id, position }
 */

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { computeQuadComposite } from '@/lib/quads';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: eventId } = await params;

  const userClient = await createClient();
  const {
    data: { user },
  } = await userClient.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admin = getSupabaseAdmin();

  const { data: ev } = await admin
    .from('events')
    .select('id, user_id, max_players, match_format')
    .eq('id', eventId)
    .maybeSingle();
  if (!ev) return NextResponse.json({ error: 'Event not found' }, { status: 404 });
  if ((ev as any).user_id !== user.id) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const player_name = typeof body.player_name === 'string' ? body.player_name.trim().slice(0, 80) : '';
  if (!player_name) {
    return NextResponse.json({ error: 'player_name is required' }, { status: 400 });
  }

  const player_email = typeof body.player_email === 'string' ? body.player_email.trim().slice(0, 120) || null : null;
  const parent_email = typeof body.parent_email === 'string' ? body.parent_email.trim().slice(0, 120) || null : null;
  const genderRaw = typeof body.gender === 'string' ? body.gender.toLowerCase() : '';
  const gender =
    genderRaw === 'male' || genderRaw === 'female' || genderRaw === 'nonbinary' ? genderRaw : null;
  const ntrp =
    typeof body.ntrp === 'number' && body.ntrp >= 1 && body.ntrp <= 7 ? body.ntrp : null;
  const utr = typeof body.utr === 'number' && body.utr > 0 && body.utr <= 16 ? body.utr : null;
  const partner_name =
    typeof body.partner_name === 'string' ? body.partner_name.trim().slice(0, 80) || null : null;

  const composite = computeQuadComposite({ utr, ntrp });

  // Decide initial position
  const inDrawCount = (await admin
    .from('tournament_entries')
    .select('*', { count: 'exact', head: true })
    .eq('event_id', eventId)
    .eq('position', 'in_draw')).count ?? 0;
  const maxPlayers = (ev as any).max_players ?? null;
  const position: 'in_draw' | 'waitlist' =
    maxPlayers && inDrawCount >= maxPlayers ? 'waitlist' : 'in_draw';

  const { data: entry, error: insErr } = await admin
    .from('tournament_entries')
    .insert({
      event_id: eventId,
      player_name,
      player_email,
      parent_email,
      gender,
      ntrp,
      utr,
      composite_rating: composite || null,
      partner_name,
      position,
      payment_status: 'waived',
    })
    .select('id')
    .single();
  if (insErr || !entry) {
    return NextResponse.json({ error: insErr?.message || 'Could not create entry' }, { status: 500 });
  }

  return NextResponse.json({ entry_id: (entry as any).id, position });
}
