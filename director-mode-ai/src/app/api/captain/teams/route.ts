/**
 * Teams.
 *   GET  — teams this user captains or co-captains
 *   POST — create a team (enforces the 3-owned-team subscription limit)
 */
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requireCaptain, isError } from '@/lib/captain/server';
import { listCaptainTeams, ownedTeamCount, MAX_TEAMS_PER_CAPTAIN } from '@/lib/captain/access';

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
  return NextResponse.json({ teams: await listCaptainTeams(user.id) });
}

export async function POST(req: Request) {
  const ctx = await requireCaptain();
  if (isError(ctx)) return ctx.error;

  const body = (await req.json().catch(() => ({}))) as {
    name?: string;
    league_type?: string;
    level?: string;
    club_id?: string;
    season_start?: string;
    season_end?: string;
    eligibility_enabled?: boolean;
    min_matches_default?: number;
    min_matches_self_rated?: number;
  };
  if (!body.name?.trim()) {
    return NextResponse.json({ error: 'Team name is required.' }, { status: 400 });
  }

  const owned = await ownedTeamCount(ctx.userId);
  if (owned >= MAX_TEAMS_PER_CAPTAIN) {
    return NextResponse.json(
      {
        error: `Your subscription covers ${MAX_TEAMS_PER_CAPTAIN} teams. Archive one to add another.`,
      },
      { status: 400 },
    );
  }

  const { data, error } = await ctx.db
    .from('captain_teams')
    .insert({
      captain_user_id: ctx.userId,
      created_by: ctx.userId,
      name: body.name.trim(),
      league_type: body.league_type || 'usta_adult',
      level: body.level || null,
      club_id: body.club_id || null,
      season_start: body.season_start || null,
      season_end: body.season_end || null,
      eligibility_enabled: !!body.eligibility_enabled,
      min_matches_default: body.min_matches_default ?? 2,
      min_matches_self_rated: body.min_matches_self_rated ?? 3,
    })
    .select('*')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, team: data });
}
