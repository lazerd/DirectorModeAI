/**
 * The whole season as one .ics — every match this player's team plays.
 *
 * The season availability email lists all the dates, and a parent reading it
 * wants them in the phone right then. Seven separate "add to calendar" links is
 * a chore nobody finishes, so this is one file with N events: Apple Calendar,
 * Google Calendar and Outlook all import it, which is the only way to cover
 * every ecosystem with a single button.
 *
 * No auth: the player token is the credential, same as every other player link.
 * Nothing here is scoped to the individual — it is the team's fixture list, and
 * the events say so rather than naming a court the player may not end up on.
 */
import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { buildIcs, matchEvent } from '@/lib/captain/calendar';
import type { MatchInfo } from '@/lib/captain/emails';

type Ctx = { params: { token: string } };

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

  const [{ data: matchRows }, { data: teamRow }] = await Promise.all([
    admin
      .from('captain_matches')
      .select('id, match_at, is_home, opponent, location, arrival_note')
      .eq('team_id', player.team_id)
      .neq('status', 'cancelled')
      .order('match_at'),
    admin.from('captain_teams').select('name').eq('id', player.team_id).maybeSingle(),
  ]);

  const teamName = (teamRow as { name: string } | null)?.name ?? 'Team';
  const matches = (matchRows as Record<string, unknown>[] | null) ?? [];
  if (!matches.length) {
    return NextResponse.json({ error: 'No matches scheduled yet.' }, { status: 404 });
  }

  const events = matches.map((m) => {
    const info: MatchInfo = {
      id: m.id as string,
      matchAt: m.match_at as string,
      isHome: !!m.is_home,
      opponent: (m.opponent as string | null) ?? null,
      location: (m.location as string | null) ?? null,
      arrivalNote: (m.arrival_note as string | null) ?? null,
    };
    // No court number: this is the season list, built before any lineup exists.
    return matchEvent(teamName, info, null);
  });

  const filename = `${teamName.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-season.ics`;

  return new NextResponse(buildIcs(events), {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      // A parent who taps this in October should get October's schedule, not a
      // cached copy from September.
      'Cache-Control': 'no-store',
    },
  });
}
