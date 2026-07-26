/**
 * Availability poll.
 *   POST { team_id, match_id, only_missing? } — email the roster asking if
 *   they can play. `only_missing` re-asks just the people who never answered.
 */
import { NextResponse } from 'next/server';
import { requireTeam, isError } from '@/lib/captain/server';
import { availabilityEmail, nudgeEmail, sendAll, type MatchInfo } from '@/lib/captain/emails';
import { CreditLimitError } from '@/lib/billing';
import { creditLimitResponse } from '@/lib/email';

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    team_id?: string;
    match_id?: string;
    only_missing?: boolean;
  };
  if (!body.team_id || !body.match_id) {
    return NextResponse.json({ error: 'team_id and match_id are required.' }, { status: 400 });
  }

  const ctx = await requireTeam(body.team_id);
  if (isError(ctx)) return ctx.error;
  const { db, team, teamId } = ctx;

  const { data: matchRow } = await db
    .from('captain_matches')
    .select('*')
    .eq('id', body.match_id)
    .eq('team_id', teamId)
    .maybeSingle();
  if (!matchRow) return NextResponse.json({ error: 'Match not found.' }, { status: 404 });
  const match = matchRow as Record<string, unknown>;

  const { data: players } = await db
    .from('captain_players')
    .select('id, name, email, player_token, is_sub')
    .eq('team_id', teamId)
    .eq('active', true)
    .eq('is_sub', false);

  let roster =
    (players as { id: string; name: string; email: string | null; player_token: string }[]) || [];
  roster = roster.filter((p) => !!p.email);

  if (body.only_missing) {
    const { data: answered } = await db
      .from('captain_availability')
      .select('player_id')
      .eq('match_id', body.match_id);
    const done = new Set(((answered as { player_id: string }[]) || []).map((a) => a.player_id));
    roster = roster.filter((p) => !done.has(p.id));
  }

  if (!roster.length) return NextResponse.json({ ok: true, sent: 0 });

  const info: MatchInfo = {
    id: match.id as string,
    matchAt: match.match_at as string,
    isHome: match.is_home as boolean,
    opponent: (match.opponent as string) || null,
    location: (match.location as string) || null,
  };

  const build = body.only_missing ? nudgeEmail : availabilityEmail;
  const payloads = roster.map((p) =>
    build(team.name, info, {
      playerId: p.id,
      name: p.name,
      email: p.email as string,
      token: p.player_token,
    }),
  );

  try {
    const results = await sendAll(ctx.userId, payloads);
    if (body.only_missing) {
      await db
        .from('captain_matches')
        .update({ nudge_sent_at: new Date().toISOString() })
        .eq('id', body.match_id);
    }
    return NextResponse.json({ ok: true, sent: results.filter((r) => r.sent).length });
  } catch (err) {
    if (err instanceof CreditLimitError) return creditLimitResponse(err);
    return NextResponse.json({ error: 'Could not send the poll.' }, { status: 502 });
  }
}
