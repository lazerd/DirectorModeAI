/**
 * The demo's front door to the draft room.
 *
 * Sends the visitor into whichever team is on the clock RIGHT NOW.
 *
 * Why this exists: a draft drifts. The seeded demo parks a particular team on
 * the clock, but every visitor who leaves the board open lets a pick clock
 * expire, which auto-picks and moves the turn on. So a fixed captain link that
 * was perfect on Tuesday puts Thursday's visitor in a room where the Draft
 * buttons are all greyed out — and "it's not your turn" is the single worst
 * first impression this product can make. Resolving the team at click time
 * means the link is correct forever, however long it has been sitting in
 * someone's inbox.
 *
 * SAFETY: demo seasons only, enforced below. A team token is a captain's
 * credential — anyone holding it can draft as that team — so an endpoint that
 * hands one out has to be incapable of doing it for a real season. The query
 * filters on is_demo rather than checking it afterwards, so a bug that loses
 * the check returns nothing instead of leaking.
 */

import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { getDraftState } from '@/lib/ptl/server';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const here = new URL(request.url);
  const slug = here.searchParams.get('season') || 'demo-draft';
  /*
   * Redirect within whatever host the visitor actually arrived on, rather than
   * the app's configured APP_URL. Once PTL is served from ptl.clubmode.ai, an
   * APP_URL redirect would throw a visitor off the league's own domain and onto
   * ClubMode's — visible, confusing, and exactly the seam this product is meant
   * not to have.
   */
  const to = (path: string) => NextResponse.redirect(new URL(path, here.origin));
  const db = getSupabaseAdmin();

  const { data: season } = await db
    .from('ptl_seasons')
    .select('id, slug, is_demo')
    .eq('slug', slug)
    .eq('is_demo', true) // the whole safety of this route
    .maybeSingle();

  if (!season) return to('/ptl');

  const { data: draft } = await db
    .from('ptl_drafts')
    .select('id')
    .eq('season_id', (season as any).id)
    .maybeSingle();

  if (!draft) return to(`/ptl?season=${slug}`);

  const state = await getDraftState((draft as any).id);

  // Draft finished, or not started — the board is the honest thing to show.
  if (!state?.on_the_clock_team_id) return to(`/ptl/draft/board?season=${slug}`);

  const { data: team } = await db
    .from('ptl_teams')
    .select('team_token')
    .eq('id', state.on_the_clock_team_id)
    .maybeSingle();

  if (!team) return to(`/ptl/draft/board?season=${slug}`);

  return to(`/ptl/draft/${(team as any).team_token}`);
}
