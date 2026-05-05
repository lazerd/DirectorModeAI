/**
 * POST /api/events/[id]/import-signups
 *
 * Director-only. For mixer-format events where public signups landed in
 * tournament_entries, push each confirmed/paid signup into the legacy
 * event_players + players model so the existing /mixer/events/[id]
 * dashboard (PlayersTab, RoundsTab, etc.) picks them up.
 *
 * For doubles formats (doubles, mixed-doubles), the partner is also
 * imported as a separate player.
 *
 * Idempotent — won't re-import a row already marked with imported_at.
 *
 * Returns: { players_created, signups_imported }
 */

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: eventId } = await params;

  const userClient = await createClient();
  const {
    data: { user },
  } = await userClient.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admin = getSupabaseAdmin();

  const { data: ev } = await admin
    .from('events')
    .select('id, user_id, match_format')
    .eq('id', eventId)
    .maybeSingle();
  if (!ev) return NextResponse.json({ error: 'Event not found' }, { status: 404 });
  if ((ev as any).user_id !== user.id) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  }
  const matchFormat = (ev as any).match_format as string;
  const isDoubles = matchFormat === 'doubles' || matchFormat === 'mixed-doubles';

  // Confirmed signups that haven't been imported yet
  const { data: signupsRaw } = await admin
    .from('tournament_entries')
    .select('id, player_name, partner_name, gender')
    .eq('event_id', eventId)
    .eq('position', 'in_draw')
    .in('payment_status', ['paid', 'waived'])
    .is('imported_at', null);

  const signups = (signupsRaw as any[]) || [];
  if (signups.length === 0) {
    return NextResponse.json({ players_created: 0, signups_imported: 0 });
  }

  // Get current player count to use as strength_order seed
  const { count: existingPlayerCount } = await admin
    .from('event_players')
    .select('*', { count: 'exact', head: true })
    .eq('event_id', eventId);
  let nextOrder = existingPlayerCount ?? 0;

  let playersCreated = 0;

  for (const signup of signups) {
    // Insert primary player
    const { data: player, error: playerErr } = await admin
      .from('players')
      .insert({
        user_id: user.id,
        name: signup.player_name,
        gender: signup.gender,
      })
      .select('id')
      .single();
    if (playerErr || !player) continue; // skip on error, log if needed

    await admin.from('event_players').insert({
      event_id: eventId,
      player_id: (player as any).id,
      strength_order: nextOrder++,
    });
    playersCreated++;

    // For doubles, insert partner as a second player
    if (isDoubles && signup.partner_name) {
      const { data: partner, error: partnerErr } = await admin
        .from('players')
        .insert({
          user_id: user.id,
          name: signup.partner_name,
          gender: null, // partner gender not collected in current form
        })
        .select('id')
        .single();
      if (!partnerErr && partner) {
        await admin.from('event_players').insert({
          event_id: eventId,
          player_id: (partner as any).id,
          strength_order: nextOrder++,
        });
        playersCreated++;
      }
    }

    // Mark signup as imported
    await admin
      .from('tournament_entries')
      .update({ imported_at: new Date().toISOString() })
      .eq('id', signup.id);
  }

  return NextResponse.json({
    players_created: playersCreated,
    signups_imported: signups.length,
  });
}
