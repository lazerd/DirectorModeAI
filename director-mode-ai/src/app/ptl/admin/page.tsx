/**
 * The commissioner console.
 *
 * The only PTL path in middleware's protectedPaths — everything else under /ptl
 * is public or tokenized on purpose. Being signed in is not enough on its own:
 * the page also checks that this user is the season's commissioner or the
 * platform owner, and 404s rather than 403s if not, because a signed-in club
 * owner who wandered in has no business learning this console exists.
 */

import Link from 'next/link';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import AdminConsole from '@/components/ptl/AdminConsole';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { isPlatformOwnerEmail } from '@/lib/platformOwner';
import {
  getDraftForSeason,
  getDraftState,
  getRosters,
  getSeason,
  getTeams,
} from '@/lib/ptl/server';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

export default async function PtlAdminPage({
  searchParams,
}: {
  searchParams: Promise<{ season?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) notFound(); // middleware already redirected; belt and braces

  const { season: slug } = await searchParams;
  const season = await getSeason(slug);
  if (!season) notFound();

  const db = getSupabaseAdmin();
  const { data: row } = await db
    .from('ptl_seasons')
    .select('commissioner_id')
    .eq('id', season.id)
    .maybeSingle();

  const mayRun =
    (row as any)?.commissioner_id === user.id || isPlatformOwnerEmail(user.email);
  if (!mayRun) notFound();

  const [teams, rosters, draft] = await Promise.all([
    getTeams(season.id),
    getRosters(season.id),
    getDraftForSeason(season.id),
  ]);
  const state = draft ? await getDraftState(draft.id) : null;

  // Enrolment counts for the header strip.
  const { data: entries } = await db
    .from('ptl_entries')
    .select('id, status, payment_status, flag_discrepancy')
    .eq('season_id', season.id);
  const rows = (entries as Array<{ status: string; payment_status: string; flag_discrepancy: boolean }>) || [];
  const confirmed = rows.filter((e) => e.status === 'confirmed').length;
  const paid = rows.filter((e) => e.payment_status === 'paid').length;
  const flagged = rows.filter((e) => e.flag_discrepancy).length;

  // Build absolute captain links against the host actually serving this page,
  // so the links work on ptl.clubmode.ai as well as anywhere else it is served.
  const h = await headers();
  const host = h.get('x-forwarded-host') || h.get('host') || '';
  const proto = h.get('x-forwarded-proto') || (host.startsWith('localhost') ? 'http' : 'https');
  const origin = host ? `${proto}://${host}` : '';

  const { data: tokenRows } = await db
    .from('ptl_teams')
    .select('id, team_token, captain_email')
    .eq('season_id', season.id);
  const tokens = new Map(
    ((tokenRows as Array<{ id: string; team_token: string; captain_email: string | null }>) || []).map(
      (t) => [t.id, t],
    ),
  );

  return (
    <div className="mx-auto max-w-5xl px-5 pb-24 pt-12">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-teal-400">
            Commissioner
          </p>
          <h1 className="mt-3 text-4xl font-black tracking-tight">{season.name}</h1>
        </div>
        <p className="text-sm capitalize text-white/50">{season.status}</p>
      </div>

      {season.is_demo && (
        <p className="mt-5 rounded-sm border border-amber-300/25 bg-amber-300/10 px-4 py-3 text-sm text-amber-200/90">
          This is a demo season. Rebuild it any time with{' '}
          <code className="text-amber-100">node scripts/ptl-demo-seed.mjs</code>.
        </p>
      )}

      <dl className="mt-8 grid grid-cols-2 gap-px border-y border-white/10 sm:grid-cols-4">
        {[
          [String(confirmed), 'Enrolled'],
          [String(paid), 'Paid'],
          [String(teams.length), 'Teams'],
          [String(flagged), 'Rating flags'],
        ].map(([value, label]) => (
          <div key={label} className="py-5">
            <dt className="text-2xl font-black tabular-nums">{value}</dt>
            <dd className="mt-0.5 text-xs uppercase tracking-[0.14em] text-white/45">{label}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-10">
        <AdminConsole
          draftId={draft?.id ?? null}
          status={state?.status ?? null}
          currentPickNo={state?.current_pick_no ?? null}
          picksMade={state?.picks_made ?? 0}
          totalPicks={state ? state.teams * state.rounds : 0}
          onClockTeamId={state?.on_the_clock_team_id ?? null}
          seasonSlug={season.slug}
          origin={origin}
          teams={teams.map((t) => ({
            id: t.id,
            name: t.name,
            shortCode: t.short_code,
            draftSlot: t.draft_slot,
            captainName: t.captain_name,
            captainEmail: tokens.get(t.id)?.captain_email ?? null,
            token: tokens.get(t.id)?.team_token ?? '',
            rosterCount: (rosters.get(t.id) || []).length,
          }))}
        />
      </div>

      <div className="mt-12 flex flex-wrap gap-4 border-t border-white/10 pt-6 text-sm">
        <Link
          href={`/ptl/admin/settings?season=${season.slug}`}
          className="font-semibold text-teal-400 hover:text-teal-300"
        >
          Format settings →
        </Link>
        <Link
          href={`/ptl/admin/movements?season=${season.slug}`}
          className="font-semibold text-teal-400 hover:text-teal-300"
        >
          Promotion &amp; relegation →
        </Link>
        <Link href={`/ptl?season=${season.slug}`} className="text-teal-400 hover:text-teal-300">
          League page →
        </Link>
        <Link href={`/ptl/standings?season=${season.slug}`} className="text-teal-400 hover:text-teal-300">
          Standings →
        </Link>
        <Link href={`/ptl/schedule?season=${season.slug}`} className="text-teal-400 hover:text-teal-300">
          Schedule →
        </Link>
      </div>
    </div>
  );
}
