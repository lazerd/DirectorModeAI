import { afterEach, describe, expect, it, vi } from 'vitest';
import { emailsIn, hostOf, isClubHost, queriesFor, researchFree, visibleText } from './discoverFree';

afterEach(() => vi.unstubAllGlobals());

describe('page helpers', () => {
  it('keeps club sites, drops directories and socials', () => {
    expect(isClubHost(hostOf('https://www.lakesidetennisclub.org/staff'))).toBe(true);
    for (const u of ['https://www.facebook.com/x', 'https://www.yelp.com/biz/x', 'https://www.usta.com/en/x', 'https://parks.cityofx.gov/tennis', 'https://x.wixsite.com/club']) {
      expect(isClubHost(hostOf(u))).toBe(false);
    }
  });
  it('finds printed and entity-hidden emails, skips image names', () => {
    const html = '<a href="mailto:Jane@Club.org">Jane</a> bob&#64;club.org logo@2x.png info@example.com';
    expect(emailsIn(html).sort()).toEqual(['bob@club.org', 'jane@club.org']);
  });
  it('strips scripts and tags', () => {
    expect(visibleText('<script>x()</script><p>Hi <b>there</b></p>')).toBe('Hi there');
  });
  it('writes state queries with the full state name', () => {
    expect(queriesFor('ID')[0]).toContain('Idaho');
  });
});

describe('researchFree', () => {
  it('needs both keys', async () => {
    expect((await researchFree(3, ['ID'], { braveKey: '', geminiKey: 'g' })).note).toMatch(/not set/);
  });

  it('only accepts an email the page printed', async () => {
    const pages: Record<string, string> = {
      'https://lakeside.org/': '<p>Lakeside Tennis Club, Boise. Director of Tennis Pat Lee pat@lakeside.org. Friday mixers.</p>',
      'https://pines.org/': '<p>Pines Racquet Club. Contact info@pines.org</p>',
    };
    vi.stubGlobal('fetch', async (url: string) => {
      if (url.includes('api.search.brave.com')) {
        return new Response(JSON.stringify({ web: { results: [{ url: 'https://lakeside.org/' }, { url: 'https://pines.org/' }, { url: 'https://www.yelp.com/x' }] } }));
      }
      // Gemini: returns one real pick and one invented address.
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify([
        { page: 0, fits: true, club: 'Lakeside Tennis Club', city: 'Boise', state: 'ID', contact_name: 'Pat Lee', contact_title: 'Director of Tennis', email: 'pat@lakeside.org', why: 'Friday mixers', small_club: false },
        { page: 1, fits: true, club: 'Pines Racquet Club', city: 'Boise', state: 'ID', contact_name: 'Sam Roe', contact_title: 'GM', email: 'sam.roe@pines.org', why: 'x', small_club: false },
      ]) }] } }] }));
    });
    const r = await researchFree(3, ['ID'], { braveKey: 'b', geminiKey: 'g', noPacing: true, fetcher: async (u) => pages[u] ?? '' });
    expect(r.candidates.map((c) => c.email)).toEqual(['pat@lakeside.org']);
    expect(r.candidates[0].source_url).toBe('https://lakeside.org/');
    expect(r.usage.gemini).toBe(1);
  });
});
