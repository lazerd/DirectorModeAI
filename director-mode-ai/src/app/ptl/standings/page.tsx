/**
 * Full standings, one table per division.
 *
 * The cascade is the point here, so the page states it rather than leaving
 * people to guess why a 3-2 team sits above another 3-2 team: meetings won,
 * then head-to-head, then total games, then game differential. A table that
 * silently reorders itself is a table captains argue about.
 *
 * Promotion and relegation are drawn INTO the table — a teal edge on the team
 * climbing, an amber one on the team dropping — because "something to play for"
 * is the whole pitch, and a league that only mentions it in the marketing copy
 * isn't showing it where it bites.
 */

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DemoRibbon } from '@/components/ptl/DemoRibbon';
import { getDivisions, getRosters, getSeason, getStandingsByDivision, getTeams } from '@/lib/ptl/server';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Standings — Premier Tennis League',
  description: 'Division tables for the Premier Tennis League.',
};

export default async function StandingsPage({
  searchParams,
}: {
  searchParams: Promise<{ season?: string }>;
}) {
  const { season: slug } = await searchParams;
  const season = await getSeason(slug);
  if (!season) notFound();

  const [divisions, teams, standings, rosters] = await Promise.all([
    getDivisions(season.id),
    getTeams(season.id),
    getStandingsByDivision(season.id),
    getRosters(season.id),
  ]);

  const played = [...standings.values()].some((rows) => rows.some((r) => r.played > 0));
  const gendered = divisions.some((d) => d.line_format === 'gendered_four');

  return (
    <>
      {season.is_demo && <DemoRibbon note={season.demo_note} />}

      <div className="mx-auto max-w-5xl px-5 pb-24 pt-12">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-teal-400">
          {season.name}
        </p>
        <h1 className="mt-3 text-4xl font-black tracking-tight sm:text-5xl">Standings</h1>

        {!played ? (
          <div className="mt-10 rounded-sm border border-white/10 bg-white/[0.03] px-6 py-10">
            <p className="text-lg font-semibold">No matches played yet.</p>
            <p className="mt-2 text-white/55">
              Tables fill in after the first session. The full grid is already published.
            </p>
            <Link
              href={`/ptl/schedule?season=${season.slug}`}
              className="mt-6 inline-block rounded-sm border border-white/25 px-5 py-2.5 font-semibold text-white/85 hover:border-white/50 hover:text-white"
            >
              See the schedule
            </Link>
          </div>
        ) : (
          <div className="mt-12 space-y-16">
            {divisions.map((d, di) => {
              const rows = standings.get(d.id) || [];
              const last = rows.length - 1;
              return (
                <section key={d.id}>
                  <div className="flex flex-wrap items-baseline justify-between gap-3">
                    <h2 className="text-2xl font-black tracking-tight">
                      {d.name}
                      {di === 0 && (
                        <span className="ml-3 align-middle text-[10px] font-bold uppercase tracking-wider text-teal-300">
                          Top tier
                        </span>
                      )}
                    </h2>
                    <p className="text-sm text-white/45">
                      {(d.nightly_prize_cents / 100).toLocaleString('en-US', {
                        style: 'currency',
                        currency: 'USD',
                        maximumFractionDigits: 0,
                      })}{' '}
                      a session ·{' '}
                      {(d.finals_prize_cents / 100).toLocaleString('en-US', {
                        style: 'currency',
                        currency: 'USD',
                        maximumFractionDigits: 0,
                      })}{' '}
                      finals
                    </p>
                  </div>

                  {rows.length === 0 ? (
                    <p className="mt-5 text-sm text-white/40">No teams placed in this division yet.</p>
                  ) : (
                    <div className="mt-5 overflow-x-auto">
                      <table className="w-full min-w-[620px] border-collapse text-left">
                        <thead>
                          <tr className="border-b border-white/15 text-[11px] uppercase tracking-[0.14em] text-white/40">
                            <th className="pb-2.5 pl-3 font-medium">#</th>
                            <th className="pb-2.5 font-medium">Team</th>
                            <th className="pb-2.5 text-right font-medium">P</th>
                            <th className="pb-2.5 text-right font-medium">W</th>
                            <th className="pb-2.5 text-right font-medium">L</th>
                            <th className="pb-2.5 text-right font-medium">Games</th>
                            <th className="pb-2.5 pr-3 text-right font-medium">Diff</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map((r, i) => {
                            const team = teams.find((t) => t.id === r.teamId);
                            const climbing = di > 0 && i === 0;
                            const dropping = di < divisions.length - 1 && i === last;
                            return (
                              <tr
                                key={r.teamId}
                                className={`border-b border-white/[0.07] ${
                                  climbing
                                    ? 'bg-teal-400/[0.06]'
                                    : dropping
                                      ? 'bg-amber-400/[0.05]'
                                      : ''
                                }`}
                              >
                                <td
                                  className={`py-3 pl-3 text-sm tabular-nums text-white/45 ${
                                    climbing
                                      ? 'border-l-2 border-teal-400'
                                      : dropping
                                        ? 'border-l-2 border-amber-400'
                                        : 'border-l-2 border-transparent'
                                  }`}
                                >
                                  {r.rankLabel}
                                </td>
                                <td className="py-3">
                                  <span
                                    className="mr-2.5 inline-block h-2.5 w-2.5 rounded-full align-middle"
                                    style={{ background: team?.color || '#64748B' }}
                                    aria-hidden="true"
                                  />
                                  <span className="font-bold">{r.name}</span>
                                  <span className="ml-2 text-xs text-white/35">
                                    {(rosters.get(r.teamId) || []).length} players
                                  </span>
                                  {climbing && (
                                    <span className="ml-3 text-[10px] font-bold uppercase tracking-wider text-teal-300">
                                      ↑ promotion
                                    </span>
                                  )}
                                  {dropping && (
                                    <span className="ml-3 text-[10px] font-bold uppercase tracking-wider text-amber-300">
                                      ↓ relegation
                                    </span>
                                  )}
                                </td>
                                <td className="py-3 text-right tabular-nums text-white/60">{r.played}</td>
                                <td className="py-3 text-right font-semibold tabular-nums">{r.won}</td>
                                <td className="py-3 text-right tabular-nums text-white/60">{r.lost}</td>
                                <td className="py-3 text-right tabular-nums text-white/60">
                                  {r.gamesFor}&ndash;{r.gamesAgainst}
                                </td>
                                <td className="py-3 pr-3 text-right tabular-nums">
                                  <span className={r.gameDiff > 0 ? 'text-teal-300' : r.gameDiff < 0 ? 'text-white/45' : 'text-white/60'}>
                                    {r.gameDiff > 0 ? '+' : ''}
                                    {r.gameDiff}
                                  </span>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        )}

        <div className="mt-16 border-t border-white/10 pt-6 text-sm leading-relaxed text-white/45">
          <p>
            <span className="font-semibold text-white/70">How ties are broken:</span> meetings won,
            then head-to-head between the teams that are level, then total games won, then game
            differential. Head-to-head is scored as a mini-league among the tied teams, so three
            teams that beat each other in a circle still produce one stable table.
          </p>
          <p className="mt-3">
            {gendered ? (
              <>
                A meeting is four lines — men&rsquo;s and women&rsquo;s singles, men&rsquo;s and
                women&rsquo;s doubles — played at once. Win three and it&rsquo;s yours. Finish{' '}
                <span className="font-semibold text-white/70">2&ndash;2</span> and a mixed doubles
                decides it.
              </>
            ) : (
              <>
                A meeting is won by taking both lines. Split them and total games decides; level on
                games and it goes to a pair of seven-point tiebreaks, then combined points, then a
                two-of-three point tiebreak between the singles players.
              </>
            )}
          </p>
        </div>
      </div>
    </>
  );
}
