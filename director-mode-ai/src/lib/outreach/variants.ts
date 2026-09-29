/**
 * The cold letters the autopilot split-tests.
 *
 * Fixed text on purpose, not a model draft per club: an A/B test only means
 * something when every A is the same letter, and both are Darrin's own wording
 * (A is the Rossmoor letter of 9/22, B is his MixerMode reply to Hal Kushins),
 * lightly generalised. His voice rule stands: no em dashes, nothing that reads
 * like a campaign.
 *
 *   A  the whole platform, links the sample club's tour
 *   B  one tool that sits alongside whatever they use now, links the sample
 *      club's live mixer. Hal's "already using software" is the answer most
 *      established clubs will give A; B is built to survive it.
 *   C  Benchmarks for the director personally ("Know Your Number"), links the
 *      sample club's comp score page. DIRECTORS AND HEAD PROS ONLY, at their
 *      own address (canBeSentC): a GM or board president sets the director's
 *      pay, and a club info@ inbox may be read by exactly those people.
 *
 * The link is a real URL merged in by code. The sample club is invented and
 * says so on its first screen, so nobody mistakes it for a club we run.
 */

import { firstNameOf } from '@/lib/crm/compose';
import { PRODUCT_COUNT } from '@/config/nav';

/**
 * T1..T12: the one-tool letters from the "12 Templates 9.26.26" Google Doc
 * (Gemini drafts), loaded 9/29/26. Each opens on one tool and links that
 * tool's page in the sample club. Corrected where the draft named a product we
 * don't have or described one wrong: "CoachMode" lessons are LessonMode,
 * "RecruitingMode" is Recruiting (matching pros with clubs, not an applicant
 * tracker), "ClubHub" is unlinked so T11 shows My Tennis, and the T2 schedule
 * is CourtSheet with CalendarMode for the year. Em dashes out, per his rule.
 */
export type Variant = 'A' | 'B' | 'C' | 'T1' | 'T2' | 'T3' | 'T4' | 'T5' | 'T6' | 'T7' | 'T8' | 'T9' | 'T10' | 'T11' | 'T12';
export const VARIANTS: readonly Variant[] = ['A', 'B', 'C', 'T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8', 'T9', 'T10', 'T11', 'T12'];

export const VARIANT_LABEL: Record<Variant, string> = {
  A: 'A: the whole platform',
  B: 'B: one tool (MixerMode) alongside what they use',
  C: 'C: Benchmarks, for the director personally',
  T1: 'T1: CourtConnect, members find games',
  T2: 'T2: CourtSheet + CalendarMode, scheduling',
  T3: 'T3: LeagueMode, leagues and ladders',
  T4: 'T4: TournamentMode, draws on phones',
  T5: 'T5: LessonMode, pros and lessons',
  T6: 'T6: StringingMode, the stringing queue',
  T7: 'T7: CaptainMode, team captains',
  T8: 'T8: PlayerVault, player profiles',
  T9: 'T9: MixerMode, pickleball open play',
  T10: 'T10: Recruiting, hiring pros',
  T11: 'T11: My Tennis, the member home',
  T12: 'T12: all the tools',
};

/** Where each one-tool letter lands in the sample club, and as whom. */
const TOOL_PAGE: Partial<Record<Variant, { next: string; as?: 'member' | 'director' }>> = {
  T1: { next: '/run/members/courtconnect' },
  T2: { next: '/courtsheet/staff' },
  T3: { next: '/mixer/leagues' },
  T4: { next: '/mixer/tournaments' },
  T5: { next: '/open/harbor-view-racquet-club', as: 'member' },
  T6: { next: '/stringing/jobs' },
  T7: { next: '/captain' },
  T8: { next: '/courtconnect/vault' },
  T10: { next: '/connect' },
  T11: { next: '/member', as: 'member' },
  T12: { next: '/tools' },
};

/** Racquet directors and head pros: the only people letter C may go to. */
const DIRECTOR_TITLE = /\b(director of (tennis|racquets?|racket sports|pickleball|paddle)|(tennis|racquets?|pickleball) (sports )?director|head (tennis |racquets? )?pro(fessional)?|director of racquet sports|racquet sports director)\b/i;
const SHARED_LOCAL = /^(info|office|admin|administration|contact|hello|frontdesk|front\.?desk|reception|membership|members|events|mail|general|club|tennis|pro\.?shop|proshop|manager|gm|staff|inquiries|enquiries|team|play)$/i;

/**
 * `knownDirector`: the contact is a racquet director by where we got them,
 * not by a title field. The Directors Club of America roster IS directors, and
 * its import carries no titles at all (703 of 703 null on 9/24/26).
 */
export function canBeSentC(contact: { title: string | null; email: string }, opts: { knownDirector?: boolean } = {}): boolean {
  const local = (contact.email.split('@')[0] ?? '').toLowerCase();
  if (SHARED_LOCAL.test(local)) return false;
  return opts.knownDirector === true || DIRECTOR_TITLE.test(contact.title ?? '');
}

interface Letter {
  subject: (club: string) => string;
  body: (v: { first: string; club: string; link: string; tools: string | null }) => string;
}

/** The small last line every intro ends on: every tool, same sample club. */
const toolsLine = (tools: string | null) => (tools ? [`Every tool we've built, in the same sample club: ${tools}`] : []);

const INTRO: Record<'A' | 'B' | 'C', Letter> = {
  A: {
    subject: (club) => `Something we built for clubs like ${club}`,
    body: ({ first, club, link, tools }) =>
      [
        `Hi ${first},`,
        `We believe the club software we've been hard at work building the past couple of years would make things easier for the members at ${club} and for the people who run it.`,
        `There's a sample club set up so you can look around instead of reading a pitch. No login, nothing to install.`,
        link,
        `Members can find a game at their level on their own with CourtConnect, and MixerMode makes your events a breeze to run.`,
        `If you'd like us to set up a demo just for ${club}, reply to this email and we'd be happy to put one together.`,
        ...toolsLine(tools),
      ].join('\n\n'),
  },
  C: {
    // Darrin's own wording (9/24/26): em dash swapped for a comma, "I" made "we" to match the Founding Team signature.
    subject: () => `We've been building something for club directors`,
    body: ({ first, link, tools }) =>
      [
        `Hi ${first},`,
        `We wanted to send you something we just built for club directors and pros.`,
        `It's called Benchmarks. We pulled compensation information from clubs' public IRS filings and turned it into a simple way to see where you fall relative to other clubs.`,
        `Here's a sample, no login needed:`,
        link,
        `We've actually built 17 different tools like this for club directors and pros. We're still figuring out which ones are genuinely useful, so we'd love to get your take if you have a few minutes to poke around.`,
        ...(tools ? [`Here's the full collection:`, tools] : []),
        `Would be great to hear what you think.`,
      ].join('\n\n'),
  },
  B: {
    subject: (club) => `Mixers at ${club}`,
    body: ({ first, club, link, tools }) =>
      [
        `Hi ${first},`,
        `We're not looking to replace the software ${club} uses today. We just want to make your life easier.`,
        `We're ClubMode. We've built 17 tools for racquet sports directors, and one of them is MixerMode, which makes mixers easier to organize and easier for members to take part in. Partners, courts and rotations get drawn for you, and every player sees their next match on their phone.`,
        `Here's a mixer running at a sample club, no login:`,
        link,
        `If it's not useful, no harm done. But we'd love to get your reaction.`,
        ...toolsLine(tools),
      ].join('\n\n'),
  },
};

const N = PRODUCT_COUNT;

/**
 * The shape every T letter shares: pitch, "here it is" line, the link, a
 * soft close, then the every-tool link with the letter's own wording. T12's
 * link IS the every-tool page, so it has no last line.
 */
function oneTool(subject: (club: string) => string, lines: (club: string) => { pitch: string; here: string; close: string; toolsLead: string | null }): Letter {
  return {
    subject,
    body: ({ first, club, link, tools }) => {
      const l = lines(club);
      return [
        `Hi ${first},`,
        l.pitch,
        l.here,
        link,
        l.close,
        ...(tools && l.toolsLead ? [`${l.toolsLead} ${tools}`] : []),
      ].join('\n\n');
    },
  };
}

const ONE_TOOL: Partial<Record<Variant, Letter>> = {
  T1: oneTool((club) => `Finding games at ${club}`, (club) => ({
    pitch: `We built a tool called CourtConnect to help members at ${club} find matches at their level on their own, without staff coordinating text chains or keeping lists by hand.`,
    here: `Here's how it works in a sample club, no login required:`,
    close: `It's one of ${N} tools we've built for racquet sports directors. If it looks like something that could save your team time, we'd love to hear your thoughts.`,
    toolsLead: `Every tool we've built:`,
  })),
  T2: oneTool((club) => `Running court schedules at ${club}`, (club) => ({
    pitch: `We know how chaotic court sheets, clinics and private lessons get across more than one racquet sport. We built CourtSheet so you can see every court for the day on one screen, with CalendarMode behind it for planning the whole year.`,
    here: `Take a look around a sample club, no sign-in or install needed:`,
    close: `We're not asking you to take on a big software overhaul, just building practical tools for directors. We'd love to know if this hits the mark for ${club}.`,
    toolsLead: `Explore all ${N} tools:`,
  })),
  T3: oneTool((club) => `League play at ${club}`, () => ({
    pitch: `Running internal leagues and ladders usually means endless spreadsheets and chasing scores. We built LeagueMode to handle the standings, schedules and score reporting for you.`,
    here: `You can test drive it in a sample club here, no login required:`,
    close: `We've built ${N} tools for directors of racquet sports. If it saves you a few hours a week, we'd love to get your feedback.`,
    toolsLead: `The full collection:`,
  })),
  T4: oneTool((club) => `Tournament ops for ${club}`, () => ({
    pitch: `Running a tournament often comes down to juggling brackets, court assignments and keeping players updated. We built TournamentMode so draws and court assignments update live on players' phones.`,
    here: `Check out a demo draw, no login needed:`,
    close: `We're giving directors a way to run events without the extra clutter. Let us know what you think if you get a chance to poke around.`,
    toolsLead: `All ${N} tools in one place:`,
  })),
  T5: oneTool((club) => `Private lessons and pros at ${club}`, () => ({
    pitch: `Keeping track of teaching pros' schedules, private lesson bookings and court use gets messy fast. We built LessonMode so your pros' open lesson times are in one clean view that members can book from.`,
    here: `Here's a sample setup you can click right into, no login:`,
    close: `It's part of a set of ${N} tools we built for racquet sports operations. We'd love to get your take on it.`,
    toolsLead: `See all the tools:`,
  })),
  T6: oneTool((club) => `Stringing workflow at ${club}`, () => ({
    pitch: `Keeping track of stringing requests, tension preferences and pick-up notices usually runs on paper tags or text messages. We built StringingMode to put the pro shop's stringing queue in one place.`,
    here: `Take a look at how it works in a sample club, no login:`,
    close: `We're building small, focused tools that make daily shop work easier. We'd appreciate hearing your reaction.`,
    toolsLead: `The full set of ${N} tools:`,
  })),
  T7: oneTool((club) => `Helping team captains at ${club}`, (club) => ({
    pitch: `Helping team captains with lineups, availability and match scheduling takes a lot of a director's time. We built CaptainMode to give your captains an easy way to organize rosters and lines themselves.`,
    here: `Here's a demo running in a sample club, no sign-in required:`,
    close: `It's one of ${N} tools we've built for club directors. If it looks useful for ${club}, we'd love your thoughts.`,
    toolsLead: `Check out the whole collection:`,
  })),
  T8: oneTool((club) => `Player history and ratings at ${club}`, () => ({
    pitch: `One place for player ratings, match history and who has played in what makes member engagement much simpler. We built PlayerVault to give directors that view of every player.`,
    here: `You can check it out in a sample club, no login:`,
    close: `We built it for racquet sports directors to keep member info organized without bloated software. Let us know if you find it helpful.`,
    toolsLead: `View all ${N} tools:`,
  })),
  T9: oneTool((club) => `Pickleball mixers at ${club}`, () => ({
    pitch: `Pickleball open play and mixers with mixed skill levels often turn into chaos at the whiteboard. We built MixerMode so court rotations, partners and scores happen automatically on players' phones.`,
    here: `Here's a mixer running in a sample club, no login:`,
    close: `We're not looking to replace your club management system, just offering light tools that fix everyday headaches. We'd love to get your take.`,
    toolsLead: `Explore all ${N} tools:`,
  })),
  T10: oneTool((club) => `Staffing and pro hiring at ${club}`, () => ({
    pitch: `Finding qualified teaching pros and staff for tennis and pickleball programs is one of the hardest parts of running a facility. We built Recruiting to match clubs that are hiring with pros looking for their next job.`,
    here: `See how it works from our sample club, no login needed:`,
    close: `It's part of our collection of ${N} tools for racquet directors. If you have a few minutes to look, we'd love to hear your thoughts.`,
    toolsLead: `See all the tools:`,
  })),
  T11: oneTool((club) => `Member experience at ${club}`, () => ({
    pitch: `Members don't love clicking through multi-step portals just to see their matches, lessons or upcoming events. We built My Tennis to give each member one clean screen on their phone for everything they're in.`,
    here: `Try it from the member's side in a sample club, no login:`,
    close: `We built it to make things easier for directors and pros alike. If you're open to taking a look, we'd appreciate your feedback.`,
    toolsLead: `The full set of ${N} tools:`,
  })),
  T12: oneTool((club) => `Something we built for clubs like ${club}`, (club) => ({
    pitch: `We've spent the last couple of years building ${N} tools for directors of racquet sports, covering court scheduling, mixers, compensation benchmarks and player matching.`,
    here: `Rather than send a long pitch, we set up a sample club so you can try any tool right away, no login and nothing to install:`,
    close: `We're still working out which tools matter most to directors. If any of them look useful for ${club}, we'd love to hear your thoughts.`,
    toolsLead: null,
  })),
};

const FOLLOW_UP: Letter = {
  subject: (club) => `Re: ${club}`,
  body: ({ first, club, link }) =>
    [
      `Hi ${first},`,
      `One more note and then we'll leave you be.`,
      `The sample club is still up if you'd like to click around:`,
      link,
      `If you'd like us to set up a demo just for ${club}, reply to this email and we'd be happy to put one together.`,
    ].join('\n\n'),
};

export interface Links {
  demo_url: string | null;
  mixer_url: string | null;
}

/** A page inside the sample club, signed in as its director. */
function sampleLink(links: Links, next: string, ref?: string | null, as: 'member' | 'director' = 'director'): string | null {
  if (!links.demo_url) return null;
  const u = new URL(links.demo_url.replace(/\/$/, '') + '/enter');
  u.searchParams.set('as', as);
  u.searchParams.set('next', next);
  if (ref) u.searchParams.set('r', ref);
  return u.toString();
}

/** The link a variant sends. B and T9 fall back to the tour if the mixer is not set. */
export function linkFor(variant: Variant, links: Links, ref?: string | null): string | null {
  if (variant === 'C') return sampleLink(links, '/benchmarks/score', ref);
  const page = TOOL_PAGE[variant];
  if (page) return sampleLink(links, page.next, ref, page.as);
  const base = variant === 'B' || variant === 'T9' ? links.mixer_url || links.demo_url : links.demo_url;
  if (!base || !ref) return base;
  // ?r= is how a visit is tied back to this letter (demo_visits.ref).
  const u = new URL(base);
  u.searchParams.set('r', ref);
  return u.toString();
}

/**
 * The "every tool" link: the sample club's All tools page, signed in as its
 * director. Built from the tour URL, so there is one demo link to change.
 */
export function toolsLinkFor(links: Links, ref?: string | null): string | null {
  return sampleLink(links, '/tools', ref);
}

/** A short, unguessable-enough code for one letter's link. */
export function newRef(): string {
  const a = 'abcdefghijkmnpqrstuvwxyz23456789';
  let out = '';
  for (let i = 0; i < 10; i++) out += a[Math.floor(Math.random() * a.length)];
  return out;
}

export function renderLetter(
  kind: 'intro' | 'followup',
  variant: Variant,
  facts: { club: string; fullName: string },
  links: Links,
  ref?: string | null,
): { subject: string; body: string } | null {
  const link = linkFor(variant, links, ref);
  if (!link) return null;
  const first = firstNameOf(facts.fullName) || facts.fullName;
  const letter = kind === 'followup' ? FOLLOW_UP : (ONE_TOOL[variant] ?? INTRO[variant as 'A' | 'B' | 'C']);
  const tools = kind === 'intro' ? toolsLinkFor(links, ref) : null;
  return { subject: letter.subject(facts.club), body: letter.body({ first, club: facts.club, link, tools }) };
}

/**
 * Which letter the next club gets: whichever ALLOWED variant has gone out
 * least in this lane, so each lane stays balanced on its own. Ties go in
 * VARIANTS order. C is allowed only for a director at their own address.
 */
export function nextVariant(sentSoFar: Partial<Record<Variant, number>>, allowed: readonly Variant[] = ['A', 'B']): Variant {
  const pool = VARIANTS.filter((v) => allowed.includes(v));
  return pool.reduce((best, v) => ((sentSoFar[v] ?? 0) < (sentSoFar[best] ?? 0) ? v : best), pool[0] ?? 'A');
}

/**
 * The letters in rotation for one contact: every letter not paused on
 * /crm/autopilot, C only when it is switched on AND this contact may get it.
 * Everything paused falls back to A so a planned slot still has a letter.
 */
export function allowedVariants(opts: { paused: readonly string[]; cOn: boolean; cOk: boolean }): Variant[] {
  const out = VARIANTS.filter((v) => !opts.paused.includes(v) && (v !== 'C' || (opts.cOn && opts.cOk)));
  return out.length ? out : ['A'];
}

export function isVariant(v: unknown): v is Variant {
  return typeof v === 'string' && (VARIANTS as readonly string[]).includes(v);
}
