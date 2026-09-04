/**
 * Teams.
 *   GET  — teams this user captains or co-captains
 *   POST — create a team (enforces the 3-owned-team subscription limit)
 */
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requireCaptain, requireTeam, isError } from '@/lib/captain/server';
import { listCaptainTeams, ownedTeamCount, MAX_TEAMS_PER_CAPTAIN } from '@/lib/captain/access';
import { leagueSpec } from '@/lib/captain/leagues';

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
    source_team_id?: string;
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

  // Seed the line counts from the league the captain picked — JTT plays 2 + 2,
  // USTA Adult 2 + 3 — and write them down rather than leaving them implicit,
  // so changing a league default later can't silently reshape an old team.
  const spec = leagueSpec(body.league_type);

  const { data, error } = await ctx.db
    .from('captain_teams')
    .insert({
      captain_user_id: ctx.userId,
      created_by: ctx.userId,
      name: body.name.trim(),
      league_type: body.league_type || 'usta_adult',
      source_team_id: body.source_team_id?.trim() || null,
      default_singles_courts: spec.singlesCourts,
      default_doubles_courts: spec.doublesCourts,
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
    default_singles_courts?: number;
    default_doubles_courts?: number;
    court_format?: number;
    source_team_id?: string;
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

  // Lines per match. 0 is legitimate on either side (a doubles-only league has
  // no singles), so these are range-checked rather than truthiness-checked.
  for (const key of ['default_singles_courts', 'default_doubles_courts'] as const) {
    const v = body[key];
    if (v === undefined) continue;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0 || n > 8) {
      return NextResponse.json(
        { error: 'Lines per match must be a whole number between 0 and 8.' },
        { status: 400 },
      );
    }
    patch[key] = n;
  }
  // Only when the captain is actually touching the lines. A team that has
  // never set them reads null/null, and treating that as "zero lines" would
  // reject every unrelated save on the same endpoint.
  if (patch.default_singles_courts !== undefined || patch.default_doubles_courts !== undefined) {
    const spec = leagueSpec(ctx.team.league_type);
    const singles = (patch.default_singles_courts ??
      ctx.team.default_singles_courts ??
      spec.singlesCourts) as number;
    const doubles = (patch.default_doubles_courts ??
      ctx.team.default_doubles_courts ??
      spec.doublesCourts) as number;
    if (singles + doubles === 0) {
      return NextResponse.json({ error: 'A match needs at least one line.' }, { status: 400 });
    }
  }

  if (body.source_team_id !== undefined) {
    patch.source_team_id = body.source_team_id.trim() || null;
  }

  if (body.court_format !== undefined) {
    const n = Number(body.court_format);
    if (!Number.isInteger(n) || n < 1 || n > 8) {
      return NextResponse.json(
        { error: 'Court format must be a whole number of courts between 1 and 8.' },
        { status: 400 },
      );
    }
    patch.court_format = n;
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
