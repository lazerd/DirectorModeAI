/**
 * Record a confirmation the captain collected off-app.
 *   POST { team_id, match_id, player_id, state: 'in' | 'out' | 'clear', note? }
 *
 * Players confirm by text, in the parking lot, at the club — anywhere but the
 * button in the email. Without this the roll-call keeps saying "no answer yet"
 * for someone the captain has already spoken to, so the one screen that is
 * supposed to tell them who is missing stops being trustworthy and they go back
 * to a paper list.
 *
 * The answer is stamped as coming from the captain, not the player, so the two
 * kinds of yes stay distinguishable — a captain chasing a bail wants to know
 * whether a player tapped it themselves.
 */
import { NextResponse } from 'next/server';
import { requireTeam, isError } from '@/lib/captain/server';

type Body = {
  team_id?: string;
  match_id?: string;
  player_id?: string;
  state?: 'in' | 'out' | 'clear';
  note?: string;
};

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Body;
  const state = body.state;

  if (!body.team_id || !body.match_id || !body.player_id) {
    return NextResponse.json(
      { error: 'team_id, match_id and player_id are required.' },
      { status: 400 },
    );
  }
  if (state !== 'in' && state !== 'out' && state !== 'clear') {
    return NextResponse.json({ error: "state must be 'in', 'out' or 'clear'." }, { status: 400 });
  }

  const ctx = await requireTeam(body.team_id);
  if (isError(ctx)) return ctx.error;
  const { db, teamId } = ctx;

  // The match has to be this team's, and so does the player. requireTeam has
  // already proved the captain owns the team; these two checks close the gap
  // between "my team" and "this row".
  const [{ data: match }, { data: player }] = await Promise.all([
    db.from('captain_matches').select('id').eq('id', body.match_id).eq('team_id', teamId).maybeSingle(),
    db
      .from('captain_players')
      .select('id, name')
      .eq('id', body.player_id)
      .eq('team_id', teamId)
      .maybeSingle(),
  ]);
  if (!match) return NextResponse.json({ error: 'Match not found.' }, { status: 404 });
  if (!player) return NextResponse.json({ error: 'Player not on this team.' }, { status: 404 });

  const name = (player as { name: string }).name;
  const now = new Date().toISOString();
  const note = (body.note || '').trim().slice(0, 500) || null;

  const { data: lineupRows } = await db
    .from('captain_lineups')
    .select('id, court_number, court_type, player1_id, player2_id')
    .eq('match_id', body.match_id)
    .eq('team_id', teamId);

  const rows =
    (lineupRows as {
      id: string;
      court_number: number;
      court_type: string;
      player1_id: string | null;
      player2_id: string | null;
    }[]) || [];

  const row = rows.find(
    (l) => l.player1_id === body.player_id || l.player2_id === body.player_id,
  );

  let court: string | null = null;

  if (row) {
    const slot = row.player1_id === body.player_id ? 1 : 2;
    court = `${row.court_type === 'singles' ? 'Singles' : 'Doubles'} ${row.court_number}`;

    const patch: Record<string, unknown> =
      state === 'in'
        ? {
            [`player${slot}_confirmed_at`]: now,
            [`player${slot}_confirmed_source`]: 'captain',
            [`player${slot}_declined_at`]: null,
            [`player${slot}_decline_note`]: null,
          }
        : state === 'out'
          ? {
              [`player${slot}_declined_at`]: now,
              [`player${slot}_confirmed_at`]: null,
              [`player${slot}_confirmed_source`]: null,
              [`player${slot}_decline_note`]: note,
            }
          : {
              // Back to "no answer yet" — for the mis-tap.
              [`player${slot}_confirmed_at`]: null,
              [`player${slot}_confirmed_source`]: null,
              [`player${slot}_declined_at`]: null,
              [`player${slot}_decline_note`]: null,
            };

    const { error } = await db
      .from('captain_lineups')
      .update({ ...patch, updated_at: now })
      .eq('id', row.id)
      .eq('team_id', teamId);
    if (error) {
      if (/column .* does not exist/i.test(error.message)) {
        return NextResponse.json(
          { error: 'This needs the captain_confirm_source migration to be run first.' },
          { status: 409 },
        );
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  } else if (state === 'in') {
    // Confirming somebody who isn't on a court would leave the captain with a
    // green tick against nothing. Say so rather than writing a fact about a
    // slot that doesn't exist.
    return NextResponse.json(
      { error: `${name} isn't in this lineup — put her on a court first.` },
      { status: 400 },
    );
  }

  // Keep availability in step, exactly as the player's own tap does. 'clear'
  // removes the answer entirely so the poll counts stop claiming one.
  if (state === 'clear') {
    await db
      .from('captain_availability')
      .delete()
      .eq('match_id', body.match_id)
      .eq('player_id', body.player_id);
  } else {
    await db.from('captain_availability').upsert(
      {
        team_id: teamId,
        match_id: body.match_id,
        player_id: body.player_id,
        status: state === 'in' ? 'yes' : 'no',
        responded_at: now,
      },
      { onConflict: 'match_id,player_id' },
    );
  }

  return NextResponse.json({ ok: true, name, court, state });
}
