/**
 * The published grid.
 *
 * "The whole season grid published on day one" is one of the four promises the
 * proposal makes, and it is the answer to the complaint that killed 5.0 play in
 * the first place: lost weekends and no schedule control. So this page shows
 * every night of the season up front, including the ones not yet played — a
 * schedule that only lists next week would be no better than what these players
 * already walked away from.
 *
 * Grouped by division rather than by date, because a player belongs to exactly
 * one division and wants to see their own five nights in a row, not everybody's
 * fifteen interleaved.
 */

import { notFound } from 'next/navigation';
import { DemoRibbon } from '@/components/ptl/DemoRibbon';
import { getDivisions, getSchedule, getSeason, getTeams } from '@/lib/ptl/server';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Schedule — Premier Tennis League',
  description: 'Every session of the Premier Tennis League season, published up front.',
};

/**
 * Dates are stored as plain DATE (no time, no zone) and must be rendered as
 * written. Passing a bare 'YYYY-MM-DD' to new Date() parses it as UTC midnight,
 * which in California renders as the day before — the bug that has bitten this
 * codebase before.
 */
function formatPlayDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
}

function formatTime(t: string | null): string {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  const suffix = h >= 12 ? 'pm' : 'am';
  const hour = h % 12 === 0 ? 12 : h % 12;
  return m ? `${hour}:${String(m).padStart(2, '0')}${suffix}` : `${hour}${suffix}`;
}

export default async function SchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ season?: string }>;
}) {
  const { season: slug } = await searchParams;
  const season = await getSeason(slug);
  if (!season) notFound();

  const [divisions, teams, nights] = await Promise.all([
    getDivisions(season.id),
    getTeams(season.id),
    getSchedule(season.id),
  ]);

  const teamName = (id: string) => teams.find((t) => t.id === id)?.short_code || '—';
  const gendered = divisions.some((d) => d.line_format === 'gendered_four');
  const todayIso = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD, local

  return (
    <>
      {season.is_demo && <DemoRibbon note={season.demo_note} />}

      <div className="mx-auto max-w-5xl px-5 pb-24 pt-12">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-teal-400">
          {season.name}
        </p>
        <h1 className="mt-3 text-4xl font-black tracking-tight sm:text-5xl">The grid</h1>
        <p className="mt-4 max-w-2xl text-white/60">
          Every session of the season, published up front. A division of four plays a full round
          robin in one session — three rounds, two meetings at a time, across{' '}
          {season.courts_per_division} courts.
        </p>

        {nights.length === 0 ? (
          <p className="mt-12 rounded-sm border border-white/10 bg-white/[0.03] px-6 py-10 text-white/55">
            The grid is published once the draft is done and the teams are placed.
          </p>
        ) : (
          <div className="mt-12 space-y-16">
            {divisions.map((d) => {
              const divNights = nights.filter((n) => n.division_id === d.id);
              if (!divNights.length) return null;
              return (
                <section key={d.id}>
                  <h2 className="text-2xl font-black tracking-tight">{d.name}</h2>
                  <p className="mt-1 text-sm text-white/45">
                    {d.day_of_week != null
                      ? ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'][d.day_of_week]
                      : 'Day TBD'}
                    {d.start_time && (
                      <>
                        {' '}
                        · {formatTime(d.start_time)}–{formatTime(d.end_time)}
                      </>
                    )}
                  </p>

                  <ol className="mt-6 space-y-3">
                    {divNights.map((n) => {
                      const done = n.status === 'complete';
                      const next = !done && n.play_date >= todayIso;
                      return (
                        <li
                          key={n.id}
                          className={`rounded-sm border px-5 py-4 ${
                            done
                              ? 'border-white/10 bg-white/[0.02]'
                              : next
                                ? 'border-teal-400/35 bg-teal-400/[0.05]'
                                : 'border-white/10'
                          }`}
                        >
                          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                            <div>
                              <span className="font-bold">
                                {n.is_finals ? 'Finals' : `Week ${n.week_no}`}
                              </span>
                              <span className="ml-3 text-white/70">{formatPlayDate(n.play_date)}</span>
                              {n.site_name && (
                                <span className="ml-3 text-sm text-white/45">{n.site_name}</span>
                              )}
                            </div>
                            <span
                              className={`text-[11px] font-bold uppercase tracking-wider ${
                                done ? 'text-white/35' : next ? 'text-teal-300' : 'text-white/35'
                              }`}
                            >
                              {done ? 'Played' : next ? 'Upcoming' : 'Scheduled'}
                            </span>
                          </div>

                          {n.meetings.length > 0 && (
                            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm">
                              {n.meetings.map((m) => (
                                <span key={m.id} className="tabular-nums text-white/60">
                                  <span className="text-white/35">R{m.round_no}</span>{' '}
                                  <span className={m.result === 'home' ? 'font-bold text-white' : ''}>
                                    {teamName(m.home_team_id)}
                                  </span>
                                  <span className="text-white/30"> v </span>
                                  <span className={m.result === 'away' ? 'font-bold text-white' : ''}>
                                    {teamName(m.away_team_id)}
                                  </span>
                                  {done && (
                                    <>
                                      <span className="ml-1.5 text-white/45">
                                        {m.home_games}&ndash;{m.away_games}
                                      </span>
                                      {/* Anything past level 2 is a story, so say so. */}
                                      {m.decided_at_level != null
                                        && m.decided_at_level >= (gendered ? 2 : 3) && (
                                        <span className="ml-1.5 text-[10px] uppercase tracking-wider text-amber-300/80">
                                          {gendered
                                            ? 'mixed decided it'
                                            : m.decided_at_level === 3
                                              ? 'tiebreaks'
                                              : m.decided_at_level === 4
                                                ? 'combined pts'
                                                : 'decider'}
                                        </span>
                                      )}
                                    </>
                                  )}
                                </span>
                              ))}
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ol>
                </section>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
