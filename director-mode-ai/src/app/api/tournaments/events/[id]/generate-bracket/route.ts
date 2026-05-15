/**
 * POST /api/tournaments/events/[id]/generate-bracket
 *
 * Director-only. Seeds confirmed entries by composite_rating descending,
 * generates the bracket per the event's match_format using the pure
 * generators in src/lib/tournamentFormats.ts, and inserts every match
 * into tournament_matches.
 *
 * If matches already exist for this event, this WIPES them first
 * (regenerate scenario). Director must confirm via the UI.
 *
 * Returns: { matches_created, in_draw, waitlisted }
 */

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import {
  generateTournamentMatches,
  type TournamentFormat,
} from '@/lib/tournamentFormats';

const VALID_FORMATS = new Set<TournamentFormat>([
  'rr-singles',
  'rr-doubles',
  'single-elim-singles',
  'single-elim-doubles',
  'fmlc-singles',
  'fmlc-doubles',
  'ffic-singles',
  'ffic-doubles',
]);

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
    .select('id, user_id, match_format, max_players')
    .eq('id', eventId)
    .maybeSingle();
  if (!ev) return NextResponse.json({ error: 'Event not found' }, { status: 404 });
  if ((ev as any).user_id !== user.id) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  }
  const format = (ev as any).match_format as TournamentFormat;
  if (!VALID_FORMATS.has(format)) {
    return NextResponse.json(
      { error: `Format ${format} doesn't use the generic tournament generator.` },
      { status: 400 }
    );
  }

  // Pull entries that intend to play. Manual seeds are honored — if the
  // director set seed = 1/2/3/4 on the Entries tab, those teams keep
  // their seed positions. Unseeded entries are ordered by composite_rating
  // descending and filled into the remaining seed slots.
  const { data: entriesRaw } = await admin
    .from('tournament_entries')
    .select('id, composite_rating, seed')
    .eq('event_id', eventId)
    .in('position', ['in_draw']);

  const entries = (entriesRaw as any[]) || [];
  if (entries.length < 2) {
    return NextResponse.json(
      { error: 'Need at least 2 confirmed entries to generate a bracket.' },
      { status: 400 }
    );
  }

  // Sort: manual seeds first (1, 2, 3, ...), then unseeded by rating desc.
  entries.sort((a, b) => {
    const sa = a.seed ?? Infinity;
    const sb = b.seed ?? Infinity;
    if (sa !== sb) return sa - sb;
    return (b.composite_rating ?? 0) - (a.composite_rating ?? 0);
  });

  // Cap at max_players if set
  const maxPlayers = (ev as any).max_players ?? null;
  const inDraw = maxPlayers && maxPlayers > 0 ? entries.slice(0, maxPlayers) : entries;
  const waitlisted = maxPlayers && maxPlayers > 0 ? entries.slice(maxPlayers) : [];

  // Wipe existing matches
  await admin.from('tournament_matches').delete().eq('event_id', eventId);

  // Re-assign seeds 1..N in the sorted order. Manual seeds 1..K filled
  // contiguously from 1 stay put; unseeded entries fill K+1..N. If manual
  // seeds have gaps (e.g. 1 + 5 but no 2/3/4), the relative order is
  // preserved but values are compacted.
  for (let i = 0; i < inDraw.length; i++) {
    await admin
      .from('tournament_entries')
      .update({ seed: i + 1 })
      .eq('id', inDraw[i].id);
  }
  // Move overflow to waitlist
  for (const e of waitlisted) {
    await admin
      .from('tournament_entries')
      .update({ position: 'waitlist', seed: null })
      .eq('id', e.id);
  }

  // Generate
  const inDrawIds = inDraw.map((e) => e.id as string);
  const generated = generateTournamentMatches(format, inDrawIds);

  // Insert matches
  if (generated.length > 0) {
    const rows = generated.map((m) => ({
      event_id: eventId,
      bracket: m.bracket,
      round: m.round,
      slot: m.slot,
      match_type: m.match_type,
      player1_id: m.player1_id,
      player2_id: m.player2_id,
      player3_id: m.player3_id,
      player4_id: m.player4_id,
      winner_feeds_to: m.winner_feeds_to,
      loser_feeds_to: m.loser_feeds_to,
    }));
    const { error: insErr } = await admin.from('tournament_matches').insert(rows);
    if (insErr) {
      return NextResponse.json({ error: insErr.message }, { status: 500 });
    }
  }

  // Move event to running
  await admin
    .from('events')
    .update({ public_status: 'running' })
    .eq('id', eventId);

  return NextResponse.json({
    matches_created: generated.length,
    in_draw: inDraw.length,
    waitlisted: waitlisted.length,
  });
}
