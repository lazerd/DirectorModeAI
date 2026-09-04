/**
 * Matches.
 *   GET    ?team_id=…  — schedule with availability tallies
 *   POST   { team_id, matches[] } — add matches
 *   PATCH  { team_id, match_id, patch } — edit, or reschedule
 *   PATCH  { …, reschedule_to } — move the match AND wipe availability so it
 *          gets re-polled. Old answers were for a different day; keeping them
 *          is how captains end up with a lineup of people who can't come.
 */
import { NextResponse } from 'next/server';
import { requireTeam, isError } from '@/lib/captain/server';
import { defaultCourts } from '@/lib/captain/leagues';

export async function GET(req: Request) {
  const teamId = new URL(req.url).searchParams.get('team_id') || '';
  const ctx = await requireTeam(teamId);
  if (isError(ctx)) return ctx.error;

  const { data: matches } = await ctx.db
    .from('captain_matches')
    .select('*')
    .eq('team_id', teamId)
    .order('match_at');

  const ids = ((matches as { id: string }[]) || []).map((m) => m.id);
  const tally: Record<string, { yes: number; no: number; maybe: number }> = {};
  if (ids.length) {
    const { data: avail } = await ctx.db
      .from('captain_availability')
      .select('match_id, status')
      .in('match_id', ids);
    for (const a of (avail as { match_id: string; status: 'yes' | 'no' | 'maybe' }[]) || []) {
      tally[a.match_id] ??= { yes: 0, no: 0, maybe: 0 };
      tally[a.match_id][a.status] += 1;
    }
  }

  return NextResponse.json({ matches: matches || [], availability: tally });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    team_id?: string;
    matches?: {
      match_at?: string;
      is_home?: boolean;
      opponent?: string;
      location?: string;
      singles_courts?: number;
      doubles_courts?: number;
    }[];
  };
  const ctx = await requireTeam(body.team_id || '');
  if (isError(ctx)) return ctx.error;

  const courts = defaultCourts(ctx.team);

  const rows = (body.matches || [])
    .filter((m) => m.match_at)
    .map((m) => ({
      team_id: ctx.teamId,
      match_at: m.match_at,
      is_home: m.is_home ?? true,
      opponent: m.opponent?.trim() || null,
      location: m.location?.trim() || null,
      // A JTT match is 2 singles + 2 doubles, an adult match 2 + 3 — the
      // default follows the team's league instead of being hardcoded here.
      singles_courts: m.singles_courts ?? courts.singles,
      doubles_courts: m.doubles_courts ?? courts.doubles,
    }));
  if (!rows.length) return NextResponse.json({ error: 'No matches supplied.' }, { status: 400 });

  const { data, error } = await ctx.db.from('captain_matches').insert(rows).select('id, match_at');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, added: data?.length ?? 0, matches: data });
}

export async function PATCH(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    team_id?: string;
    match_id?: string;
    reschedule_to?: string;
    patch?: Record<string, unknown>;
  };
  const ctx = await requireTeam(body.team_id || '');
  if (isError(ctx)) return ctx.error;
  if (!body.match_id) return NextResponse.json({ error: 'match_id required.' }, { status: 400 });

  if (body.reschedule_to) {
    const { error } = await ctx.db
      .from('captain_matches')
      .update({
        match_at: body.reschedule_to,
        status: 'scheduled',
        lineup_email_sent_at: null,
        reminder_sent_at: null,
        nudge_sent_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', body.match_id)
      .eq('team_id', ctx.teamId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // Availability and lineup were for the old date — start clean.
    await ctx.db.from('captain_availability').delete().eq('match_id', body.match_id);
    await ctx.db.from('captain_lineups').delete().eq('match_id', body.match_id);
    await ctx.db
      .from('captain_sub_requests')
      .update({ status: 'cancelled' })
      .eq('match_id', body.match_id)
      .eq('status', 'open');

    return NextResponse.json({ ok: true, rescheduled: true, repoll_needed: true });
  }

  const allowed = [
    'match_at',
    'is_home',
    'opponent',
    'location',
    'arrival_note',
    'opposing_captain_name',
    'opposing_captain_phone',
    'singles_courts',
    'doubles_courts',
    'status',
  ];
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const k of allowed) {
    if (body.patch && k in body.patch) patch[k] = body.patch[k];
  }

  const { error } = await ctx.db
    .from('captain_matches')
    .update(patch)
    .eq('id', body.match_id)
    .eq('team_id', ctx.teamId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
