/**
 * Confirming end-of-season promotion and relegation.
 *
 * The proposal itself is pure (proposeMovements in lib/ptl/standings.ts). This
 * route recomputes it server-side from live standings at the moment of
 * confirmation rather than trusting whatever the browser was showing — a table
 * the commissioner opened yesterday may not be the table as it stands now if a
 * score was corrected overnight, and "we relegated the wrong team because the
 * page was stale" is not a recoverable mistake.
 *
 * It records the outcome instead of applying it. See ptl_night_and_movements.sql
 * for why: next season's teams do not exist yet, so there is nothing to move.
 */

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { isPlatformOwnerEmail } from '@/lib/platformOwner';
import { getDivisions, getStandingsByDivision } from '@/lib/ptl/server';
import { proposeMovements } from '@/lib/ptl/standings';
import { clampText } from '@/lib/ptl/guard';

async function gate(seasonId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Sign in first.', status: 401 as const };

  const db = getSupabaseAdmin();
  const { data: season } = await db
    .from('ptl_seasons')
    .select('id, status, commissioner_id')
    .eq('id', seasonId)
    .maybeSingle();
  if (!season) return { error: 'Not found.', status: 404 as const };

  const ok = (season as any).commissioner_id === user.id || isPlatformOwnerEmail(user.email);
  if (!ok) return { error: 'Not found.', status: 404 as const };
  return { user, season: season as any };
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const seasonId = clampText(body.seasonId, 64);
    const action = clampText(body.action, 16);
    if (!seasonId) return NextResponse.json({ error: 'Missing season.' }, { status: 400 });

    const g = await gate(seasonId);
    if ('error' in g) return NextResponse.json({ error: g.error }, { status: g.status });

    const db = getSupabaseAdmin();

    if (action === 'clear') {
      await db.from('ptl_movements').delete().eq('season_id', seasonId);
      return NextResponse.json({ success: true, cleared: true });
    }

    if (action !== 'confirm') {
      return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
    }

    /*
     * Refuse to close a season that still has matches to play. Relegating a
     * team on a half-finished table is the single most damaging thing this
     * screen could do, and the commissioner is the one person with the
     * authority to do it by accident.
     */
    const divisions = await getDivisions(seasonId);
    const { count: unplayed } = await db
      .from('ptl_meetings')
      .select('id', { count: 'exact', head: true })
      .in('division_id', divisions.map((d) => d.id))
      .neq('status', 'complete');

    if ((unplayed ?? 0) > 0 && !body.force) {
      return NextResponse.json(
        {
          error: `${unplayed} meeting${unplayed === 1 ? '' : 's'} still unplayed. Finish the season, or confirm again to override.`,
          needsForce: true,
        },
        { status: 409 },
      );
    }

    const standings = await getStandingsByDivision(seasonId);
    const moves = proposeMovements(
      divisions.map((d) => ({ id: d.id, name: d.name, tier: d.tier })),
      standings,
    );

    if (!moves.length) {
      return NextResponse.json({ error: 'Nothing to move.' }, { status: 400 });
    }

    // Freeze the record each decision was made on, so a later score correction
    // cannot silently rewrite the history of why a team went down.
    const rowsByTeam = new Map(
      [...standings.values()].flat().map((r) => [r.teamId, r]),
    );

    const { error } = await db.from('ptl_movements').upsert(
      moves.map((m) => {
        const row = rowsByTeam.get(m.teamId);
        return {
          season_id: seasonId,
          team_id: m.teamId,
          from_division_id: m.fromDivisionId,
          to_division_id: m.toDivisionId,
          direction: m.direction,
          final_rank: row?.rank ?? null,
          final_record: row ? `${row.won}-${row.lost}` : null,
          confirmed_by: g.user.id,
        };
      }),
      { onConflict: 'season_id,team_id' },
    );

    if (error) {
      console.error('[ptl] movements upsert failed', error.message);
      return NextResponse.json({ error: 'Could not record those movements.' }, { status: 500 });
    }

    await db.from('ptl_seasons').update({ status: 'complete' }).eq('id', seasonId);

    return NextResponse.json({ success: true, recorded: moves.length });
  } catch (err: any) {
    console.error('[ptl] movements error', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
