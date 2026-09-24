/**
 * /demo/<token> — the one link a prospect is sent.
 *
 * A tour of their own club on ClubMode, in their colors, for a reader who may
 * be 80 and has never seen the product: big type, plain words, obvious
 * buttons, and every tool one tap away. Public links go straight to the page;
 * anything that needs a login goes through /demo/<token>/enter, which signs
 * the browser into the link's demo member or demo staff login first.
 *
 * Generic per club. Everything specific — the club, its signs, its mixer, its
 * teams, what the staff login is called — is looked up at request time
 * (lib/demo/tour.ts, demo_links.director_label), and a card only appears when
 * the club actually has that thing. Nothing about any one club is written in
 * this file.
 */

import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { getLiveDemoLink, recordDemoVisit } from '@/lib/demo/server';
import { loadTour, type TourSign } from '@/lib/demo/tour';
import { readableOn, tint } from '@/lib/clubSite/theme';
import { withArticle, type DemoRole } from '@/lib/demo/nextPath';
import DemoExpired from '../DemoExpired';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type Props = { params: Promise<{ token: string }>; searchParams: Promise<{ trouble?: string; r?: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { token } = await params;
  const link = await getLiveDemoLink(token);
  return {
    title: link?.label ? `${link.label} demo — ClubMode` : 'Demo — ClubMode',
    robots: { index: false, follow: false },
  };
}

type Theme = { primary: string; secondary: string; ink: string; cream: string; surface: string; headingFamily: string };

/** A button-sized link, tagged with who you will be when it opens. */
function TryLink({
  href,
  children,
  who,
  theme,
  strong,
}: {
  href: string;
  children: React.ReactNode;
  who: string;
  theme: Theme;
  strong?: boolean;
}) {
  const bg = strong ? theme.primary : theme.surface;
  const fg = strong ? readableOn(theme.primary) : theme.ink;
  return (
    <a
      href={href}
      className="flex min-h-[56px] flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-2xl border-2 px-5 py-3 text-lg font-semibold leading-snug transition-transform hover:-translate-y-0.5"
      style={{ background: bg, color: fg, borderColor: strong ? theme.primary : tint(theme.ink, 0.18) }}
    >
      <span>{children}</span>
      <span
        className="shrink-0 rounded-full px-3 py-1 text-sm font-medium"
        style={{ background: strong ? tint('#ffffff', 0.18) : tint(theme.primary, 0.1), color: fg }}
      >
        {who}
      </span>
    </a>
  );
}

function Card({
  title,
  replaces,
  theme,
  children,
}: {
  title: string;
  replaces: string;
  theme: Theme;
  children: React.ReactNode;
}) {
  return (
    <section
      className="rounded-3xl border p-5 sm:p-7"
      style={{ background: theme.surface, borderColor: tint(theme.ink, 0.12) }}
    >
      <h3 className="text-2xl font-bold sm:text-[28px]" style={{ fontFamily: theme.headingFamily }}>
        {title}
      </h3>
      <p className="mt-2 text-lg leading-relaxed opacity-80">{replaces}</p>
      <div className="mt-5 grid gap-3">{children}</div>
    </section>
  );
}

function Sign({ sign, caption, theme }: { sign: TourSign; caption: string; theme: Theme }) {
  return (
    <figure
      className="flex flex-col items-center rounded-2xl border p-3 text-center sm:p-4"
      style={{ borderColor: tint(theme.ink, 0.15), background: '#ffffff', color: '#111' }}
    >
      <div className="text-lg font-bold sm:text-xl">{sign.name}</div>
      <div
        className="mt-2 w-full max-w-[220px] [&_svg]:block [&_svg]:h-auto [&_svg]:w-full"
        role="img"
        aria-label={`QR code for ${sign.name}`}
        dangerouslySetInnerHTML={{ __html: sign.svg }}
      />
      <figcaption className="mt-2 text-base leading-snug">{caption}</figcaption>
    </figure>
  );
}

export default async function DemoTourPage({ params, searchParams }: Props) {
  const { token } = await params;
  const { trouble, r } = await searchParams;
  const link = await getLiveDemoLink(token);
  if (!link) return <DemoExpired />;
  await recordDemoVisit(link.token, r ?? null, `/demo/${link.token}`, (await headers()).get('user-agent'));
  const tour = await loadTour(link);
  if (!tour) return <DemoExpired />;

  const { bundle, signs, mixer, captain } = tour;
  const { club, theme } = bundle;
  const onPrimary = readableOn(theme.primary);
  const enter = (as: DemoRole, next?: string) =>
    `/demo/${link.token}/enter?as=${as}${next ? `&next=${encodeURIComponent(next)}` : ''}`;

  const hasMember = !!link.member_user_id;
  const hasStaff = !!link.director_user_id;
  const staff = withArticle(link.director_label);
  const AS_MEMBER = 'As a member';
  const AS_STAFF = `As ${staff}`;
  const OPEN = 'No login';
  const member = tour.memberFirstName ? `${tour.memberFirstName}, a member` : 'a member';

  const steps: { text: string; href: string }[] = [];
  if (hasMember) {
    steps.push({ text: `Post a game in CourtConnect as ${member}.`, href: enter('member', '/member/games') });
  }
  if (signs.court) {
    steps.push({ text: `Scan the ${signs.court.name} sign below with your phone.`, href: `/q/${signs.court.token}` });
  }
  if (mixer) {
    steps.push({
      text: mixer.dateLabel ? `Open the ${mixer.dateLabel} round sheets.` : 'Open the round sheets.',
      href: `/event/${mixer.code}/print`,
    });
  }
  if (hasStaff && captain.highlight) {
    steps.push({ text: `Open ${captain.highlight.name} as ${staff}.`, href: enter('director', `/captain/${captain.highlight.id}`) });
  }

  return (
    <div
      style={{ background: theme.cream, color: theme.ink, fontFamily: theme.fontFamily, minHeight: '100vh' }}
      className="text-[18px] sm:text-[19px]"
    >
      <header style={{ background: theme.primary, color: onPrimary }}>
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-4 sm:px-6">
          {club.logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={club.logo_url} alt="" className="h-12 w-auto rounded bg-white/90 object-contain p-1" />
          ) : null}
          <span className="text-xl font-bold sm:text-2xl" style={{ fontFamily: theme.headingFamily }}>
            {club.name}
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 pb-16 sm:px-6">
        {/* ------------------------------------------------------------ hero */}
        <section className="py-10 sm:py-14">
          <h1
            className="text-[38px] font-bold leading-[1.08] sm:text-6xl"
            style={{ fontFamily: theme.headingFamily }}
          >
            See {club.name} on ClubMode
          </h1>
          <p className="mt-5 max-w-3xl text-xl leading-relaxed sm:text-2xl">
            {link.is_sample
              ? 'This is a sample club, filled with invented members. Tap anything you like: '
              : 'This is a working copy of your club, filled with invented members. Tap anything you like: '}
            you can look around the way a member sees it, or the way the people who run the club do.
          </p>
          {trouble && (
            <p className="mt-4 rounded-xl bg-amber-100 px-4 py-3 text-lg text-amber-900">
              That did not open. Please try the button again.
            </p>
          )}
          <div className="mt-8 grid gap-4 sm:grid-cols-2">
            {hasMember && (
              <a
                href={enter('member')}
                className="flex min-h-[72px] items-center justify-center rounded-2xl px-6 py-4 text-center text-xl font-bold shadow-md sm:text-2xl"
                style={{ background: theme.primary, color: onPrimary }}
              >
                Look around as a member
              </a>
            )}
            {hasStaff && (
              <a
                href={enter('director', captain.highlight ? '/captain' : undefined)}
                className="flex min-h-[72px] items-center justify-center rounded-2xl border-[3px] px-6 py-4 text-center text-xl font-bold sm:text-2xl"
                style={{ borderColor: theme.primary, color: theme.ink, background: theme.surface }}
              >
                Look around as {staff}
              </a>
            )}
          </div>
        </section>

        {/* ---------------------------------------------------- 5 minutes */}
        {steps.length > 0 && (
          <section
            className="rounded-3xl p-5 sm:p-8"
            style={{ background: tint(theme.secondary, 0.14), border: `2px solid ${tint(theme.secondary, 0.45)}` }}
          >
            <h2 className="text-3xl font-bold" style={{ fontFamily: theme.headingFamily }}>
              Try this in 5 minutes
            </h2>
            <ol className="mt-5 grid gap-3">
              {steps.map((s, i) => (
                <li key={s.href}>
                  <a
                    href={s.href}
                    className="flex min-h-[64px] items-center gap-4 rounded-2xl px-4 py-3 text-lg font-semibold leading-snug sm:text-xl"
                    style={{ background: theme.surface, color: theme.ink }}
                  >
                    <span
                      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-xl font-bold"
                      style={{ background: theme.primary, color: onPrimary }}
                    >
                      {i + 1}
                    </span>
                    <span>{s.text}</span>
                  </a>
                </li>
              ))}
            </ol>
          </section>
        )}

        {/* --------------------------------------------------------- tools */}
        <h2 className="mt-14 text-3xl font-bold sm:text-4xl" style={{ fontFamily: theme.headingFamily }}>
          What is in it
        </h2>
        <div className="mt-6 grid gap-5 md:grid-cols-2">
          <Card
            title="Club website"
            replaces={`Replaces the old ${tour.siteBuilder ? `${tour.siteBuilder} ` : 'website '}pages. Programs, courts, events and how to join, kept up to date from the same place you run the club.`}
            theme={theme}
          >
            <TryLink href={`/c/${club.slug}`} who={OPEN} theme={theme} strong>
              Open the club website
            </TryLink>
          </Card>

          {hasMember && (
            <Card
              title="CourtConnect"
              replaces="Find a game with members at your level. Replaces showing up and hoping: post “Doubles Tuesday at 9, need two,” and the right players hear about it."
              theme={theme}
            >
              <TryLink href={enter('member', '/member/games')} who={AS_MEMBER} theme={theme} strong>
                Post or join a game
              </TryLink>
              <TryLink href={`/c/${club.slug}/play`} who={OPEN} theme={theme}>
                See the open games
              </TryLink>
            </Card>
          )}

          {(signs.court || signs.waitList) && (
            <Card
              title="Court check-in"
              replaces="Replaces the paper court register. Players scan the sign on the court with their phone. No app and no password."
              theme={theme}
            >
              <div className="grid grid-cols-2 gap-3">
                {signs.court && <Sign sign={signs.court} caption="Point your phone camera here" theme={theme} />}
                {signs.waitList && <Sign sign={signs.waitList} caption="Courts busy? Join the line" theme={theme} />}
              </div>
              {signs.court && (
                <TryLink href={`/q/${signs.court.token}`} who={OPEN} theme={theme} strong>
                  No phone handy? Tap to open {signs.court.name}
                </TryLink>
              )}
              <TryLink href={`/checkin/${club.slug}/board`} who={OPEN} theme={theme}>
                The live board for the clubhouse TV
              </TryLink>
              {hasStaff && (
                <TryLink href={enter('director', '/run/checkin/signs')} who={AS_STAFF} theme={theme}>
                  Print the court signs
                </TryLink>
              )}
            </Card>
          )}

          {tour.courtCount > 0 && (
            <Card
              title="Court sheet"
              replaces="Replaces the court calendar on the wall. Clinics, drop-in and team matches hold their courts, and everyone sees what is free."
              theme={theme}
            >
              <TryLink href={`/courtsheet/${club.slug}`} who={OPEN} theme={theme} strong>
                See this week’s courts
              </TryLink>
              {hasStaff && (
                <TryLink href={enter('director', '/courtsheet/staff')} who={AS_STAFF} theme={theme}>
                  Block courts and move things around
                </TryLink>
              )}
            </Card>
          )}

          {tour.booking && (
            <Card
              title="Court booking"
              replaces="Replaces phoning the desk. Members and guests pick a court and a time, and it lands on the court sheet."
              theme={theme}
            >
              <TryLink href={`/c/${club.slug}/courts`} who={OPEN} theme={theme} strong>
                Book a court
              </TryLink>
            </Card>
          )}

          {mixer && (
            <Card
              title={mixer.name}
              replaces="Replaces the pairing spreadsheet. Partners, courts and rotations are drawn for you, and every player can see their own next match on their phone."
              theme={theme}
            >
              <TryLink href={`/event/${mixer.code}/print`} who={OPEN} theme={theme} strong>
                Round sheets, ready to print
              </TryLink>
              {mixer.player && (
                <TryLink href={`/event/${mixer.code}?me=${mixer.player.id}`} who={OPEN} theme={theme}>
                  {mixer.player.name}’s phone view
                </TryLink>
              )}
              {mixer.publicSlug && (
                <TryLink href={`/events/${mixer.publicSlug}`} who={OPEN} theme={theme}>
                  The sign-up page
                </TryLink>
              )}
              {hasStaff && (
                <TryLink href={enter('director', `/mixer/events/${mixer.id}`)} who={AS_STAFF} theme={theme}>
                  Run the event
                </TryLink>
              )}
            </Card>
          )}

          {hasStaff && captain.teamCount > 0 && (
            <Card
              title="Captain teams"
              replaces="Replaces reply-all email chains. Players tap Yes or No for each match, and the captain sets the lineup from the answers."
              theme={theme}
            >
              <TryLink href={enter('director', '/captain')} who={AS_STAFF} theme={theme} strong>
                Open the teams
              </TryLink>
              {captain.memberAvailabilityToken && (
                <TryLink href={`/captain/availability/${captain.memberAvailabilityToken}`} who={OPEN} theme={theme}>
                  What a player sees: “Can you play?”
                </TryLink>
              )}
            </Card>
          )}

          {(tour.calendarYear || hasMember) && (
            <Card
              title="Calendar and events"
              replaces="Replaces the newsletter calendar. Socials, tournaments and team matches in one place members can check any time."
              theme={theme}
            >
              {tour.calendarYear && (
                <TryLink href={`/calendar/${club.slug}?year=${tour.calendarYear}`} who={OPEN} theme={theme} strong>
                  The club calendar
                </TryLink>
              )}
              {hasMember && (
                <TryLink href={enter('member')} who={AS_MEMBER} theme={theme} strong={!tour.calendarYear}>
                  A member’s home page
                </TryLink>
              )}
            </Card>
          )}

          {hasStaff && (
            <Card
              title={tour.siteBuilder ? `Add to your ${tour.siteBuilder} site` : 'Add to your current website'}
              replaces="Keep the website you have. Paste one snippet and the games board, court sheet or calendar shows up right inside it."
              theme={theme}
            >
              <TryLink href={enter('director', '/run/site/embed')} who={AS_STAFF} theme={theme} strong>
                Get the snippet
              </TryLink>
            </Card>
          )}
        </div>
      </main>

      <footer style={{ background: theme.ink, color: '#ffffff' }}>
        <div className="mx-auto max-w-5xl px-4 py-10 text-lg leading-relaxed sm:px-6">
          This is a demo with invented members. Nothing you do here emails anyone. It resets every night.
        </div>
      </footer>
    </div>
  );
}
