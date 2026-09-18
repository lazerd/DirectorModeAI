/**
 * Format settings.
 *
 * Exists because the proposal's numbers are a proposal. The committee will move
 * them, and every one of them should be a form field rather than a deploy.
 */

import Link from 'next/link';
import { notFound } from 'next/navigation';
import SettingsEditor from '@/components/ptl/SettingsEditor';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { isPlatformOwnerEmail } from '@/lib/platformOwner';
import { getDivisions, getRosters, getSeason, getTeams } from '@/lib/ptl/server';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

export default async function SettingsPage({
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
  const { data: full } = await db
    .from('ptl_seasons')
    .select('commissioner_id, category, rating_floor, default_site_name')
    .eq('id', season.id)
    .maybeSingle();
  if ((full as any)?.commissioner_id !== user.id && !isPlatformOwnerEmail(user.email)) notFound();

  const [divisions, teams, rosters] = await Promise.all([
    getDivisions(season.id),
    getTeams(season.id),
    getRosters(season.id),
  ]);

  // Line counts and night counts are not on the shared readers, so fetch them
  // here rather than widening those for one screen.
  const { data: divExtra } = await db
    .from('ptl_divisions')
    .select('id, singles_lines, doubles_lines')
    .eq('season_id', season.id);
  const extra = new Map(
    ((divExtra as any[]) || []).map((d) => [d.id, d]),
  );

  const { data: nightRows } = await db
    .from('ptl_nights')
    .select('division_id')
    .in('division_id', divisions.map((d) => d.id));
  const nightCounts = new Map<string, number>();
  for (const n of ((nightRows as any[]) || [])) {
    nightCounts.set(n.division_id, (nightCounts.get(n.division_id) ?? 0) + 1);
  }

  const { data: teamExtra } = await db
    .from('ptl_teams')
    .select('id, captain_email')
    .eq('season_id', season.id);
  const emails = new Map(((teamExtra as any[]) || []).map((t) => [t.id, t.captain_email]));

  const { data: draft } = await db
    .from('ptl_drafts')
    .select('id, status')
    .eq('season_id', season.id)
    .maybeSingle();
  let draftStarted = false;
  if (draft) {
    const { count } = await db
      .from('ptl_draft_picks')
      .select('id', { count: 'exact', head: true })
      .eq('draft_id', (draft as any).id);
    draftStarted = (count ?? 0) > 0 || (draft as any).status !== 'pending';
  }

  return (
    <div className="mx-auto max-w-5xl px-5 pb-24 pt-12">
      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-teal-400">
        Commissioner · {season.name}
      </p>
      <h1 className="mt-3 text-4xl font-black tracking-tight">Format settings</h1>
      <p className="mt-4 max-w-2xl text-white/60">
        Teams, divisions, roster size, rating floor, category, venue, prize money and the pick
        clock. Change any of it — the league pages, the draft and the standings all read from
        these, so nothing needs redeploying.
      </p>

      <div className="mt-12">
        <SettingsEditor
          draftStarted={draftStarted}
          season={{
            id: season.id,
            name: season.name,
            status: season.status,
            category: (full as any)?.category ?? 'open',
            rosterSize: season.roster_size,
            pickSeconds: season.pick_seconds,
            courtsPerDivision: season.courts_per_division,
            entryDollars: Math.round(season.entry_cents / 100),
            ratingFloor: (full as any)?.rating_floor != null ? Number((full as any).rating_floor) : null,
            defaultSiteName: (full as any)?.default_site_name ?? null,
            blurb: season.blurb,
          }}
          divisions={divisions.map((d) => ({
            id: d.id,
            name: d.name,
            shortCode: d.short_code,
            tier: d.tier,
            nightlyDollars: Math.round(d.nightly_prize_cents / 100),
            finalsDollars: Math.round(d.finals_prize_cents / 100),
            dayOfWeek: d.day_of_week,
            startTime: d.start_time,
            endTime: d.end_time,
            singlesLines: extra.get(d.id)?.singles_lines ?? 1,
            doublesLines: extra.get(d.id)?.doubles_lines ?? 1,
            nightCount: nightCounts.get(d.id) ?? 0,
          }))}
          teams={teams.map((t) => ({
            id: t.id,
            name: t.name,
            shortCode: t.short_code,
            color: t.color,
            draftSlot: t.draft_slot,
            captainName: t.captain_name,
            captainEmail: emails.get(t.id) ?? null,
            captainIsPlaying: t.captain_is_playing,
            rosterCount: (rosters.get(t.id) || []).length,
          }))}
        />
      </div>

      <div className="mt-14 border-t border-white/10 pt-6 text-sm">
        <Link href={`/ptl/admin?season=${season.slug}`} className="text-teal-400 hover:text-teal-300">
          &larr; Back to the console
        </Link>
      </div>
    </div>
  );
}
