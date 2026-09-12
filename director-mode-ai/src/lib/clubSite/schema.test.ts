import { describe, it, expect } from 'vitest';
import {
  clubSitePatchSchema,
  courtRateSchema,
  parseList,
  partnerLinkSchema,
  staffMemberSchema,
} from './schema';

/**
 * These columns are jsonb, so Postgres will never tell us the editor and the
 * renderer have drifted apart. This file is the only thing that will.
 */

describe('parseList', () => {
  it('keeps the good entries and drops only the bad one', () => {
    // A hand-seeded or older row must never blank a club's live website.
    const rows = parseList(staffMemberSchema, [
      { name: 'Hunter Gallaway', title: 'Director' },
      { title: 'No name at all' },
      { name: 'Second Pro' },
    ]);
    expect(rows.map((r) => r.name)).toEqual(['Hunter Gallaway', 'Second Pro']);
  });

  it('returns nothing for a column that is not an array', () => {
    for (const junk of [null, undefined, {}, 'staff', 7]) {
      expect(parseList(staffMemberSchema, junk)).toEqual([]);
    }
  });
});

describe('links a club pastes', () => {
  it('adds the scheme a director leaves off', () => {
    const r = partnerLinkSchema.parse({ name: 'Carmen', href: 'www.carmenpickle.com' });
    expect(r.href).toBe('https://www.carmenpickle.com/');
  });

  it('drops a javascript: URL instead of putting it in an anchor tag', () => {
    // eslint-disable-next-line no-script-url
    const r = partnerLinkSchema.parse({ name: 'Bad', href: 'javascript:alert(1)' });
    expect(r.href).toBeUndefined();
  });

  it('drops nonsense rather than failing the whole list', () => {
    const r = partnerLinkSchema.parse({ name: 'Ok', href: 'not a url at all' });
    // "not a url at all" becomes https://not%20a%20url%20at%20all — a dead
    // link, but a safe one, and the name still renders.
    expect(r.name).toBe('Ok');
  });

  it('keeps an empty link empty', () => {
    expect(partnerLinkSchema.parse({ name: 'Harriet', href: '' }).href).toBeUndefined();
  });
});

describe('court rates', () => {
  it('accepts zero as a real price — members play free', () => {
    const r = courtRateSchema.parse({ label: 'Members', member_cents: 0, public_cents: 2400 });
    expect(r.member_cents).toBe(0);
    expect(r.public_cents).toBe(2400);
  });

  it('allows a rate that only applies to one audience', () => {
    const r = courtRateSchema.parse({ label: 'Public', public_cents: 2400 });
    expect(r.member_cents).toBeUndefined();
  });

  it('refuses a negative price', () => {
    expect(courtRateSchema.safeParse({ label: 'Bad', public_cents: -100 }).success).toBe(false);
  });
});

describe('the site patch', () => {
  it('takes one field at a time, because the editor autosaves', () => {
    const r = clubSitePatchSchema.safeParse({ hero_headline: 'Nine lighted courts' });
    expect(r.success).toBe(true);
  });

  it('turns a cleared field into undefined so the route can null it', () => {
    const r = clubSitePatchSchema.parse({ hero_headline: '   ' });
    expect(r.hero_headline).toBeUndefined();
  });

  it('refuses a colour that is not a hex value', () => {
    expect(clubSitePatchSchema.safeParse({ color_primary: 'forest green' }).success).toBe(false);
    expect(clubSitePatchSchema.safeParse({ color_primary: '#14532d' }).success).toBe(true);
    expect(clubSitePatchSchema.safeParse({ color_primary: '#abc' }).success).toBe(true);
  });

  it('refuses a font nobody has installed', () => {
    expect(clubSitePatchSchema.safeParse({ font_choice: 'Comic Sans' }).success).toBe(false);
    expect(clubSitePatchSchema.safeParse({ font_choice: 'condensed' }).success).toBe(true);
  });

  it('rejects a key that is not a real column', () => {
    // .strict() — otherwise a typo silently saves nothing and looks like a bug.
    expect(clubSitePatchSchema.safeParse({ hero_headlne: 'typo' }).success).toBe(false);
  });

  it('caps a list so one club cannot publish a megabyte', () => {
    const tooMany = Array.from({ length: 40 }, (_, i) => ({ label: `Amenity ${i}` }));
    expect(clubSitePatchSchema.safeParse({ amenities: tooMany }).success).toBe(false);
  });

  it('defaults a membership tier includes list rather than leaving it undefined', () => {
    const r = clubSitePatchSchema.parse({
      membership_tiers: [{ name: 'Family', price_display: 'from $130' }],
    });
    expect(r.membership_tiers?.[0].includes).toEqual([]);
  });
});
