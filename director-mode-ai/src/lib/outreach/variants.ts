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

export type Variant = 'A' | 'B' | 'C';
export const VARIANTS: readonly Variant[] = ['A', 'B', 'C'];

export const VARIANT_LABEL: Record<Variant, string> = {
  A: 'A: the whole platform',
  B: 'B: one tool (MixerMode) alongside what they use',
  C: 'C: Benchmarks, for the director personally',
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

const INTRO: Record<Variant, Letter> = {
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
    // Darrin's own wording (9/24/26), em dash swapped for a comma.
    subject: () => `We've been building something for club directors`,
    body: ({ first, link, tools }) =>
      [
        `Hi ${first},`,
        `I wanted to send you something we just built for club directors and pros.`,
        `It's called Benchmarks. We pulled compensation information from clubs' public IRS filings and turned it into a simple way to see where you fall relative to other clubs.`,
        `Here's a sample, no login needed:`,
        link,
        `We've actually built 17 different tools like this for club directors and pros. We're still figuring out which ones are genuinely useful, so I'd love to get your take if you have a few minutes to poke around.`,
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
function sampleLink(links: Links, next: string, ref?: string | null): string | null {
  if (!links.demo_url) return null;
  const u = new URL(links.demo_url.replace(/\/$/, '') + '/enter');
  u.searchParams.set('as', 'director');
  u.searchParams.set('next', next);
  if (ref) u.searchParams.set('r', ref);
  return u.toString();
}

/** The link a variant sends. B falls back to the tour if the mixer is not set. */
export function linkFor(variant: Variant, links: Links, ref?: string | null): string | null {
  if (variant === 'C') return sampleLink(links, '/benchmarks/score', ref);
  const base = variant === 'B' ? links.mixer_url || links.demo_url : links.demo_url;
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
  const letter = kind === 'followup' ? FOLLOW_UP : INTRO[variant];
  const tools = kind === 'intro' ? toolsLinkFor(links, ref) : null;
  return { subject: letter.subject(facts.club), body: letter.body({ first, club: facts.club, link, tools }) };
}

/**
 * Which letter the next club gets: whichever ALLOWED variant has gone out
 * least in this lane, so each lane stays balanced on its own. Ties go in
 * A, B, C order. C is allowed only for a director at their own address.
 */
export function nextVariant(sentSoFar: Partial<Record<Variant, number>>, allowed: readonly Variant[] = ['A', 'B']): Variant {
  const pool = VARIANTS.filter((v) => allowed.includes(v));
  return pool.reduce((best, v) => ((sentSoFar[v] ?? 0) < (sentSoFar[best] ?? 0) ? v : best), pool[0] ?? 'A');
}
