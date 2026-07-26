/**
 * Roster + subs.
 *   GET    ?team_id=…            — roster with prefs, never-pairs, eligibility
 *   POST   { team_id, players[] } — upsert roster rows
 *   PATCH  { team_id, player_id, … } — edit one player (incl. prefs)
 *   DELETE ?team_id=…&player_id=… — deactivate (never hard-delete: results reference them)
 */
import { NextResponse } from 'next/server';
import { requireTeam, isError, playedCounts, rulesFor } from '@/lib/captain/server';
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
          'id, name, email, rating, rating_type, gender, return_side, court_limit, is_sub, notes, active',
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

  const rows = (body.players || [])
    .filter((p) => p.name?.trim())
    .map((p) => ({
      team_id: ctx.teamId,
      name: p.name!.trim(),
      email: p.email?.trim() || null,
      rating: p.rating ?? null,
      gender: p.gender ?? null,
      is_sub: !!p.is_sub,
    }));
  if (!rows.length) return NextResponse.json({ error: 'No players supplied.' }, { status: 400 });

  const { data, error } = await ctx.db.from('captain_players').insert(rows).select('id, name');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, added: data?.length ?? 0, players: data });
}

export async function PATCH(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    team_id?: string;
    player_id?: string;
    patch?: Record<string, unknown>;
    partner_prefs?: { preferred_player_id: string; rank: number }[];
  };
  const ctx = await requireTeam(body.team_id || '');
  if (isError(ctx)) return ctx.error;
  if (!body.player_id) return NextResponse.json({ error: 'player_id required.' }, { status: 400 });

  const allowed = [
    'name',
    'email',
    'rating',
    'rating_type',
    'gender',
    'return_side',
    'court_limit',
    'notes',
    'is_sub',
  ];
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const k of allowed) {
    if (body.patch && k in body.patch) patch[k] = body.patch[k];
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
