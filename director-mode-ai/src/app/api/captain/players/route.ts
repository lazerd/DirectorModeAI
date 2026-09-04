/**
 * Roster + subs.
 *   GET    ?team_id=…            — roster with prefs, never-pairs, eligibility
 *   POST   { team_id, players[] } — upsert roster rows
 *   PATCH  { team_id, player_id, … } — edit one player (incl. prefs)
 *   DELETE ?team_id=…&player_id=… — deactivate (never hard-delete: results reference them)
 */
import { NextResponse } from 'next/server';
import { requireTeam, isError, playedCounts, rulesFor } from '@/lib/captain/server';
import { isNotAName, MAX_ROSTER_ROWS } from '@/lib/captain/rosterPaste';
import { eligibilityReport, type RatingType } from '@/lib/captain/lineup';

export async function GET(req: Request) {
  const teamId = new URL(req.url).searchParams.get('team_id') || '';
  const ctx = await requireTeam(teamId);
  if (isError(ctx)) return ctx.error;
  const { db, team } = ctx;

  const [{ data: players }, { data: prefs }, { data: never }, { data: upcoming }] =
    await Promise.all([
      db
        .from('captain_players')
        .select(
          'id, name, email, phone, rating, wtn, wtn_doubles, rating_type, gender, return_side, court_limit, is_sub, notes, active',
        )
        .eq('team_id', teamId)
        .eq('active', true)
        .order('is_sub')
        .order('name'),
      db.from('captain_partner_prefs').select('player_id, preferred_player_id, rank').eq('team_id', teamId),
      db.from('captain_never_pair').select('id, player_a_id, player_b_id').eq('team_id', teamId),
      db
        .from('captain_matches')
        .select('id')
        .eq('team_id', teamId)
        .eq('status', 'scheduled')
        .gte('match_at', new Date().toISOString()),
    ]);

  const roster =
    (players as { id: string; name: string; is_sub: boolean; rating_type: RatingType }[]) || [];
  const counts = await playedCounts(db, teamId);
  const eligibility = eligibilityReport({
    players: roster
      .filter((p) => !p.is_sub)
      .map((p) => ({ id: p.id, name: p.name, ratingType: p.rating_type })),
    playedByPlayer: counts,
    rules: rulesFor(team),
    matchesRemaining: ((upcoming as unknown[]) || []).length,
  });

  return NextResponse.json({
    players,
    partnerPrefs: prefs || [],
    neverPairs: never || [],
    eligibility,
  });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    team_id?: string;
    players?: {
      name?: string;
      email?: string;
      rating?: number | null;
      gender?: 'M' | 'F' | null;
      is_sub?: boolean;
    }[];
  };
  const ctx = await requireTeam(body.team_id || '');
  if (isError(ctx)) return ctx.error;

  const supplied = (body.players || []).filter((p) => p.name?.trim());

  // A captain pasting a whole league page is the documented import gesture, so
  // this endpoint has to survive it. On 2026-09-03 one paste put 240 nav labels
  // on a team that has 29 players. The UI previews and unticks; these three
  // guards mean a stale client or a direct POST cannot do it either.
  if (supplied.length > MAX_ROSTER_ROWS) {
    return NextResponse.json(
      {
        error: `That's ${supplied.length} players in one go — the limit is ${MAX_ROSTER_ROWS}. ` +
          `If you pasted a whole page, paste just the roster.`,
      },
      { status: 400 },
    );
  }

  const rejected: { name: string; reason: string }[] = [];
  const kept = supplied.filter((p) => {
    const reason = isNotAName(p.name!);
    if (reason) rejected.push({ name: p.name!.trim().slice(0, 60), reason });
    return !reason;
  });

  // Skip anyone already on the roster, the way /api/captain/import does, so a
  // re-paste or a double-click tops up rather than duplicating the team.
  const { data: existing } = await ctx.db
    .from('captain_players')
    .select('name')
    .eq('team_id', ctx.teamId);
  const have = new Set(
    ((existing as { name: string }[]) || []).map((p) => p.name.trim().toLowerCase()),
  );

  const seen = new Set<string>();
  const rows = kept
    .filter((p) => {
      const key = p.name!.trim().toLowerCase();
      if (have.has(key) || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((p) => ({
      team_id: ctx.teamId,
      name: p.name!.trim(),
      email: p.email?.trim() || null,
      rating: p.rating ?? null,
      gender: p.gender ?? null,
      is_sub: !!p.is_sub,
    }));

  const duplicates = kept.length - rows.length;

  if (!rows.length) {
    return NextResponse.json(
      {
        error: rejected.length
          ? "None of those look like player names — check what you pasted."
          : 'Everyone on that list is already on the roster.',
        rejected,
        duplicates,
      },
      { status: 400 },
    );
  }

  const { data, error } = await ctx.db.from('captain_players').insert(rows).select('id, name');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({
    ok: true,
    added: data?.length ?? 0,
    players: data,
    skipped: { duplicates, rejected },
  });
}

export async function PATCH(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    team_id?: string;
    player_id?: string;
    patch?: Record<string, unknown>;
    partner_prefs?: { preferred_player_id: string; rank: number }[];
    order?: unknown;
  };
  const ctx = await requireTeam(body.team_id || '');
  if (isError(ctx)) return ctx.error;

  // Bulk strength re-rank from the drag-to-order list: whole-list replace, so
  // one write settles every row and there are no gaps or duplicate ranks.
  if (Array.isArray(body.order)) {
    const ids = (body.order as unknown[]).filter((v): v is string => typeof v === 'string');
    const { data: mine } = await ctx.db
      .from('captain_players')
      .select('id')
      .eq('team_id', ctx.teamId);
    const onTeam = new Set(((mine as { id: string }[]) || []).map((r) => r.id));
    if (ids.some((id) => !onTeam.has(id))) {
      return NextResponse.json({ error: 'That roster order includes someone else.' }, { status: 400 });
    }

    const stamp = new Date().toISOString();
    const results = await Promise.all(
      ids.map((id, i) =>
        ctx.db
          .from('captain_players')
          .update({ sort_order: i + 1, updated_at: stamp })
          .eq('id', id)
          .eq('team_id', ctx.teamId),
      ),
    );
    const failed = results.find((r) => r.error);
    if (failed?.error) {
      if (/column .* does not exist/i.test(failed.error.message)) {
        return NextResponse.json(
          { error: 'Ranking needs the captain_style_and_lead_times migration to be run first.' },
          { status: 409 },
        );
      }
      return NextResponse.json({ error: failed.error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true, ranked: ids.length });
  }

  if (!body.player_id) return NextResponse.json({ error: 'player_id required.' }, { status: 400 });

  const allowed = [
    'name',
    'email',
    'phone',
    'rating',
    'wtn',
    'wtn_doubles',
    'rating_type',
    'gender',
    'return_side',
    'court_limit',
    'notes',
    'is_sub',
    'sort_order',
  ];
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const k of allowed) {
    if (body.patch && k in body.patch) patch[k] = body.patch[k];
  }

  // court_limit and return_side are CHECK-constrained. Coerce anything else to
  // null rather than letting the constraint 500 — the same mismatch broke the
  // player intake form.
  for (const [key, valid] of [
    ['court_limit', ['singles_only', 'doubles_only', 'no_court_1']],
    ['return_side', ['deuce', 'ad']],
  ] as const) {
    if (key in patch && !(valid as readonly string[]).includes(patch[key] as string)) {
      patch[key] = null;
    }
  }

  const { error } = await ctx.db
    .from('captain_players')
    .update(patch)
    .eq('id', body.player_id)
    .eq('team_id', ctx.teamId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Partner preferences are replace-all for that player (max 5, ranked).
  if (body.partner_prefs) {
    await ctx.db.from('captain_partner_prefs').delete().eq('player_id', body.player_id);
    const rows = body.partner_prefs
      .filter((p) => p.preferred_player_id && p.preferred_player_id !== body.player_id)
      .slice(0, 5)
      .map((p, i) => ({
        team_id: ctx.teamId,
        player_id: body.player_id,
        preferred_player_id: p.preferred_player_id,
        rank: p.rank ?? i + 1,
      }));
    if (rows.length) {
      const { error: perr } = await ctx.db.from('captain_partner_prefs').insert(rows);
      if (perr) return NextResponse.json({ error: perr.message }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const url = new URL(req.url);
  const ctx = await requireTeam(url.searchParams.get('team_id') || '');
  if (isError(ctx)) return ctx.error;
  const playerId = url.searchParams.get('player_id');
  if (!playerId) return NextResponse.json({ error: 'player_id required.' }, { status: 400 });

  // Soft delete — past lineups and results still point at this row.
  const { error } = await ctx.db
    .from('captain_players')
    .update({ active: false, updated_at: new Date().toISOString() })
    .eq('id', playerId)
    .eq('team_id', ctx.teamId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
