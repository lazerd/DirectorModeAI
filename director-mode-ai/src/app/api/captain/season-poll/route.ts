/**
 * Season availability request.
 *   GET  ?team_id=…                       — per-player answered/total, so the
 *                                            captain can see who is still out.
 *   POST { team_id, only_missing?, include_subs? }
 *        — email the roster ONE message covering every upcoming match.
 *
 * Mirrors /api/captain/poll, which does the same job one match at a time.
 */
import { NextResponse } from 'next/server';
import { requireTeam, isError, type CaptainCtx } from '@/lib/captain/server';
import { seasonAvailabilityEmail, sendAll, type MatchInfo } from '@/lib/captain/emails';
import { CreditLimitError } from '@/lib/billing';
import { creditLimitResponse } from '@/lib/email';

const TZ = 'America/Los_Angeles';

type Player = {
  id: string;
  name: string;
  email: string | null;
  player_token: string;
  is_sub: boolean;
};

/** Upcoming scheduled matches, using the same window the player page shows. */
async function upcoming(db: CaptainCtx['db'], teamId: string) {
  const { data } = await db
    .from('captain_matches')
    .select('id, match_at, is_home, opponent, location')
    .eq('team_id', teamId)
    .eq('status', 'scheduled')
    .gte('match_at', new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString())
    .order('match_at');
  return ((data as Record<string, unknown>[]) || []).map(
    (m): MatchInfo => ({
      id: m.id as string,
      matchAt: m.match_at as string,
      isHome: m.is_home as boolean,
      opponent: (m.opponent as string) || null,
      location: (m.location as string) || null,
    }),
  );
}

export async function GET(req: Request) {
  const teamId = new URL(req.url).searchParams.get('team_id');
  if (!teamId) return NextResponse.json({ error: 'team_id is required.' }, { status: 400 });

  const ctx = await requireTeam(teamId);
  if (isError(ctx)) return ctx.error;
  const { db } = ctx;

  const matches = await upcoming(db, teamId);
  const { data: players } = await db
    .from('captain_players')
    .select('id, name, email, is_sub')
    .eq('team_id', teamId)
    .eq('active', true)
    .order('is_sub')
    .order('name');
  const roster = (players as Omit<Player, 'player_token'>[]) || [];

  const matchIds = matches.map((m) => m.id);
  const counts: Record<string, number> = {};
  if (matchIds.length) {
    const { data: avail } = await db
      .from('captain_availability')
      .select('player_id, match_id')
      .in('match_id', matchIds);
    for (const a of (avail as { player_id: string }[]) || []) {
      counts[a.player_id] = (counts[a.player_id] ?? 0) + 1;
    }
  }

  return NextResponse.json({
    total_matches: matches.length,
    players: roster.map((p) => ({
      id: p.id,
      name: p.name,
      email: p.email,
      is_sub: p.is_sub,
      answered: counts[p.id] ?? 0,
    })),
  });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    team_id?: string;
    only_missing?: boolean;
    include_subs?: boolean;
  };
  if (!body.team_id) return NextResponse.json({ error: 'team_id is required.' }, { status: 400 });

  const ctx = await requireTeam(body.team_id);
  if (isError(ctx)) return ctx.error;
  const { db, team, teamId } = ctx;

  const matches = await upcoming(db, teamId);
  if (!matches.length) {
    return NextResponse.json(
      { error: 'No upcoming matches on the schedule to ask about.' },
      { status: 400 },
    );
  }

  const { data: players } = await db
    .from('captain_players')
    .select('id, name, email, player_token, is_sub')
    .eq('team_id', teamId)
    .eq('active', true);

  let roster = ((players as Player[]) || []).filter((p) => !!p.email);
  if (!body.include_subs) roster = roster.filter((p) => !p.is_sub);

  // Who has already answered every upcoming match? Nobody needs to be nagged twice.
  const answeredCount: Record<string, number> = {};
  const { data: avail } = await db
    .from('captain_availability')
    .select('player_id')
    .in(
      'match_id',
      matches.map((m) => m.id),
    );
  for (const a of (avail as { player_id: string }[]) || []) {
    answeredCount[a.player_id] = (answeredCount[a.player_id] ?? 0) + 1;
  }

  if (body.only_missing) {
    roster = roster.filter((p) => (answeredCount[p.id] ?? 0) < matches.length);
  }

  if (!roster.length) return NextResponse.json({ ok: true, sent: 0, skipped: 'everyone answered' });

  const payloads = roster.map((p) =>
    seasonAvailabilityEmail(
      team.name,
      matches,
      { playerId: p.id, name: p.name, email: p.email as string, token: p.player_token },
      { tz: TZ, reminder: !!body.only_missing, answered: answeredCount[p.id] ?? 0 },
    ),
  );

  try {
    const results = await sendAll(ctx.userId, payloads);
    return NextResponse.json({
      ok: true,
      sent: results.filter((r) => r.sent).length,
      matches: matches.length,
    });
  } catch (err) {
    if (err instanceof CreditLimitError) return creditLimitResponse(err);
    return NextResponse.json({ error: 'Could not send the request.' }, { status: 502 });
  }
}
