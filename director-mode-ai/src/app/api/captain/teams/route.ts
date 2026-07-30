/**
 * Teams.
 *   GET  — teams this user captains or co-captains
 *   POST — create a team (enforces the 3-owned-team subscription limit)
 */
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requireCaptain, requireTeam, isError } from '@/lib/captain/server';
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

/**
 * PATCH — team settings.
 *
 * captaining_style is the switch between "strongest side every week" and
 * "everyone plays the same number of matches", and the lead days decide when
 * the cron emails the availability poll and the lineup.
 */
export async function PATCH(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    team_id?: string;
    captaining_style?: string;
    poll_lead_days?: number;
    lineup_lead_days?: number;
    eligibility_enabled?: boolean;
    min_matches_default?: number;
    min_matches_self_rated?: number;
  };

  const ctx = await requireTeam(body.team_id || '');
  if (isError(ctx)) return ctx.error;

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };

  if (body.captaining_style !== undefined) {
    if (body.captaining_style !== 'play_to_win' && body.captaining_style !== 'equal_play') {
      return NextResponse.json({ error: 'Unknown captaining style.' }, { status: 400 });
    }
    patch.captaining_style = body.captaining_style;
  }

  const days = (v: unknown, label: string) => {
    const n = Number(v);
    if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1 || n > 120) {
      return `${label} must be a whole number of days between 1 and 120.`;
    }
    return null;
  };

  if (body.poll_lead_days !== undefined) {
    const bad = days(body.poll_lead_days, 'Availability poll lead time');
    if (bad) return NextResponse.json({ error: bad }, { status: 400 });
    patch.poll_lead_days = Number(body.poll_lead_days);
  }
  if (body.lineup_lead_days !== undefined) {
    const bad = days(body.lineup_lead_days, 'Lineup lead time');
    if (bad) return NextResponse.json({ error: bad }, { status: 400 });
    patch.lineup_lead_days = Number(body.lineup_lead_days);
  }

  // Checked here as well as in the DB constraint so the captain gets a sentence
  // instead of a raw constraint violation.
  const poll = (patch.poll_lead_days ?? ctx.team.poll_lead_days ?? 21) as number;
  const lineup = (patch.lineup_lead_days ?? ctx.team.lineup_lead_days ?? 7) as number;
  if (lineup > poll) {
    return NextResponse.json(
      { error: `The lineup can't go out (${lineup}d) before you've asked who's available (${poll}d).` },
      { status: 400 },
    );
  }

  if (body.eligibility_enabled !== undefined) patch.eligibility_enabled = !!body.eligibility_enabled;
  if (body.min_matches_default !== undefined) {
    patch.min_matches_default = Number(body.min_matches_default);
  }
  if (body.min_matches_self_rated !== undefined) {
    patch.min_matches_self_rated = Number(body.min_matches_self_rated);
  }

  const { error: upErr } = await ctx.db
    .from('captain_teams')
    .update(patch)
    .eq('id', ctx.teamId);

  if (upErr) {
    // The style/lead-day columns arrive in captain_style_and_lead_times.sql.
    // Say so plainly rather than surfacing "column does not exist".
    if (/column .* does not exist/i.test(upErr.message)) {
      return NextResponse.json(
        { error: 'These settings need the captain_style_and_lead_times migration to be run first.' },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: upErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
