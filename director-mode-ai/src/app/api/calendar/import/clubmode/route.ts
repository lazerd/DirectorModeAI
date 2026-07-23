import { NextResponse } from 'next/server';
import { requireCalendarContext, isAuthError } from '@/lib/calendar/server';
import { commitConstraints } from '@/lib/calendar/importCommit';
import { toISO } from '@/lib/calendar/dates';

// POST /api/calendar/import/clubmode — sweep the club's own ClubMode data into
// constraints. No upload: the planner should already know about the JTT match
// days, tournaments, and court bookings the club created in this very app.
//
// This is the import a director never thinks to ask for and immediately relies
// on, because it's the source of most real double-bookings.
//
// { mode: 'parse' } previews; { mode: 'commit', rows } writes.
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const ctx = await requireCalendarContext({ requirePro: true });
  if (isAuthError(ctx)) return ctx.error;

  const body = await req.json().catch(() => null);
  const year = Number(body?.year) || new Date().getUTCFullYear();
  const from = toISO(year, 1, 1);
  const to = toISO(year, 12, 31);

  if (String(body?.mode) === 'commit') {
    const rows: any[] = Array.isArray(body?.rows) ? body.rows : [];
    if (rows.length === 0) return NextResponse.json({ error: 'Nothing to import.' }, { status: 400 });

    const result = await commitConstraints({
      db: ctx.db,
      clubId: ctx.club.id,
      userId: ctx.user.id,
      planId: body?.planId ? String(body.planId) : null,
      kind: 'clubmode',
      label: `ClubMode events ${year}`,
      filename: null,
      rows,
      source: 'clubmode',
    });

    if ('error' in result) return NextResponse.json({ error: result.error }, { status: 400 });
    return NextResponse.json(result);
  }

  // Which ClubMode dates are already spoken for?
  //
  // `events` is scoped by user_id as well as club_id: club_id was backfilled
  // later and older rows may still be null, so a club-only filter would miss
  // exactly the historical events a director most wants protected.
  const [{ data: events }, { data: leagues }] = await Promise.all([
    ctx.db
      .from('events')
      .select('id, name, event_date, end_date, match_format')
      .or(`club_id.eq.${ctx.club.id},user_id.eq.${ctx.user.id}`)
      .gte('event_date', from)
      .lte('event_date', to)
      .order('event_date', { ascending: true })
      .limit(500),
    ctx.db
      .from('leagues')
      .select('id, name')
      .eq('director_id', ctx.user.id)
      .limit(200),
  ]);

  // Match days hang off divisions, not leagues, so walk
  // leagues → league_divisions → league_team_matchups to stay scoped to
  // leagues this director actually runs.
  const leagueNames = new Map<string, string>(
    ((leagues ?? []) as any[]).map((l) => [l.id, l.name]),
  );

  const divisionLeague = new Map<string, string>();
  if (leagueNames.size > 0) {
    const { data: divisions } = await ctx.db
      .from('league_divisions')
      .select('id, league_id')
      .in('league_id', [...leagueNames.keys()])
      .limit(500);
    for (const d of (divisions ?? []) as any[]) divisionLeague.set(d.id, d.league_id);
  }

  const matchups = divisionLeague.size > 0
    ? (await ctx.db
        .from('league_team_matchups')
        .select('id, match_date, division_id')
        .in('division_id', [...divisionLeague.keys()])
        .gte('match_date', from)
        .lte('match_date', to)
        .order('match_date', { ascending: true })
        .limit(1000)).data
    : [];

  const proposed: any[] = [];

  for (const e of (events ?? []) as any[]) {
    if (!e.event_date) continue;
    proposed.push({
      title: e.name || 'Club event',
      starts_on: e.event_date,
      ends_on: e.end_date && e.end_date >= e.event_date ? e.end_date : e.event_date,
      impact: 'blocking',
      audience_tags: [],
      note: 'An event already scheduled in ClubMode.',
      ignore: false,
      _origin: 'event',
    });
  }

  for (const m of (matchups ?? []) as any[]) {
    const leagueId = divisionLeague.get(m.division_id);
    if (!m.match_date || !leagueId) continue;
    proposed.push({
      title: `${leagueNames.get(leagueId)} match day`,
      starts_on: m.match_date,
      ends_on: m.match_date,
      impact: 'blocking',
      audience_tags: [],
      note: 'League match day — the courts are committed.',
      ignore: false,
      _origin: 'league',
    });
  }

  // Collapse duplicate league match days: several age divisions play the same
  // Saturday and they'd otherwise import as three identical constraints.
  const seen = new Set<string>();
  const deduped = proposed.filter((p) => {
    const key = `${p.title}|${p.starts_on}|${p.ends_on}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((a, b) => (a.starts_on < b.starts_on ? -1 : 1));

  return NextResponse.json({
    proposed: deduped,
    total: deduped.length,
    label: `ClubMode events ${year}`,
  });
}
