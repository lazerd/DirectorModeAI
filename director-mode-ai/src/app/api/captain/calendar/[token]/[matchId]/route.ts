/**
 * Serves the match as a .ics file — the Apple Calendar / Outlook half of the
 * "add to calendar" pair in the lineup email. Google gets a template URL
 * instead (see lib/captain/calendar.ts).
 *
 * No auth: the player token is the credential, same as every other player link.
 * A token that isn't on the match's team gets a 404 rather than a generic
 * event, so a stray link can't leak another team's schedule.
 */
import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { buildIcs, matchEvent } from '@/lib/captain/calendar';
import type { MatchInfo } from '@/lib/captain/emails';

type Ctx = { params: { token: string; matchId: string } };

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: Ctx) {
  const admin = getSupabaseAdmin();

  const { data: playerRow } = await admin
    .from('captain_players')
    .select('id, team_id, name')
    .eq('player_token', params.token)
    .maybeSingle();
  const player = playerRow as { id: string; team_id: string; name: string } | null;
  if (!player) return NextResponse.json({ error: 'Link not recognized.' }, { status: 404 });

  const [{ data: matchRow }, { data: teamRow }, { data: lineupRow }] = await Promise.all([
    admin
      .from('captain_matches')
      .select(
        'id, match_at, is_home, opponent, location, arrival_note, opposing_captain_name, opposing_captain_phone',
      )
      .eq('id', params.matchId)
      .eq('team_id', player.team_id)
      .maybeSingle(),
    admin.from('captain_teams').select('name').eq('id', player.team_id).maybeSingle(),
    admin
      .from('captain_lineups')
      .select('court_number, court_type')
      .eq('match_id', params.matchId)
      .or(`player1_id.eq.${player.id},player2_id.eq.${player.id}`)
      .maybeSingle(),
  ]);

  const m = matchRow as Record<string, unknown> | null;
  if (!m) return NextResponse.json({ error: 'Match not found.' }, { status: 404 });

  const info: MatchInfo = {
    id: m.id as string,
    matchAt: m.match_at as string,
    isHome: m.is_home as boolean,
    opponent: (m.opponent as string) || null,
    location: (m.location as string) || null,
    arrivalNote: (m.arrival_note as string) || null,
    opposingCaptainName: (m.opposing_captain_name as string) || null,
    opposingCaptainPhone: (m.opposing_captain_phone as string) || null,
  };

  const l = lineupRow as { court_number: number; court_type: string } | null;
  const court = l ? `${l.court_type === 'singles' ? 'Singles' : 'Doubles'} ${l.court_number}` : null;

  const ics = buildIcs(
    matchEvent((teamRow as { name: string } | null)?.name || 'Tennis', info, court),
  );

  const day = new Date(info.matchAt).toISOString().slice(0, 10);
  return new NextResponse(ics, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `attachment; filename="match-${day}.ics"`,
      'Cache-Control': 'no-store',
    },
  });
}
