/**
 * Who gets told when a pick lands.
 *
 * Two people care about a draft pick the instant it happens: the player who was
 * just taken, and the captain who is now on the clock. Both are told here, from
 * one place, so a pick made by a captain, by the commissioner, or by the
 * auto-pick clock all notify identically — three call sites drifting apart is
 * how "I never got told I was up" happens.
 *
 * Fire-and-forget on purpose. The pick is already committed; an unreachable
 * inbox must not turn a successful pick into an error.
 */

import 'server-only';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { sendDrafted, sendOnTheClock } from './emails';
import type { PtlDraftState } from './server';

export async function notifyAfterPick(opts: {
  state: PtlDraftState;
  entryId: string;
  teamId: string;
  origin: string;
}): Promise<void> {
  const { state, entryId, teamId, origin } = opts;
  const db = getSupabaseAdmin();

  try {
    const { data: season } = await db
      .from('ptl_seasons')
      .select('id, name, slug, is_demo, pick_seconds')
      .eq('id', state.season_id)
      .maybeSingle();
    if (!season) return;
    const s = season as any;

    // A demo never mails anyone. Checked once, here, rather than trusted to
    // each send — a committee member clicking through the demo draft must not
    // put mail in a stranger's inbox.
    if (s.is_demo) return;

    const [{ data: entry }, { data: team }] = await Promise.all([
      db.from('ptl_entries').select('name, email').eq('id', entryId).maybeSingle(),
      db.from('ptl_teams').select('name, captain_name').eq('id', teamId).maybeSingle(),
    ]);

    const base = { seasonIsDemo: false, origin };

    if (entry && (entry as any).email) {
      await sendDrafted(
        { ...base, to: (entry as any).email },
        {
          playerName: (entry as any).name,
          teamName: (team as any)?.name ?? 'your team',
          captainName: (team as any)?.captain_name ?? null,
          seasonName: s.name,
          seasonSlug: s.slug,
          roundNo: state.current_round_no ?? 1,
        },
      );
    }

    // Nobody is next when the draft has just completed.
    if (!state.on_the_clock_team_id || state.status !== 'live') return;

    const { data: next } = await db
      .from('ptl_teams')
      .select('name, captain_email, team_token')
      .eq('id', state.on_the_clock_team_id)
      .maybeSingle();
    if (!next || !(next as any).captain_email) return;

    await sendOnTheClock(
      { ...base, to: (next as any).captain_email },
      {
        teamName: (next as any).name,
        token: (next as any).team_token,
        pickNo: state.current_pick_no ?? 0,
        roundNo: state.current_round_no ?? 1,
        seconds: s.pick_seconds,
      },
    );
  } catch (err) {
    console.error('[ptl] post-pick notify failed', err);
  }
}

/** The origin a link in an email should point at, from the request. */
export function originFrom(request: Request): string {
  try {
    return new URL(request.url).origin;
  } catch {
    return process.env.NEXT_PUBLIC_APP_URL || '';
  }
}
