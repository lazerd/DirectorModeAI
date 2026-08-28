/**
 * "I'll be there" / "I can't play", shared by every entry point.
 *
 * Three callers reach this: the one-tap GET from the lineup email, the form
 * POST from the confirm page, and the JSON POST kept working for lineup emails
 * already sitting in inboxes. They must not drift apart.
 */
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { sendAll, withdrawalAlertEmail, type MatchInfo } from './emails';

export type Answer = 'in' | 'out';

export type AnswerResult =
  | { ok: true; name: string; action: Answer; court: string | null }
  | { ok: false; status: number; error: string };

export async function applyAnswer(
  token: string,
  matchId: string,
  action: Answer,
  rawNote?: string | null,
): Promise<AnswerResult> {
  const admin = getSupabaseAdmin();
  const note = (rawNote || '').trim().slice(0, 500) || null;

  const { data: playerRow } = await admin
    .from('captain_players')
    .select('id, team_id, name')
    .eq('player_token', token)
    .maybeSingle();
  const player = playerRow as { id: string; team_id: string; name: string } | null;
  if (!player) return { ok: false, status: 404, error: 'Link not recognized.' };

  // The token proves who you are, not what you may touch. Without this a valid
  // token from any other team could write an availability row against this
  // match — the "out" path doesn't need a lineup slot, so nothing else would
  // have stopped it.
  const { data: matchOwn } = await admin
    .from('captain_matches')
    .select('id')
    .eq('id', matchId)
    .eq('team_id', player.team_id)
    .maybeSingle();
  if (!matchOwn) return { ok: false, status: 404, error: 'Match not found.' };

  const { data: lineupRow } = await admin
    .from('captain_lineups')
    .select('id, team_id, match_id, court_number, court_type, player1_id, player2_id')
    .eq('match_id', matchId)
    .or(`player1_id.eq.${player.id},player2_id.eq.${player.id}`)
    .maybeSingle();
  const lineup = lineupRow as {
    id: string;
    team_id: string;
    court_number: number;
    court_type: string;
    player1_id: string | null;
    player2_id: string | null;
  } | null;

  const inLineup = !!lineup && lineup.team_id === player.team_id;
  const now = new Date().toISOString();

  // Saying "I'm in" only makes sense against a slot. Saying "I can't play" is
  // worth recording either way — a player already pulled from the lineup should
  // still be able to take themselves out of the running.
  if (action === 'in' && !inLineup) {
    return { ok: false, status: 400, error: "You're not in this lineup." };
  }

  let court: string | null = null;

  if (inLineup && lineup) {
    const slot = lineup.player1_id === player.id ? 1 : 2;
    court = `${lineup.court_type === 'singles' ? 'Singles' : 'Doubles'} ${lineup.court_number}`;

    const patch =
      action === 'in'
        ? {
            [`player${slot}_confirmed_at`]: now,
            // The player tapped it themselves — the strongest kind of yes, and
            // the captain's roll-call says so.
            [`player${slot}_confirmed_source`]: 'player',
            [`player${slot}_declined_at`]: null,
            [`player${slot}_decline_note`]: null,
          }
        : {
            [`player${slot}_declined_at`]: now,
            [`player${slot}_confirmed_at`]: null,
            [`player${slot}_confirmed_source`]: null,
            [`player${slot}_decline_note`]: note,
          };

    const { error } = await admin
      .from('captain_lineups')
      .update({ ...patch, updated_at: now })
      .eq('id', lineup.id);
    if (error) return { ok: false, status: 500, error: error.message };
  }

  await admin.from('captain_availability').upsert(
    {
      team_id: player.team_id,
      match_id: matchId,
      player_id: player.id,
      status: action === 'in' ? 'yes' : 'no',
      responded_at: now,
    },
    { onConflict: 'match_id,player_id' },
  );

  // A withdrawal is time-critical for the captain; a confirmation is not.
  if (action === 'out' && inLineup) {
    await alertCaptains(player.team_id, matchId, player.name, court, note);
  }

  return { ok: true, name: player.name, action, court };
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
      admin.from('captain_teams').select('id, name, captain_user_id').eq('id', teamId).maybeSingle(),
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
        [
          team.captain_user_id,
          ...((staffRows as { user_id: string }[]) || []).map((s) => s.user_id),
        ].filter(Boolean),
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

    // Loud on failure. A withdrawal alert that quietly doesn't arrive is the one
    // failure mode that makes this feature worse than no button at all — the
    // player believes the captain knows, and the captain doesn't.
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

/**
 * Is this a person tapping a link, or a mail-security scanner fetching every
 * URL in the message?
 *
 * Every current browser sends `Sec-Fetch-Mode: navigate` on a top-level
 * navigation; link scanners fetch with a plain HTTP client and do not. This is
 * the price of one-tap confirm from an email: the tap has to be a GET, and a
 * GET that changes data must not fire for a robot. When the header is missing
 * we do NOT record — the page still renders with a working button, so a genuine
 * old client loses one tap instead of everyone losing the truth.
 */
export function isRealNavigation(req: Request): boolean {
  return req.headers.get('sec-fetch-mode') === 'navigate';
}
