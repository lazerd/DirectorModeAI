import { describe, it, expect } from 'vitest';
import {
  SECTIONS, FOR_PLAYERS, FOR_YOU, PRODUCTS, PRODUCT_COUNT,
  ALL_CLUB_TOOLS, ALL_TOOLS_ITEM, sectionOf, activeHref,
} from './nav';

/**
 * These tests exist because four places in the app used to state how many tools
 * ClubMode has and no two agreed: the hero said 9, the toolkit grid rendered 9,
 * the nav listed 18, and the real answer was 15.
 *
 * The fix was to derive everything from PRODUCTS. These tests are the thing that
 * keeps it derived — they fail if someone reintroduces a hand-written count or
 * quietly adds a product that no surface can render.
 */

describe('the canonical product list', () => {
  it('is the single source of the count', () => {
    expect(PRODUCT_COUNT).toBe(PRODUCTS.length);
  });

  it('has 15 products — the number the audit landed on', () => {
    // If this fails because you genuinely added a tool, update the number AND
    // check the hero counter still reads it from PRODUCT_COUNT rather than a
    // literal. If it fails for any other reason, something drifted.
    expect(PRODUCT_COUNT).toBe(15);
  });

  it('counts only entries explicitly flagged as products', () => {
    expect(PRODUCTS.every((t) => t.product === true)).toBe(true);
  });

  it('excludes the members roster — a page, not a brand', () => {
    expect(PRODUCTS.map((t) => t.name)).not.toContain('Members roster');
  });

  it('excludes the player-facing surfaces — views of tools already counted', () => {
    for (const t of FOR_PLAYERS) expect(t.product).toBeUndefined();
    const hrefs = PRODUCTS.map((t) => t.href);
    for (const t of FOR_PLAYERS) expect(hrefs).not.toContain(t.href);
  });

  it('includes both career tools', () => {
    const names = PRODUCTS.map((t) => t.name);
    expect(names).toContain('Benchmarks');
    expect(names).toContain('Recruiting');
  });

  it('gives every product the copy the marketing grid needs', () => {
    for (const t of PRODUCTS) {
      expect(t.tag, `${t.name} is missing a tag`).toBeTruthy();
      expect(t.pitch ?? t.description, `${t.name} has no grid copy`).toBeTruthy();
    }
  });

  it('gives every tool a job description for the directory', () => {
    for (const t of [...ALL_CLUB_TOOLS, ...FOR_PLAYERS, ...FOR_YOU]) {
      expect(t.description, `${t.name} is missing a description`).toBeTruthy();
    }
  });
});

describe('nav integrity', () => {
  it('has no duplicate hrefs within a space', () => {
    const hrefs = ALL_CLUB_TOOLS.map((t) => t.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it('gives every product a section, except the career tools', () => {
    for (const t of PRODUCTS) {
      const inCareer = FOR_YOU.some((c) => c.href === t.href);
      if (inCareer) continue;
      expect(sectionOf(t), `${t.name} belongs to no section`).toBeDefined();
    }
  });

  it('points every href at an absolute in-app path', () => {
    for (const t of [...ALL_CLUB_TOOLS, ...FOR_PLAYERS, ...FOR_YOU]) {
      expect(t.href.startsWith('/'), `${t.name}: ${t.href}`).toBe(true);
    }
  });

  it('routes the directory to /tools and still answers to the old /run/tools', () => {
    expect(ALL_TOOLS_ITEM.href).toBe('/tools');
    expect(ALL_TOOLS_ITEM.matches).toContain('/run/tools');
  });

  it('never links ClubHub — it is intentionally unlinked', () => {
    const all = [...ALL_CLUB_TOOLS, ...FOR_PLAYERS, ...FOR_YOU].map((t) => t.href);
    expect(all).not.toContain('/club-hub');
  });
});

describe('activeHref picks the longest matching prefix', () => {
  const entries = SECTIONS.map((s) => ({ href: s.href, matches: s.matches }));

  it('lights up Courts for a CourtSheet page', () => {
    expect(activeHref('/courtsheet/staff', entries)).toBe('/run/courts');
  });

  it('lights up Programs for a nested league page', () => {
    expect(activeHref('/mixer/leagues/abc/jtt', entries)).toBe('/run/programs');
  });

  it('lights up Members for the vault, not Programs', () => {
    expect(activeHref('/courtconnect/vault', entries)).toBe('/run/members');
  });

  it('returns null when nothing matches', () => {
    expect(activeHref('/pricing', entries)).toBeNull();
  });
});
