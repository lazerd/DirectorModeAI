/**
 * The draft snapshot every live surface refetches.
 *
 * The realtime subscription on ptl_draft_picks is only a nudge — it says
 * "something changed", not "here is the new world". The rows the draft room
 * actually needs (player names, the remaining pool, roster counts) live in
 * tables anon cannot read, so the client debounces the nudge and refetches
 * through here. Same shape as LiveBracketRefresher: server does the first
 * paint, the socket only triggers the next one.
 */

import { NextResponse } from 'next/server';
import {
  getAvailablePool,
  getDraftState,
  getPicks,
  getQueue,
  getTeamByToken,
  getTeams,
} from '@/lib/ptl/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { clampText } from '@/lib/ptl/guard';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const token = clampText(params.get('token'), 128);
  const draftId = clampText(params.get('draftId'), 64);

  // A captain identifies with their token and gets their private queue back
  // with everything else; the board passes a draft id and gets the public view.
  let resolvedDraftId = draftId;
  let teamId: string | null = null;
  let seasonId: string | null = null;

  if (token) {
    const resolved = await getTeamByToken(token);
    if (!resolved?.draftId) {
      return NextResponse.json({ error: 'That draft link is not valid.' }, { status: 404 });
    }
    resolvedDraftId = resolved.draftId;
    teamId = resolved.team.id;
    seasonId = resolved.team.season_id;
  }

  if (!resolvedDraftId) return NextResponse.json({ error: 'Missing draft.' }, { status: 400 });

  const state = await getDraftState(resolvedDraftId);
  if (!state) return NextResponse.json({ error: 'Draft not found.' }, { status: 404 });
  seasonId = seasonId || state.season_id;

  /*
   * A token identifies a captain, who needs the pool to draft from. A bare
   * draft id is the public board on the wall, which shows picks and nothing
   * else — so it does not get the pool. That keeps a hundred enrolled players'
   * names and ratings off an unauthenticated endpoint, and keeps the payload
   * small on a screen that refetches all evening.
   */
  const [picks, teams, pool] = await Promise.all([
    getPicks(resolvedDraftId),
    getTeams(seasonId),
    teamId ? getAvailablePool(seasonId) : Promise.resolve([]),
  ]);

  /*
   * What this captain's roster still owes. Sent with the snapshot so the draft
   * room can say "you still need 2 women" and grey out the picks that would
   * break it, rather than letting someone tap a name and bounce off an error.
   */
  let needs = null;
  if (teamId) {
    const { data } = await getSupabaseAdmin().rpc('ptl_roster_needs', { p_team: teamId });
    needs = data ?? null;
  }

  return NextResponse.json({
    state,
    needs,
    picks,
    teams: teams.map((t) => ({
      id: t.id,
      name: t.name,
      shortCode: t.short_code,
      color: t.color,
      draftSlot: t.draft_slot,
      captainName: t.captain_name,
    })),
    pool,
    // Only ever the requesting captain's own queue.
    queue: teamId ? await getQueue(resolvedDraftId, teamId) : [],
    you: teamId,
  });
}
