import { describe, expect, it } from 'vitest';
import { cleanExtraction } from './extract';
import { listingOnlySummary, roleLevelFromTitle } from './run';
import { parseKkwTable } from './sources/kkandw';
import { emailsOnPage, guessDomains, isClubHost, pageMatchesClub, verifyContacts } from './contacts';

describe('cleanExtraction', () => {
  it('normalizes and refuses emails not literally in the posting', () => {
    const x = cleanExtraction({
      keep: true, club_name: ' Lexington Tennis Club ', title: 'Director of Junior Growth', role_level: 'director',
      state: 'Kentucky', zip: 'KY 40502', comp_min: '120000', comp_max: 90000, requirements: ['RSPA cert', '', 5],
      summary: 'Ours.', apply_email: 'Hire@LTC.com', posted_at: '2026-10-01',
    }, 'Send your resume to someone@else.com');
    expect(x.state).toBe('KY');
    expect(x.zip).toBe('40502');
    expect([x.comp_min, x.comp_max]).toEqual([90000, 120000]);
    expect(x.requirements).toEqual(['RSPA cert']);
    expect(x.apply_email).toBeNull();
    expect(cleanExtraction({ apply_email: 'hire@ltc.com' }, 'email hire@ltc.com').apply_email).toBe('hire@ltc.com');
    expect(cleanExtraction({ role_level: 'boss' }).role_level).toBe('other');
  });
});

describe('roleLevelFromTitle / listingOnlySummary', () => {
  it('classifies', () => {
    expect(roleLevelFromTitle('Director of Racquets')).toBe('director');
    expect(roleLevelFromTitle('Head Racquets Professional')).toBe('head_pro');
    expect(roleLevelFromTitle('Assistant Tennis Professional')).toBe('assistant');
  });
  it('writes our own sentence', () => {
    expect(listingOnlySummary({ source: 'kkandw', url: 'u', title: 'Director of Racquets', club: 'Waccabuc Country Club' }, 'Waccabuc', 'NY'))
      .toBe("Kopplin, Kuebler & Wallace is running the search for Waccabuc Country Club's Director of Racquets in Waccabuc, NY. Full details and how to apply are on their posting.");
  });
});

describe('parseKkwTable', () => {
  it('keeps racquets rows and strips the club prefix', () => {
    const td = (s: string) => `<td class="atsSearchResultsData " colspan="1">${s}</td>`;
    const html =
      `<table><tr>${td('<a href="/careers/ts2__JobDetails?jobId=a0x1&amp;tSource=">Waccabuc Country Club Director of Racquets</a>')}${td('<span>Director of Racquets</span>')}${td('<span>Waccabuc Country Club</span>')}${td('<span>Waccabuc, NY</span>')}</tr>` +
      `<tr>${td('<a href="/careers/ts2__JobDetails?jobId=a0x2">Lemon Bay Golf Club General Manager</a>')}${td('GM')}${td('Lemon Bay Golf Club')}${td('Englewood, FL')}</tr></table>`;
    const rows = parseKkwTable(html);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ title: 'Director of Racquets', club: 'Waccabuc Country Club', location: 'Waccabuc, NY', externalId: 'a0x1', listingOnly: true });
    expect(rows[0].url).toBe('https://kkandw.my.salesforce-sites.com/careers/ts2__JobDetails?jobId=a0x1&tSource=');
  });
});

describe('contacts helpers', () => {
  it('guesses club domains', () => {
    const g = guessDomains('Waccabuc Country Club');
    expect(g).toContain('https://www.waccabuccc.org');
    expect(g).toContain('https://www.waccabuccountryclub.com');
  });
  it('rejects boards/ATS hosts', () => {
    expect(isClubHost('jobs.rspa.net')).toBe(false);
    expect(isClubHost('waialae.betterteam.com')).toBe(false);
    expect(isClubHost('waccabuccc.org')).toBe(true);
  });
  it('matches pages to the club', () => {
    expect(pageMatchesClub('Welcome to Waccabuc Country Club', 'Waccabuc Country Club')).toBe(true);
    expect(pageMatchesClub('Domain for sale', 'Waccabuc Country Club')).toBe(false);
    // Real misses from the first run: a single shared word is not enough.
    expect(pageMatchesClub('Bear Conservation — protecting bears', 'Bear Lakes Country Club')).toBe(false);
    expect(pageMatchesClub('Welcome to Cascade Country Club', 'Cascades Country Club')).toBe(false);
    expect(pageMatchesClub('Jupiter Ocean & Racquet Club | Tennis', 'Jupiter Ocean & Racquet Club')).toBe(true);
  });
  it('only keeps contacts literally on their page', () => {
    const pages = new Map([['https://c.org/staff', {
      html: '<a href="mailto:gm@c.org">Jane Doe</a> General Manager (914) 555-1212',
      text: 'Jane Doe General Manager (914) 555-1212',
    }]]);
    expect(emailsOnPage(pages.get('https://c.org/staff')!.html)).toEqual(['gm@c.org']);
    const v = verifyContacts([
      { name: 'Jane Doe', role: 'gm', email: 'gm@c.org', phone: '914-555-1212', source_url: 'https://c.org/staff/' },
      { name: 'Bob Roe', role: 'board', email: 'bob@c.org', source_url: 'https://c.org/staff' },
      { name: 'X', role: 'hr', email: 'hr@c.org', source_url: 'https://elsewhere.org' },
    ], pages);
    expect(v).toHaveLength(1);
    expect(v[0]).toMatchObject({ name: 'Jane Doe', email: 'gm@c.org', phone: '914-555-1212', source_url: 'https://c.org/staff' });
  });
});
