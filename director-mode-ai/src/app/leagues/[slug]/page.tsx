import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  Trophy,
  Calendar,
  AlertCircle,
  GitBranch,
  ArrowRight,
  Users,
  BarChart3,
  ListChecks,
} from 'lucide-react';
import { format } from 'date-fns';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { CATEGORY_LABELS, CATEGORY_ORDER, formatMoney, type CategoryKey } from '@/lib/leagueUtils';
import { DAY_OF_WEEK_LABELS } from '@/lib/jtt';
import RegisterForm from './RegisterForm';

// This page is public — no auth required.
export const dynamic = 'force-dynamic';

export default async function PublicLeaguePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const supabase = getSupabaseAdmin();

  const { data: league } = await supabase
    .from('leagues')
    .select('*')
    .eq('slug', slug)
    .maybeSingle();

  if (!league) return notFound();
  const l = league as any;

  // Team-format JTT leagues get a completely different landing page —
  // the compass-draw registration copy doesn't apply.
  if (l.format === 'team') {
    return <JTTLanding league={l} />;
  }

  // Individual-format path (unchanged from original implementation)
  const { data: categories } = await supabase
    .from('league_categories')
    .select('id, category_key, entry_fee_cents, is_enabled')
    .eq('league_id', l.id)
    .eq('is_enabled', true);

  const status = l.status as string;
  const now = new Date();
  const opens = l.registration_opens_at ? new Date(l.registration_opens_at) : null;
  const closes = l.registration_closes_at ? new Date(l.registration_closes_at) : null;

  const registrationClosed =
    status !== 'open' ||
    (opens && now < opens) ||
    (closes && now > closes);

  const closedReason =
    status === 'draft' ? 'This league is not yet published.' :
    status === 'closed' ? 'Registration has closed.' :
    status === 'running' ? 'Registration closed — the league is already in progress.' :
    status === 'completed' ? 'This league has finished.' :
    status === 'cancelled' ? 'This league was cancelled.' :
    opens && now < opens ? `Registration opens ${format(opens, 'MMM d, yyyy h:mm a')}.` :
    closes && now > closes ? `Registration closed ${format(closes, 'MMM d, yyyy h:mm a')}.` :
    null;

  const sortedCategories = (categories || []).slice().sort((a: any, b: any) =>
    CATEGORY_ORDER.indexOf(a.category_key) - CATEGORY_ORDER.indexOf(b.category_key)
  );

  return (
    <div className="min-h-screen bg-[#001820] text-white">
      <header className="border-b border-white/10">
        <div className="max-w-3xl mx-auto px-4 py-6 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#D3FB52] flex items-center justify-center flex-shrink-0">
            <Trophy size={22} className="text-[#002838]" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-xs text-white/40">CoachMode Leagues</div>
            <h1 className="font-display text-xl truncate">{l.name}</h1>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-6 sm:py-8">
        {(l.status === 'running' || l.status === 'completed') && (
          <Link
            href={`/leagues/${l.slug}/bracket`}
            className="group block mb-6 rounded-xl border border-[#D3FB52]/40 bg-gradient-to-br from-[#D3FB52]/15 to-[#D3FB52]/5 px-5 py-4 hover:border-[#D3FB52] hover:from-[#D3FB52]/25 transition-colors"
          >
            <div className="flex items-center gap-4">
              <div className="w-11 h-11 rounded-xl bg-[#D3FB52] flex items-center justify-center flex-shrink-0">
                <GitBranch size={20} className="text-[#002838]" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-[#D3FB52] text-base leading-tight">
                  {l.status === 'running' ? 'View the live bracket' : 'View final results'}
                </div>
                <div className="text-xs text-white/50 mt-0.5">
                  {l.status === 'running'
                    ? 'Compass draw, standings, and match results — updated as scores come in.'
                    : 'Final placements, full bracket tree, and match history.'}
                </div>
              </div>
              <ArrowRight size={18} className="text-[#D3FB52] flex-shrink-0 group-hover:translate-x-0.5 transition-transform" />
            </div>
          </Link>
        )}

        <section className="bg-white/5 border border-white/10 rounded-xl p-5 sm:p-6 mb-6">
          <div className="flex items-start gap-2 text-sm text-white/60 mb-3">
            <Calendar size={16} className="mt-0.5 flex-shrink-0" />
            <span>
              {format(new Date(l.start_date), 'MMMM d, yyyy')} –{' '}
              {format(new Date(l.end_date), 'MMMM d, yyyy')}
            </span>
          </div>
          {l.description && (
            <p className="text-white/80 text-sm whitespace-pre-wrap">{l.description}</p>
          )}

          <div className="mt-5 pt-5 border-t border-white/10">
            <h3 className="text-xs uppercase tracking-wide text-white/40 mb-3">Format</h3>
            <p className="text-sm text-white/70">
              Compass draw — every player plays <strong className="text-white">4 matches</strong> (or 3 in
              an 8-player flight), one every 2 weeks, and gets ranked through their bracket. No early
              eliminations, every match counts.
            </p>
          </div>
        </section>

        {registrationClosed ? (
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-5 flex items-start gap-3">
            <AlertCircle size={20} className="text-red-400 mt-0.5 flex-shrink-0" />
            <div>
              <div className="font-medium text-red-300 mb-1">Registration is closed</div>
              <div className="text-sm text-red-200/80">{closedReason}</div>
            </div>
          </div>
        ) : sortedCategories.length === 0 ? (
          <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-5 text-yellow-200 text-sm">
            No categories have been set up for this league yet.
          </div>
        ) : (
          <RegisterForm
            leagueSlug={l.slug}
            leagueName={l.name}
            categories={sortedCategories.map((c: any) => ({
              id: c.id,
              key: c.category_key as CategoryKey,
              label: CATEGORY_LABELS[c.category_key as CategoryKey],
              feeCents: c.entry_fee_cents,
              feeLabel: formatMoney(c.entry_fee_cents),
            }))}
            paymentRails={{
              venmo: l.venmo_handle,
              zelle: l.zelle_handle,
              stripe: l.stripe_payment_link,
            }}
          />
        )}

        <div className="text-center text-xs text-white/30 mt-8 py-6 border-t border-white/10">
          Powered by <Link href="/" className="text-[#D3FB52] hover:underline">CoachMode AI</Link>
        </div>
      </main>
    </div>
  );
}

/**
 * JTT team-format landing page.
 * Shows the full season schedule with matchup cards, plus prominent links
 * to the standings + rosters public pages. No registration flow.
 */
async function JTTLanding({ league }: { league: any }) {
  const supabase = getSupabaseAdmin();
  const leagueId = league.id;

  const [clubsRes, divisionsRes, matchupsRes, linesRes] = await Promise.all([
    supabase.from('league_clubs').select('*').eq('league_id', leagueId).order('sort_order'),
    supabase.from('league_divisions').select('*').eq('league_id', leagueId).order('sort_order'),
    supabase
      .from('league_team_matchups')
      .select('*')
      .order('match_date'),
    supabase
      .from('league_matchup_lines')
      .select('matchup_id, status'),
  ]);

  const clubs = (clubsRes.data as any[]) || [];
  const divisions = (divisionsRes.data as any[]) || [];
  const allMatchups = (matchupsRes.data as any[]) || [];
  const allLines = (linesRes.data as any[]) || [];

  const clubsById = new Map(clubs.map((c: any) => [c.id, c]));
  const divisionsById = new Map(divisions.map((d: any) => [d.id, d]));
  const divisionIds = new Set(divisions.map((d: any) => d.id));
  const matchups = allMatchups.filter(m => divisionIds.has(m.division_id));
  const matchupIds = new Set(matchups.map(m => m.id));
  const lines = allLines.filter(line => matchupIds.has(line.matchup_id));

  const linesByMatchup = new Map<string, any[]>();
  for (const line of lines) {
    const arr = linesByMatchup.get(line.matchup_id) || [];
    arr.push(line);
    linesByMatchup.set(line.matchup_id, arr);
  }

  // Group matchups by date
  const byDate = new Map<string, any[]>();
  for (const m of matchups) {
    const arr = byDate.get(m.match_date) || [];
    arr.push(m);
    byDate.set(m.match_date, arr);
  }
  const dateGroups = Array.from(byDate.entries()).sort(([a], [b]) => a.localeCompare(b));

  // Find "next" matchup date for highlighting
  const today = new Date().toISOString().slice(0, 10);
  const nextDate = dateGroups.find(([d]) => d >= today)?.[0];

  return (
    <div className="min-h-screen bg-[#001820] text-white">
      <header className="border-b border-white/10">
        <div className="max-w-3xl mx-auto px-4 py-6 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#D3FB52] flex items-center justify-center flex-shrink-0">
            <Trophy size={22} className="text-[#002838]" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-xs text-white/40">CoachMode Leagues · JTT</div>
            <h1 className="font-display text-xl truncate">{league.name}</h1>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-6 sm:py-8">
        <section className="bg-white/5 border border-white/10 rounded-xl p-5 sm:p-6 mb-6">
          <div className="flex items-start gap-2 text-sm text-white/60 mb-3">
            <Calendar size={16} className="mt-0.5 flex-shrink-0" />
            <span>
              {format(new Date(league.start_date), 'MMMM d, yyyy')} –{' '}
              {format(new Date(league.end_date), 'MMMM d, yyyy')}
            </span>
          </div>
          {league.description && (
            <p className="text-white/80 text-sm whitespace-pre-wrap">{league.description}</p>
          )}
          <div className="mt-4 text-xs text-white/50">
            {clubs.length} clubs · {divisions.length} divisions · {matchups.length} matchups
          </div>
        </section>

        {/* Jump links */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
          <Link
            href={`/leagues/${league.slug}/standings`}
            className="group flex items-center gap-3 rounded-xl border border-[#D3FB52]/40 bg-gradient-to-br from-[#D3FB52]/15 to-[#D3FB52]/5 px-4 py-3 hover:border-[#D3FB52] transition-colors"
          >
            <div className="w-10 h-10 rounded-lg bg-[#D3FB52] flex items-center justify-center flex-shrink-0">
              <BarChart3 size={18} className="text-[#002838]" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-[#D3FB52] leading-tight">Standings</div>
              <div className="text-xs text-white/50">Club + player records</div>
            </div>
            <ArrowRight size={16} className="text-[#D3FB52] flex-shrink-0 group-hover:translate-x-0.5 transition-transform" />
          </Link>

          <Link
            href={`/leagues/${league.slug}/rosters`}
            className="group flex items-center gap-3 rounded-xl border border-white/20 bg-white/5 px-4 py-3 hover:border-white/40 hover:bg-white/10 transition-colors"
          >
            <div className="w-10 h-10 rounded-lg bg-white/10 flex items-center justify-center flex-shrink-0">
              <Users size={18} className="text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-white leading-tight">Rosters</div>
              <div className="text-xs text-white/50">Each team&apos;s strength order</div>
            </div>
            <ArrowRight size={16} className="text-white/60 flex-shrink-0 group-hover:translate-x-0.5 transition-transform" />
          </Link>
        </div>

        {/* Schedule */}
        <section>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-white/60 mb-3 flex items-center gap-2">
            <ListChecks size={16} />
            Season Schedule
          </h2>

          {dateGroups.length === 0 && (
            <div className="bg-white/5 border border-white/10 rounded-xl p-5 text-sm text-white/60">
              No matchups scheduled yet.
            </div>
          )}

          <div className="space-y-4">
            {dateGroups.map(([date, list]) => {
              const d = new Date(date + 'T00:00:00');
              const dateLabel = d.toLocaleDateString('en-US', {
                weekday: 'short',
                month: 'short',
                day: 'numeric',
              });
              const isNext = date === nextDate;
              const isPast = date < today;

              // Group by division within the date
              const byDiv = new Map<string, any[]>();
              for (const m of list) {
                const arr = byDiv.get(m.division_id) || [];
                arr.push(m);
                byDiv.set(m.division_id, arr);
              }
              const divEntries = Array.from(byDiv.entries())
                .map(([divId, ms]) => ({ divId, division: divisionsById.get(divId), ms }))
                .filter(x => !!x.division)
                .sort((a, b) => (a.division!.sort_order ?? 0) - (b.division!.sort_order ?? 0));

              return (
                <div
                  key={date}
                  className={`rounded-xl border ${
                    isNext
                      ? 'border-[#D3FB52]/40 bg-[#D3FB52]/5'
                      : isPast
                      ? 'border-white/10 bg-white/5 opacity-80'
                      : 'border-white/10 bg-white/5'
                  } overflow-hidden`}
                >
                  <header className="px-4 py-2.5 border-b border-white/10 flex items-baseline gap-2">
                    <span className="font-semibold text-white">{dateLabel}</span>
                    {isNext && (
                      <span className="text-xs font-semibold text-[#D3FB52] uppercase">
                        Next up
                      </span>
                    )}
                    {isPast && (
                      <span className="text-xs text-white/40 uppercase">Completed</span>
                    )}
                  </header>
                  <div className="divide-y divide-white/5">
                    {divEntries.map(({ divId, division, ms }) => (
                      <div key={divId} className="px-4 py-3">
                        <div className="text-xs font-medium text-white/50 mb-1.5 flex items-center gap-2">
                          <span>{division!.name}</span>
                          {division!.start_time && (
                            <span className="text-white/30">
                              {division!.start_time.slice(0, 5)}
                            </span>
                          )}
                        </div>
                        <ul className="space-y-1">
                          {ms.map(m => {
                            const home = clubsById.get(m.home_club_id);
                            const away = clubsById.get(m.away_club_id);
                            const ml = linesByMatchup.get(m.id) || [];
                            const done = ml.filter(x => x.status === 'completed').length;
                            const scoreShown =
                              m.status === 'completed' || m.status === 'in_progress';
                            return (
                              <li key={m.id}>
                                <Link
                                  href={`/leagues/${league.slug}/matchup/${m.id}`}
                                  className="flex items-center gap-3 px-3 py-2 rounded-md bg-white/5 hover:bg-white/10 transition-colors"
                                >
                                  <div className="flex-1 min-w-0 text-sm text-white">
                                    {away?.name ?? '???'}{' '}
                                    <span className="text-white/40">@</span>{' '}
                                    {home?.name ?? '???'}
                                  </div>
                                  {scoreShown && (
                                    <div className="text-sm font-semibold text-white">
                                      {m.away_lines_won}–{m.home_lines_won}
                                    </div>
                                  )}
                                  <div className="text-xs text-white/40">
                                    {done}/{ml.length} lines
                                  </div>
                                  <ArrowRight size={14} className="text-white/40" />
                                </Link>
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <div className="text-center text-xs text-white/30 mt-8 py-6 border-t border-white/10">
          Powered by <Link href="/" className="text-[#D3FB52] hover:underline">CoachMode AI</Link>
        </div>
      </main>
    </div>
  );
}
