import { describe, it, expect } from 'vitest';
import { mergeValuesFor } from './compose';
import {
  depersonalize,
  isProtectedTemplate,
  personalLeaks,
  templateFromDraft,
  templateSlugFrom,
  PROTECTED_TEMPLATE_SLUGS,
} from './templates';
import type { Contact, Org } from './types';

/**
 * The bug being tested for is a real one from another product: an edited card
 * was saved as a template with the recipient's name still in it, and every
 * email afterwards opened "Victor,". Both halves of the fix are here — the
 * substitution that prevents the common case, and the refusal that catches
 * what the substitution cannot fix.
 */

const ORG = {
  id: 'o1',
  name: 'Rossmoor Tennis Club',
  demo_url: 'https://clubmode.ai/demo/abc',
  next_step: 'Warm intro',
} as Org;

const CONTACT = {
  id: 'c1',
  org_id: 'o1',
  full_name: 'Mary Benin',
  email: 'mary.benin@example-not-real.test',
  do_not_contact: false,
} as Contact;

const REP = 'Darrin Cohen';
// mergeValuesFor renders rep_name as the founding-team signer now (no personal
// name goes out), so the letters under test sign the same way.
const VALUES = mergeValuesFor(ORG, CONTACT, REP);
const SIGNER = VALUES.rep_name;

describe('depersonalize', () => {
  it('puts the first name, the club and the rep back as merge fields', () => {
    const draft =
      `Hi Mary,\n\nI would rather show you Rossmoor Tennis Club than describe it.\n\n${SIGNER}`;
    expect(depersonalize(draft, VALUES)).toBe(
      'Hi {{first_name}},\n\nI would rather show you {{club}} than describe it.\n\n{{rep_name}}',
    );
  });

  it('is case-insensitive and survives a possessive', () => {
    const draft = "MARY — rossmoor tennis club's courts are the point.";
    expect(depersonalize(draft, VALUES)).toBe("{{first_name}} — {{club}}'s courts are the point.");
  });

  it('does not eat a name that is only part of a longer word', () => {
    // "Marylebone" is not Mary. A \b-less replace would make it
    // "{{first_name}}lebone", which is the other way to ruin a template.
    expect(depersonalize('Marylebone Cricket Club', VALUES)).toBe('Marylebone Cricket Club');
  });

  it('replaces the longest value first, so the rep name is not half-eaten', () => {
    // The rep is Darrin Cohen and the CONTACT is also called Darrin. The rep's
    // full name must come out whole as {{rep_name}}, not "{{first_name}} Cohen".
    // Values handed in directly: the point is longest-value-first, and a signer
    // whose name starts with the contact's first name is the shape that breaks it.
    const values = { ...VALUES, first_name: 'Darrin', rep_name: 'Darrin Cohen' };
    expect(depersonalize('Thanks,\nDarrin Cohen', values)).toBe('Thanks,\n{{rep_name}}');
  });

  it('leaves a draft that is already generic alone', () => {
    const generic = 'Hi {{first_name}},\n\nWorth 15 minutes for {{club}}?\n\n{{rep_name}}';
    expect(depersonalize(generic, VALUES)).toBe(generic);
  });
});

describe('personalLeaks', () => {
  it('finds a surviving last name', () => {
    const leaks = personalLeaks(
      { subject: 'A question', body: 'Hi {{first_name}} Benin,' },
      ORG,
      CONTACT,
    );
    expect(leaks).toHaveLength(1);
    expect(leaks[0].found).toBe('Benin');
    expect(leaks[0].what).toContain('last name');
    expect(leaks[0].where).toBe('the message');
  });

  it('finds an email address', () => {
    const leaks = personalLeaks(
      { subject: 'Hi', body: 'Reply to mary.benin@example-not-real.test if that works.' },
      ORG,
      CONTACT,
    );
    expect(leaks.some((l) => l.what.includes('email'))).toBe(true);
  });

  it('says nothing about a clean template', () => {
    expect(
      personalLeaks(
        { subject: 'A question about {{club}}', body: 'Hi {{first_name}},\n\n{{rep_name}}' },
        ORG,
        CONTACT,
      ),
    ).toEqual([]);
  });
});

describe('templateFromDraft', () => {
  it('accepts an ordinary edited draft and hands back the generalised text', () => {
    const out = templateFromDraft(
      {
        subject: 'A question about Rossmoor Tennis Club',
        body: `Hi Mary,\n\nWorth 15 minutes?\n\n${SIGNER}`,
      },
      VALUES,
      ORG,
      CONTACT,
    );
    expect(out.ok).toBe(true);
    expect(out.template.subject).toBe('A question about {{club}}');
    expect(out.template.body).toBe('Hi {{first_name}},\n\nWorth 15 minutes?\n\n{{rep_name}}');
  });

  /* ------------------------------------------------- the important refusal */
  it('REFUSES when a name survives, and says exactly what it found', () => {
    const out = templateFromDraft(
      { subject: 'Following up', body: 'Hi Mary Benin,\n\nWorth 15 minutes?' },
      VALUES,
      ORG,
      CONTACT,
    );
    expect(out.ok).toBe(false);
    if (out.ok) throw new Error('unreachable');
    expect(out.message).toContain('Benin');
    expect(out.message).toContain('last name');
    // It does NOT silently repair it — the half-cleaned text comes back for a
    // human to finish, and nothing has been saved.
    expect(out.template.body).toBe('Hi {{first_name}} Benin,\n\nWorth 15 minutes?');
  });

  it('refuses a club name that the un-merge could not reach', () => {
    // A rep typed the club's name slightly differently, so the substitution
    // did not match it. Wait — it DOES match here, which is the point of the
    // next case; this one uses a second club's real name to prove that a
    // leak in the SUBJECT is caught too.
    const out = templateFromDraft(
      { subject: 'Rossmoor Tennis Club — one question', body: 'Hi {{first_name}},' },
      { ...VALUES, club: '' }, // nothing to substitute with
      ORG,
      CONTACT,
    );
    expect(out.ok).toBe(false);
    if (out.ok) throw new Error('unreachable');
    expect(out.leaks[0].where).toBe('subject');
    expect(out.leaks[0].what).toContain("club's name");
  });
});

describe('the templates the outreach deck needs', () => {
  it('names both of them', () => {
    expect([...PROTECTED_TEMPLATE_SLUGS]).toEqual(['outreach-intro', 'outreach-followup']);
  });

  it('protects them however they are spelled', () => {
    expect(isProtectedTemplate('outreach-intro')).toBe(true);
    expect(isProtectedTemplate('OUTREACH-FOLLOWUP')).toBe(true);
  });

  it('protects nothing else', () => {
    for (const slug of ['intro-warm', 'follow-up-no-reply', 'send-the-demo', 'outreach', '', null]) {
      expect(isProtectedTemplate(slug)).toBe(false);
    }
  });
});

describe('templateSlugFrom', () => {
  it('turns a typed name into a slug', () => {
    expect(templateSlugFrom('Board meeting ask')).toBe('board-meeting-ask');
    expect(templateSlugFrom("Mary's follow-up!!")).toBe('mary-s-follow-up');
  });
  it('never returns an empty slug', () => {
    expect(templateSlugFrom('???')).toBe('template');
  });
});
