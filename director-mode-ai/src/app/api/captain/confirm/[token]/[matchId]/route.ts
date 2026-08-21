/**
 * The two buttons in the lineup email: "I'll be there" and "I can't play".
 *
 * No auth — the player token is the credential. Both actions stamp whichever
 * lineup slot this player occupies and write the matching availability answer,
 * so the lineup builder and the captain's view agree without a second step.
 *
 * A withdrawal does NOT empty the slot. The captain still needs to see who
 * bailed in order to replace them ("find a sub" is a per-slot button), and an
 * auto-emptied court reads as a bug the first time a captain sees it.
 */
import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { sendAll, withdrawalAlertEmail, type MatchInfo } from '@/lib/captain/emails';

type Ctx = { params: { token: string; matchId: string } };

type Body = { action?: 'in' | 'out'; note?: string };

export async function POST(req: Request, { params }: Ctx) {
  const admin = getSupabaseAdmin();

  // Old lineup emails POST with no body at all — that has always meant "I'm in".
  const body = ((await req.json().catch(() => ({}))) || {}) as Body;
  const action: 'in' | 'out' = body.action === 'out' ? 'out' : 'in';
  const note = (body.note || '').trim().slice(0, 500) || null;

  const { data: playerRow } = await admin
    .from('captain_players')
    .select('id, team_id, name')
    .eq('player_token', params.token)
    .maybeSingle();
  const player = playerRow as { id: string; team_id: string; name: string } | null;
  if (!player) return NextResponse.json({ error: 'Link not recognized.' }, { status: 404 });

  // The token proves who you are, not what you may touch. Without this a valid
  // token from any other team could write an availability row against this
  // match — the "out" path doesn't need a lineup slot, so nothing else would
  // have stopped it.
  const { data: matchOwn } = await admin
    .from('captain_matches')
    .select('id')
    .eq('id', params.matchId)
    .eq('team_id', player.team_id)
    .maybeSingle();
  if (!matchOwn) return NextResponse.json({ error: 'Match not found.' }, { status: 404 });

  const { data: lineupRow } = await admin
    .from('captain_lineups')
    .select('id, team_id, match_id, court_number, court_type, player1_id, player2_id')
    .eq('match_id', params.matchId)
    .or(`player1_id.eq.${player.id},player2_id.eq.${player.id}`)
    .maybeSingle();
  const lineup = lineupRow as {
    id: string;
    team_id: string;
    match_id: string;
    court_number: number;
    court_type: string;
    player1_id: string | null;
    player2_id: string | null;
  } | null;

  const inLineup = !!lineup && lineup.team_id === player.team_id;
  const now = new Date().toISOString();

  // Saying "I'm in" only makes sense against a slot. Saying "I can't play" is
  // worth recording either way — a player who was already pulled from the
  // lineup should still be able to take themselves out of the running.
  if (action === 'in' && !inLineup) {
    return NextResponse.json({ error: "You're not in this lineup." }, { status: 400 });
  }

  let court: string | null = null;

  if (inLineup && lineup) {
    const slot = lineup.player1_id === player.id ? 1 : 2;
    court = `${lineup.court_type === 'singles' ? 'Singles' : 'Doubles'} ${lineup.court_number}`;

    const patch =
      action === 'in'
        ? {
            [`player${slot}_confirmed_at`]: now,
            [`player${slot}_declined_at`]: null,
            [`player${slot}_decline_note`]: null,
          }
        : {
            [`player${slot}_declined_at`]: now,
            [`player${slot}_confirmed_at`]: null,
            [`player${slot}_decline_note`]: note,
          };

    const { error } = await admin
      .from('captain_lineups')
      .update({ ...patch, updated_at: now })
      .eq('id', lineup.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await admin.from('captain_availability').upsert(
    {
      team_id: player.team_id,
      match_id: params.matchId,
      player_id: player.id,
      status: action === 'in' ? 'yes' : 'no',
      responded_at: now,
    },
    { onConflict: 'match_id,player_id' },
  );

  // A withdrawal is time-critical for the captain; a confirmation is not.
  if (action === 'out' && inLineup) {
    await alertCaptains(player.team_id, params.matchId, player.name, court, note);
  }

  return NextResponse.json({ ok: true, name: player.name, action, court });
}

/**
 * Email the owner and every co-captain. Never let a send failure fail the
 * player's request: from their side the withdrawal DID happen, and telling them
 * otherwise gets them to tap again or, worse, assume they're still playing.
 */
async function alertCaptains(
  teamId: string,
  matchId: string,
  playerName: string,
  court: string | null,
  note: string | null,
): Promise<void> {
  try {
    const admin = getSupabaseAdmin();
    const [{ data: teamRow }, { data: matchRow }, { data: staffRows }] = await Promise.all([
      admin
        .from('captain_teams')
        .select('id, name, captain_user_id')
        .eq('id', teamId)
        .maybeSingle(),
      admin
        .from('captain_matches')
        .select(
          'id, match_at, is_home, opponent, location, arrival_note, opposing_captain_name, opposing_captain_phone',
        )
        .eq('id', matchId)
        .maybeSingle(),
      admin.from('captain_team_staff').select('user_id').eq('team_id', teamId),
    ]);

    const team = teamRow as { id: string; name: string; captain_user_id: string } | null;
    const m = matchRow as Record<string, unknown> | null;
    if (!team || !m) return;

    const userIds = Array.from(
      new Set(
        [team.captain_user_id, ...((staffRows as { user_id: string }[]) || []).map((s) => s.user_id)].filter(
          Boolean,
        ),
      ),
    );
    const emails = (
      await Promise.all(
        userIds.map(async (id) => (await admin.auth.admin.getUserById(id)).data?.user?.email || null),
      )
    ).filter(Boolean) as string[];
    if (!emails.length) return;

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

    const to = Array.from(new Set(emails));
    const results = await sendAll(
      team.captain_user_id,
      to.map((addr) => withdrawalAlertEmail(addr, team.name, info, playerName, court, note, team.id)),
    );

    // Loud on failure. A withdrawal alert that quietly doesn't arrive is the
    // one failure mode that makes this feature worse than no button at all —
    // the player believes the captain knows, and the captain doesn't.
    const sent = results.filter((r) => r.sent).length;
    if (sent < to.length) {
      console.error(
        `[captain/confirm] withdrawal alert reached ${sent}/${to.length} captains for team ${team.id}`,
        results.filter((r) => !r.sent),
      );
    }
  } catch (err) {
    console.error('[captain/confirm] withdrawal alert failed', err);
  }
}
