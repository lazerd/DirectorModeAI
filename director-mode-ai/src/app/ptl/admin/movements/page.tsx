/**
 * End-of-season promotion and relegation.
 *
 * Shows the proposal — bottom of each division drops, top of each division
 * below climbs — with the record each decision rests on. The confirm recomputes
 * server-side, so a tab left open overnight cannot relegate the wrong team.
 */

import Link from 'next/link';
import { notFound } from 'next/navigation';
import MovementsPanel from '@/components/ptl/MovementsPanel';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { isPlatformOwnerEmail } from '@/lib/platformOwner';
import { getDivisions, getSeason, getStandingsByDivision, getTeams } from '@/lib/ptl/server';
import { proposeMovements } from '@/lib/ptl/standings';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

export default async function MovementsPage({
  searchParams,
}: {
  searchParams: Promise<{ season?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) notFound();

  const { season: slug } = await searchParams;
  const season = await getSeason(slug);
  if (!season) notFound();

  const db = getSupabaseAdmin();
  const { data: row } = await db
    .from('ptl_seasons')
    .select('commissioner_id')
    .eq('id', season.id)
    .maybeSingle();
  if ((row as any)?.commissioner_id !== user.id && !isPlatformOwnerEmail(user.email)) notFound();

  const [divisions, teams, standings] = await Promise.all([
    getDivisions(season.id),
    getTeams(season.id),
    getStandingsByDivision(season.id),
  ]);

  const proposed = proposeMovements(
    divisions.map((d) => ({ id: d.id, name: d.name, tier: d.tier })),
    standings,
  );

  const { count: unplayed } = await db
    .from('ptl_meetings')
    .select('id', { count: 'exact', head: true })
    .in(
      'division_id',
      divisions.map((d) => d.id),
    )
    .neq('status', 'complete');

  const { data: recorded } = await db
    .from('ptl_movements')
    .select('team_id')
    .eq('season_id', season.id);

  const divisionName = (id: string | null) => divisions.find((d) => d.id === id)?.name || '—';
  const rowsByTeam = new Map([...standings.values()].flat().map((r) => [r.teamId, r]));

  return (
    <div className="mx-auto max-w-4xl px-5 pb-24 pt-12">
      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-teal-400">
        Commissioner · {season.name}
      </p>
      <h1 className="mt-3 text-4xl font-black tracking-tight">Promotion &amp; relegation</h1>
      <p className="mt-4 max-w-2xl text-white/60">
        The bottom team of each division drops a tier and the top team of each division below climbs
        one. Confirming records the outcome and closes the season — it doesn&rsquo;t move anyone yet,
        because next season&rsquo;s teams don&rsquo;t exist until you create them.
      </p>

      <MovementsPanel
        seasonId={season.id}
        seasonSlug={season.slug}
        unplayed={unplayed ?? 0}
        alreadyRecorded={((recorded as any[]) || []).length > 0}
        rows={proposed.map((m) => {
          const r = rowsByTeam.get(m.teamId);
          return {
            teamId: m.teamId,
            teamName: teams.find((t) => t.id === m.teamId)?.name || m.teamName,
            direction: m.direction,
            from: divisionName(m.fromDivisionId),
            to: divisionName(m.toDivisionId),
            record: r ? `${r.won}–${r.lost}` : '—',
            rank: r?.rankLabel ?? '—',
          };
        })}
      />

      <div className="mt-12 border-t border-white/10 pt-6 text-sm">
        <Link href={`/ptl/admin?season=${season.slug}`} className="text-teal-400 hover:text-teal-300">
          &larr; Back to the console
        </Link>
      </div>
    </div>
  );
}
