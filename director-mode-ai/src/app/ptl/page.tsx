/**
 * The Premier Tennis League front page.
 *
 * This is the page Damon opens. It has one job: make a 5.0 player, or the
 * committee deciding whether to run this, understand the format in about
 * fifteen seconds — and the format is the pitch. Every number on this page is
 * from the proposal, and every one of them is read from the season row rather
 * than hardcoded, so the page tells the truth about whatever season is current.
 *
 * Public: no entry in middleware's protectedPaths, reads through
 * getSupabaseAdmin because every ptl_ table except the two draft ones is closed
 * to anon.
 */

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PtlCrest } from '@/components/ptl/Crest';
import { DemoRibbon } from '@/components/ptl/DemoRibbon';
import { getDivisions, getSeason, getStandingsByDivision, getTeams } from '@/lib/ptl/server';

export const dynamic = 'force-dynamic';

const money = (cents: number) => `$${(cents / 100).toLocaleString('en-US')}`;

/** The four reasons the proposal says 5.0 players walked away from USTA. */
const PROBLEMS = [
  {
    gone: 'No one to play at 5.0+',
    fix: 'The whole league is 5.0 and above, and every match is sanctioned and rating-counted.',
  },
  {
    gone: 'Lost weekends, no schedule control',
    fix: 'A fixed three-hour window, and the full season grid published on day one.',
  },
  {
    gone: 'Expensive, low-reward tournaments',
    fix: 'Guaranteed matches every session, and the team splits the cost.',
  },
  {
    gone: 'Nothing to play for',
    fix: 'Cash on the line every session, promotion and relegation, and division titles.',
  },
];

export default async function PtlHomePage({
  searchParams,
}: {
  searchParams: Promise<{ season?: string }>;
}) {
  const { season: slug } = await searchParams;
  const season = await getSeason(slug);
  if (!season) notFound();

  const [divisions, teams] = await Promise.all([
    getDivisions(season.id),
    getTeams(season.id),
  ]);
  const standings = season.status === 'running' || season.status === 'complete'
    ? await getStandingsByDivision(season.id)
    : null;

  /*
   * The page describes the format the season actually plays, rather than
   * repeating the proposal. A page claiming "one singles and one doubles" over
   * a season running four gendered lines is the kind of thing a committee
   * member notices and stops trusting the rest of the page for.
   */
  const gendered = divisions.some((d) => d.line_format === 'gendered_four');

  const prizePool = divisions.reduce(
    (n, d) => n + d.nightly_prize_cents * 5 + d.finals_prize_cents,
    0,
  );
  const enrolling = season.status === 'enrolling';

  return (
    <>
      {season.is_demo && <DemoRibbon note={season.demo_note} />}

      {/* ---------- hero ---------- */}
      <section className="mx-auto max-w-6xl px-5 pb-16 pt-14 sm:pt-20">
        <div className="grid items-center gap-12 lg:grid-cols-[1.35fr_1fr]">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-teal-400">
              {season.name} · 5.0 and above
            </p>
            <h1 className="mt-4 text-balance text-4xl font-black leading-[1.05] tracking-tight sm:text-6xl">
              The competition of a tournament,<br className="hidden sm:block" /> in a single
              session.
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-white/65">
              {season.blurb}
            </p>

            <div className="mt-9 flex flex-wrap items-center gap-4">
              {enrolling ? (
                <Link
                  href={`/ptl/enroll?season=${season.slug}`}
                  className="rounded-sm bg-teal-400 px-7 py-3.5 text-base font-bold tracking-wide text-[#06231F] transition-colors hover:bg-teal-300"
                >
                  Enroll for {money(season.entry_cents)}
                </Link>
              ) : (
                <Link
                  href={`/ptl/standings?season=${season.slug}`}
                  className="rounded-sm bg-teal-400 px-7 py-3.5 text-base font-bold tracking-wide text-[#06231F] transition-colors hover:bg-teal-300"
                >
                  See the standings
                </Link>
              )}
              <Link
                href={`/ptl/schedule?season=${season.slug}`}
                className="rounded-sm border border-white/25 px-7 py-3.5 text-base font-semibold tracking-wide text-white/85 transition-colors hover:border-white/50 hover:text-white"
              >
                The full grid
              </Link>
            </div>

            <p className="mt-5 text-sm text-white/45">
              You don&rsquo;t pick a team. Captains draft the rosters, so every team starts balanced.
            </p>
          </div>

          <div className="justify-self-center lg:justify-self-end">
            <PtlCrest variant="lockup" byline width={300} />
          </div>
        </div>
      </section>

      {/* ---------- the numbers ---------- */}
      <section className="border-y border-white/10 bg-white/[0.02]">
        <dl className="mx-auto grid max-w-6xl grid-cols-2 gap-px px-5 sm:grid-cols-3 lg:grid-cols-6">
          {[
            [String(teams.length || 12), 'Teams'],
            [String(divisions.length || 3), 'Divisions'],
            [String(season.roster_size), 'Per roster'],
            ['5.0+', gendered ? 'Men and women' : 'Rating floor'],
            ['~3h', 'Per session'],
            [String(season.courts_per_division), 'Courts / division'],
          ].map(([value, label]) => (
            <div key={label} className="py-7">
              <dt className="text-3xl font-black tracking-tight tabular-nums text-white">{value}</dt>
              <dd className="mt-1 text-xs uppercase tracking-[0.14em] text-white/45">{label}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* ---------- how a session works ---------- */}
      <section className="mx-auto max-w-6xl px-5 py-20">
        <h2 className="text-3xl font-black tracking-tight sm:text-4xl">How a session works</h2>
        <p className="mt-4 max-w-2xl text-white/60">
          Four teams, one division, one session. You face all three rivals — not one opponent and a
          drive home.
        </p>

        <ol className="mt-10 grid gap-8 md:grid-cols-3">
          {[
            {
              n: 'One',
              h: 'A full round robin',
              p: `Four teams play every other team in the same session. Three rounds, two meetings at a time, across ${season.courts_per_division} courts.`,
            },
            gendered
              ? {
                  n: 'Two',
                  h: 'Four lines at once',
                  p: "Men's singles, women's singles, men's doubles and women's doubles, played side by side. Men never play women. Best of three Fast4, no-ad.",
                }
              : {
                  n: 'Two',
                  h: 'One singles, one doubles',
                  p: 'Each meeting is a singles and a doubles played side by side. Best of three Fast4, no-ad, a seven-point tiebreak for a split.',
                },
            gendered
              ? {
                  n: 'Three',
                  h: 'And if it finishes 2-2',
                  p: 'A mixed doubles decides it. One man and one woman a side, back on court, the whole meeting riding on it — and the table is complete before anyone reaches the car park.',
                }
              : {
                  n: 'Three',
                  h: 'Standings before you leave',
                  p: 'Win both matches and the meeting is yours. Split it and total games decide — and the table is complete before anyone reaches the car park.',
                },
          ].map((step) => (
            <li key={step.n}>
              <span className="text-xs font-semibold uppercase tracking-[0.22em] text-teal-400">
                {step.n}
              </span>
              <h3 className="mt-3 text-xl font-bold tracking-tight">{step.h}</h3>
              <p className="mt-2 leading-relaxed text-white/60">{step.p}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* ---------- divisions ---------- */}
      <section className="border-t border-white/10 bg-white/[0.02]">
        <div className="mx-auto max-w-6xl px-5 py-20">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h2 className="text-3xl font-black tracking-tight sm:text-4xl">
                Three divisions. Something to play for.
              </h2>
              <p className="mt-4 max-w-2xl text-white/60">
                Placement follows the draft, by roster strength, so all three start balanced. The
                top team moves up and the bottom team drops each season.
              </p>
            </div>
            {prizePool > 0 && (
              <div className="text-right">
                <div className="text-4xl font-black tabular-nums text-teal-400">
                  {money(prizePool)}
                </div>
                <div className="text-xs uppercase tracking-[0.14em] text-white/45">
                  Season prize pool
                </div>
              </div>
            )}
          </div>

          <div className="mt-10 overflow-x-auto">
            <table className="w-full min-w-[520px] border-collapse text-left">
              <thead>
                <tr className="border-b border-white/15 text-xs uppercase tracking-[0.14em] text-white/45">
                  <th className="pb-3 font-medium">Division</th>
                  <th className="pb-3 font-medium">Night</th>
                  <th className="pb-3 text-right font-medium">Nightly</th>
                  <th className="pb-3 text-right font-medium">Finals</th>
                  <th className="pb-3 text-right font-medium">Movement</th>
                </tr>
              </thead>
              <tbody>
                {divisions.map((d, i) => (
                  <tr key={d.id} className="border-b border-white/[0.07]">
                    <td className="py-4">
                      <span className="font-bold">{d.name}</span>
                      {i === 0 && (
                        <span className="ml-2 rounded-sm bg-teal-400/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-teal-300">
                          Top tier
                        </span>
                      )}
                    </td>
                    <td className="py-4 text-white/60">
                      {d.day_of_week != null
                        ? ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'][d.day_of_week]
                        : 'TBD'}
                      {d.start_time && (
                        <span className="text-white/40"> · {d.start_time.slice(0, 5)}</span>
                      )}
                    </td>
                    <td className="py-4 text-right tabular-nums">{money(d.nightly_prize_cents)}</td>
                    <td className="py-4 text-right tabular-nums">{money(d.finals_prize_cents)}</td>
                    <td className="py-4 text-right text-sm text-white/55">
                      {i === 0
                        ? 'Bottom drops'
                        : i === divisions.length - 1
                          ? 'Top climbs'
                          : 'Up and down'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="mt-6 max-w-2xl text-sm leading-relaxed text-white/45">
            The pool is self-funding. At {money(season.entry_cents)} a player, a full field covers
            the prize money and still leaves a surplus — so the stakes cost the section nothing.
          </p>
        </div>
      </section>

      {/* ---------- standings snapshot, only once there is one ---------- */}
      {standings && divisions.length > 0 && (
        <section className="mx-auto max-w-6xl px-5 py-20">
          <div className="flex items-end justify-between gap-4">
            <h2 className="text-3xl font-black tracking-tight sm:text-4xl">Where it stands</h2>
            <Link
              href={`/ptl/standings?season=${season.slug}`}
              className="shrink-0 text-sm font-semibold text-teal-400 hover:text-teal-300"
            >
              Full tables →
            </Link>
          </div>

          <div className="mt-10 grid gap-8 md:grid-cols-3">
            {divisions.map((d) => {
              const table = (standings.get(d.id) || []).slice(0, 4);
              return (
                <div key={d.id}>
                  <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-teal-400">
                    {d.name}
                  </h3>
                  {table.length === 0 ? (
                    <p className="mt-4 text-sm text-white/40">No results yet.</p>
                  ) : (
                    <ol className="mt-4 space-y-px">
                      {table.map((row) => (
                        <li
                          key={row.teamId}
                          className="flex items-baseline gap-3 border-b border-white/[0.07] py-2.5"
                        >
                          <span className="w-7 shrink-0 text-sm tabular-nums text-white/40">
                            {row.rankLabel}
                          </span>
                          <span className="min-w-0 flex-1 truncate font-semibold">{row.name}</span>
                          <span className="shrink-0 text-sm tabular-nums text-white/60">
                            {row.won}&ndash;{row.lost}
                          </span>
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* ---------- the problem ---------- */}
      <section className="border-t border-white/10">
        <div className="mx-auto max-w-6xl px-5 py-20">
          <h2 className="max-w-2xl text-balance text-3xl font-black tracking-tight sm:text-4xl">
            Our strongest players have been squeezed out.
          </h2>
          <p className="mt-4 max-w-2xl leading-relaxed text-white/60">
            League has no depth at 5.0 and above, so teams can&rsquo;t be fielded. Tournaments have
            turned expensive and devour entire weekends. So good players walk away from USTA
            entirely. Each of those is a design problem, and each one has an answer.
          </p>

          <dl className="mt-12 grid gap-x-12 gap-y-8 sm:grid-cols-2">
            {PROBLEMS.map((p) => (
              <div key={p.gone} className="border-l-2 border-teal-400/50 pl-5">
                <dt className="font-bold text-white/45 line-through decoration-white/25">
                  {p.gone}
                </dt>
                <dd className="mt-2 leading-relaxed text-white/80">{p.fix}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* ---------- closing CTA ---------- */}
      <section className="border-t border-white/10 bg-white/[0.02]">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-8 px-5 py-16">
          <div>
            <h2 className="text-2xl font-black tracking-tight sm:text-3xl">
              {enrolling ? 'Enrolment is open.' : `${season.name} is under way.`}
            </h2>
            <p className="mt-2 max-w-lg text-white/60">
              {enrolling
                ? 'Enroll as an individual. Captains draft the teams, and you\'ll know yours the night of the draft.'
                : 'Follow the season, or ask the commissioner about the next one.'}
            </p>
          </div>
          <Link
            href={enrolling ? `/ptl/enroll?season=${season.slug}` : `/ptl/standings?season=${season.slug}`}
            className="rounded-sm bg-teal-400 px-8 py-4 text-base font-bold tracking-wide text-[#06231F] transition-colors hover:bg-teal-300"
          >
            {enrolling ? `Enroll for ${money(season.entry_cents)}` : 'See the standings'}
          </Link>
        </div>
      </section>
    </>
  );
}
