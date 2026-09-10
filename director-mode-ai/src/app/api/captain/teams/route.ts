/**
 * Teams.
 *   GET  — teams this user captains or co-captains
 *   POST — create a team (enforces the 3-owned-team subscription limit)
 */
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requireCaptain, requireTeam, isError } from '@/lib/captain/server';
import { listCaptainTeams, ownedTeamCount, MAX_TEAMS_PER_CAPTAIN } from '@/lib/captain/access';
import {
  leagueSpec,
  defaultCourts,
  isValidCourtCount,
  COURT_COUNT_ERROR,
} from '@/lib/captain/leagues';
import { matchesNeedingCourtUpdate, type MatchCourts } from '@/lib/captain/courtBackfill';

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
    default_singles_courts?: number;
    default_doubles_courts?: number;
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

  /*
   * Lines per match.
   *
   * The league the captain picked seeds these — JTT plays 4 + 4, USTA Adult
   * 2 + 3 — but the captain's own numbers win, because plenty of teams do not
   * play their league's standard sheet. This used to ignore the form entirely
   * and write the spec every time, so a 4-doubles team was created as 2
   * singles + 3 doubles and generated lineups in that shape until somebody
   * noticed. They are written down either way rather than left implicit, so
   * changing a league default later can't silently reshape an old team.
   */
  const spec = leagueSpec(body.league_type);
  for (const key of ['default_singles_courts', 'default_doubles_courts'] as const) {
    if (body[key] !== undefined && !isValidCourtCount(body[key])) {
      return NextResponse.json({ error: COURT_COUNT_ERROR }, { status: 400 });
    }
  }
  const singlesCourts = body.default_singles_courts ?? spec.singlesCourts;
  const doublesCourts = body.default_doubles_courts ?? spec.doublesCourts;
  if (singlesCourts + doublesCourts === 0) {
    return NextResponse.json({ error: 'A match needs at least one line.' }, { status: 400 });
  }

  /*
   * Attach the team to the captain's club unless they said otherwise.
   *
   * The club is where the venue name and address come from. Three JTT teams
   * were created unlinked, so the season-opener email to twenty rival captains
   * would have named the venue "our club" — the club_id was never asked for
   * anywhere, and a captain has no way to know it is missing until they read
   * their own email. A captain who genuinely runs a team outside any club can
   * still pass club_id explicitly.
   */
  let clubId = body.club_id || null;
  if (!clubId) {
    const { data: membership } = await ctx.db
      .from('cc_club_members')
      .select('club_id')
      .eq('user_id', ctx.userId)
      .limit(1)
      .maybeSingle();
    clubId = (membership as { club_id: string } | null)?.club_id ?? null;
  }

  const { data, error } = await ctx.db
    .from('captain_teams')
    .insert({
      captain_user_id: ctx.userId,
      created_by: ctx.userId,
      name: body.name.trim(),
      league_type: body.league_type || 'usta_adult',
      source_team_id: body.source_team_id?.trim() || null,
      default_singles_courts: singlesCourts,
      default_doubles_courts: doublesCourts,
      level: body.level || null,
      club_id: clubId,
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
    name?: string;
    level?: string;
    captaining_style?: string;
    poll_lead_days?: number;
    lineup_lead_days?: number;
    eligibility_enabled?: boolean;
    min_matches_default?: number;
    min_matches_self_rated?: number;
    default_singles_courts?: number;
    default_doubles_courts?: number;
    /**
     * Also restamp upcoming matches with the new line counts. Opt-in: the
     * captain is shown how many would change and asks for it, because a match
     * already on the schedule is one people may have been emailed about.
     */
    apply_courts_to_upcoming?: boolean;
    court_format?: number;
    /** How a match is decided: 'courts' won, or 'topdog' points. */
    match_scoring?: string;
    source_team_id?: string;
  };

  const ctx = await requireTeam(body.team_id || '');
  if (isError(ctx)) return ctx.error;

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };

  if (body.name !== undefined) {
    const name = body.name.trim();
    if (!name) return NextResponse.json({ error: 'A team name is required.' }, { status: 400 });
    patch.name = name;
  }
  // Blank is allowed: a captain who typed the division wrong should be able to
  // clear it, not be stuck with it.
  if (body.level !== undefined) patch.level = body.level.trim() || null;

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
    if (!isValidCourtCount(v)) {
      return NextResponse.json({ error: COURT_COUNT_ERROR }, { status: 400 });
    }
    patch[key] = Number(v);
  }
  // Only when the captain is actually touching the lines. A team that has
  // never set them reads null/null, and treating that as "zero lines" would
  // reject every unrelated save on the same endpoint.
  let newCourts: { singles: number; doubles: number } | null = null;
  if (patch.default_singles_courts !== undefined || patch.default_doubles_courts !== undefined) {
    newCourts = defaultCourts({
      league_type: ctx.team.league_type,
      default_singles_courts: (patch.default_singles_courts ??
        ctx.team.default_singles_courts) as number | null,
      default_doubles_courts: (patch.default_doubles_courts ??
        ctx.team.default_doubles_courts) as number | null,
    });
    if (newCourts.singles + newCourts.doubles === 0) {
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

  if (body.match_scoring !== undefined) {
    if (body.match_scoring !== 'courts' && body.match_scoring !== 'topdog') {
      return NextResponse.json({ error: 'Unknown match scoring.' }, { status: 400 });
    }
    patch.match_scoring = body.match_scoring;
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

  /*
   * The new default only ever applied to matches created after it, because a
   * match keeps its own copy of the counts and the lineup generator reads that
   * copy. Setting the lines after importing the schedule — the usual order —
   * therefore changed nothing a captain could see, and lineups kept coming out
   * in the league's default shape.
   *
   * So: say how many upcoming matches still disagree, and restamp them when
   * the captain asks. Matches in the past are history and are never touched;
   * matches with a saved lineup are left for the captain to change one at a
   * time, since their courts may already have gone out to the players.
   */
  if (newCourts) {
    const courts = newCourts;
    const { data: upcoming } = await ctx.db
      .from('captain_matches')
      .select('id, singles_courts, doubles_courts')
      .eq('team_id', ctx.teamId)
      .gte('match_at', new Date().toISOString());

    const rows = (upcoming || []) as MatchCourts[];
    const withLineups = rows.length
      ? await ctx.db
          .from('captain_lineups')
          .select('match_id')
          .in(
            'match_id',
            rows.map((m) => m.id),
          )
      : { data: [] };
    const locked = ((withLineups.data || []) as { match_id: string }[]).map((r) => r.match_id);
    const stale = matchesNeedingCourtUpdate(rows, locked, courts);

    if (stale.length && body.apply_courts_to_upcoming) {
      const { error: bfErr } = await ctx.db
        .from('captain_matches')
        .update({ singles_courts: courts.singles, doubles_courts: courts.doubles })
        .in('id', stale);
      // The team default did save. Report the backfill failure without
      // pretending the whole call failed and inviting a pointless retry.
      if (bfErr) {
        return NextResponse.json({
          ok: true,
          courts_applied: 0,
          courts_stale: stale.length,
          warning: `Saved, but the ${stale.length} scheduled ${
            stale.length === 1 ? 'match' : 'matches'
          } could not be updated: ${bfErr.message}`,
        });
      }
      return NextResponse.json({ ok: true, courts_applied: stale.length, courts_stale: 0 });
    }

    return NextResponse.json({ ok: true, courts_applied: 0, courts_stale: stale.length });
  }

  return NextResponse.json({ ok: true });
}
