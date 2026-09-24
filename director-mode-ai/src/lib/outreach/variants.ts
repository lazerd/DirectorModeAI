/**
 * The two cold letters the autopilot split-tests.
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
 *
 * The link is a real URL merged in by code. The sample club is invented and
 * says so on its first screen, so nobody mistakes it for a club we run.
 */

import { firstNameOf } from '@/lib/crm/compose';

export type Variant = 'A' | 'B';
export const VARIANTS: readonly Variant[] = ['A', 'B'];

export const VARIANT_LABEL: Record<Variant, string> = {
  A: 'A: the whole platform',
  B: 'B: one tool (MixerMode) alongside what they use',
};

interface Letter {
  subject: (club: string) => string;
  body: (v: { first: string; club: string; link: string; tools: string | null }) => string;
}

/** The small last line both intros end on: every tool, same sample club. */
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
        `If you like what you see, we'd be happy to set one up with ${club} already in it, at no cost.`,
        ...toolsLine(tools),
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
      `If you'd like one with ${club} in it, just reply and we'll set it up. No cost.`,
    ].join('\n\n'),
};

export interface Links {
  demo_url: string | null;
  mixer_url: string | null;
}

/** The link a variant sends. B falls back to the tour if the mixer is not set. */
export function linkFor(variant: Variant, links: Links, ref?: string | null): string | null {
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
  if (!links.demo_url) return null;
  const u = new URL(links.demo_url.replace(/\/$/, '') + '/enter');
  u.searchParams.set('as', 'director');
  u.searchParams.set('next', '/tools');
  if (ref) u.searchParams.set('r', ref);
  return u.toString();
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
 * Which letter the next club gets: whichever variant has gone out less in this
 * lane, so both lanes stay balanced on their own. Ties go to A.
 */
export function nextVariant(sentSoFar: Partial<Record<Variant, number>>): Variant {
  return (sentSoFar.B ?? 0) < (sentSoFar.A ?? 0) ? 'B' : 'A';
}
