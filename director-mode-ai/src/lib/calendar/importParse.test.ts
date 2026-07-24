import { describe, it, expect } from 'vitest';
import { parseIcsUpload, parseDelimitedUpload, toISO, splitRow, stripDatePrefix } from './importParse';

// End-to-end over the pipeline the upload route actually runs: file text in,
// classified constraints out. The samples below are shaped like the real files
// directors have — a district .ics export, a swim team's meet schedule, a USTA
// grid pasted into a spreadsheet, a golf calendar, a facility closure list.

const ics = (body: string) =>
  ['BEGIN:VCALENDAR', 'VERSION:2.0', body, 'END:VCALENDAR'].join('\r\n');

const vevent = (summary: string, start: string, end?: string) =>
  [
    'BEGIN:VEVENT',
    `SUMMARY:${summary}`,
    `DTSTART;VALUE=DATE:${start}`,
    `DTEND;VALUE=DATE:${end ?? start}`,
    'END:VEVENT',
  ].join('\r\n');

describe('school district .ics', () => {
  // Exclusive DTEND, as every real exporter emits.
  const file = ics([
    vevent('First Day of School', '20270819', '20270820'),
    vevent('Labor Day - No School', '20270906', '20270907'),
    vevent('Picture Day', '20270914', '20270915'),
    vevent('Teacher In-Service - No School', '20271011', '20271012'),
    vevent('Thanksgiving Break', '20271122', '20271127'),
    vevent('Winter Break', '20271220', '20280103'),
    vevent('Finals Week', '20280110', '20280115'),
    vevent('Presidents Day - No School', '20280221', '20280222'),
    vevent('Spring Break', '20280327', '20280403'),
    vevent('Prom', '20280506', '20280507'),
    vevent('Graduation', '20280609', '20280610'),
  ].join('\r\n'));

  const rows = parseIcsUpload(file, 'school');
  const by = (t: string) => rows.find((r) => r.title.includes(t))!;

  it('reads every entry', () => {
    expect(rows).toHaveLength(11);
  });

  it('normalises the exclusive DTEND to an inclusive last day', () => {
    expect(by('Thanksgiving').starts_on).toBe('2027-11-22');
    expect(by('Thanksgiving').ends_on).toBe('2027-11-26');
    expect(by('First Day').starts_on).toBe('2027-08-19');
    expect(by('First Day').ends_on).toBe('2027-08-19');
  });

  it('spans the new year correctly', () => {
    expect(by('Winter Break').starts_on).toBe('2027-12-20');
    expect(by('Winter Break').ends_on).toBe('2028-01-02');
  });

  it('finds the free junior days', () => {
    expect(by('In-Service').impact).toBe('favorable');
    expect(by('Presidents Day').impact).toBe('favorable');
    expect(by('Spring Break').impact).toBe('favorable');
  });

  it('protects the dates juniors are unavailable', () => {
    expect(by('Prom').impact).toBe('blocking');
    expect(by('Graduation').impact).toBe('blocking');
    expect(by('Finals').impact).toBe('heavy');
    expect(by('Winter Break').impact).toBe('heavy');
  });

  it('pre-marks the noise for removal', () => {
    expect(by('Picture Day').ignore).toBe(true);
  });
});

// The case that was broken before: a swim schedule read as a school calendar.
describe('swim team .ics', () => {
  const file = ics([
    vevent('Time Trials', '20280603'),
    vevent('Dual Meet vs Moraga (Home)', '20280610'),
    vevent('Dual Meet @ Lafayette', '20280617'),
    vevent('Swim Team Practice', '20280619'),
    vevent('Invitational Meet', '20280624'),
    vevent('Divisionals', '20280715', '20280717'),
    vevent('All-Star Meet', '20280722'),
    vevent('Swim Banquet', '20280729'),
    vevent('Registration Opens', '20280401'),
  ].join('\r\n'));

  const rows = parseIcsUpload(file, 'swim');
  const by = (t: string) => rows.find((r) => r.title.includes(t))!;

  it('blocks every meet', () => {
    for (const t of ['Time Trials', 'vs Moraga', '@ Lafayette', 'Invitational', 'Divisionals', 'All-Star']) {
      expect(by(t).impact, t).toBe('blocking');
    }
  });

  it('carries the multi-day championship as one span', () => {
    expect(by('Divisionals').starts_on).toBe('2028-07-15');
    expect(by('Divisionals').ends_on).toBe('2028-07-16');
  });

  it('knows practice is not a meet', () => {
    expect(by('Practice').impact).toBe('light');
  });

  it('flags the banquet as competing for the same families', () => {
    expect(by('Banquet').impact).toBe('heavy');
    expect(by('Banquet').audience_tags).toContain('family');
  });

  it('ignores the admin row', () => {
    expect(by('Registration').ignore).toBe(true);
  });

  // The regression this whole pass was about.
  it('does not read a swim calendar as a pile of light notes', () => {
    const meaningful = rows.filter((r) => !r.ignore && r.impact !== 'light');
    expect(meaningful.length).toBeGreaterThanOrEqual(7);
  });
});

describe('USTA league schedule as CSV', () => {
  const csv = [
    'Date,Home,Away,Flight',
    '4/11/2028,"Sleepy Hollow","Diablo CC",Adult 40+ 3.5',
    '4/18/2028,"Moraga","Sleepy Hollow",Adult 40+ 3.5',
    '5/2/2028,"Sleepy Hollow","Orinda CC",Mixed 40 3.5',
    '5/16/2028,"Sleepy Hollow","Blackhawk",Adult 40+ 3.5',
    '6/6/2028,"Districts","",Playoffs',
    '3/28/2028,"Captains Meeting","",Admin',
  ].join('\n');

  const rows = parseDelimitedUpload(csv, 'usta');

  it('reads US-format dates', () => {
    expect(rows.some((r) => r.starts_on === '2028-04-11')).toBe(true);
    expect(rows.some((r) => r.starts_on === '2028-05-02')).toBe(true);
  });

  it('blocks match dates', () => {
    const match = rows.find((r) => r.starts_on === '2028-04-11')!;
    expect(match.impact).toBe('blocking');
  });

  it('blocks the playoff date', () => {
    expect(rows.find((r) => r.starts_on === '2028-06-06')!.impact).toBe('blocking');
  });

  it('marks the captains meeting as ignorable', () => {
    expect(rows.find((r) => r.starts_on === '2028-03-28')!.ignore).toBe(true);
  });

  it('skips the header row', () => {
    expect(rows.some((r) => r.title.toLowerCase() === 'date')).toBe(false);
  });
});

describe('club events as tab-separated text', () => {
  const tsv = [
    'Sep 12, 2028\tGolf Member-Guest\tGolf',
    'Sep 23, 2028\tWine Dinner\tDining',
    'Oct 7, 2028\tClub Championships\tRacquets',
    'Oct 21, 2028\tHalloween Party\tSocial',
    'Nov 4, 2028\tBoard Meeting\tAdmin',
  ].join('\n');

  const rows = parseDelimitedUpload(tsv, 'club');

  it('reads long-form dates', () => {
    expect(rows.find((r) => r.title.includes('Member-Guest'))!.starts_on).toBe('2028-09-12');
  });

  it('blocks the flagship events', () => {
    expect(rows.find((r) => r.title.includes('Member-Guest'))!.impact).toBe('blocking');
    expect(rows.find((r) => r.title.includes('Championships'))!.impact).toBe('blocking');
  });

  it('flags socials as competing for members', () => {
    expect(rows.find((r) => r.title.includes('Wine'))!.impact).toBe('heavy');
    expect(rows.find((r) => r.title.includes('Halloween'))!.impact).toBe('heavy');
  });

  it('ignores the board meeting', () => {
    expect(rows.find((r) => r.title.includes('Board'))!.ignore).toBe(true);
  });
});

describe('facility closures', () => {
  const csv = [
    '2028-04-03,2028-04-14,"Courts 5-8 Resurfacing"',
    '2028-05-01,2028-05-01,"Pool Closed - Annual Drain"',
    '2028-08-19,2028-08-19,"Private Wedding Rental"',
  ].join('\n');

  const rows = parseDelimitedUpload(csv, 'facility');

  it('blocks all of them', () => {
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.impact === 'blocking')).toBe(true);
  });

  it('keeps the multi-day window', () => {
    const resurface = rows.find((r) => r.title.includes('Resurfacing'))!;
    expect(resurface.starts_on).toBe('2028-04-03');
    expect(resurface.ends_on).toBe('2028-04-14');
  });
});

describe('robustness', () => {
  it('survives a file with no dates', () => {
    expect(parseDelimitedUpload('just,some,words\nno,dates,here', 'school')).toEqual([]);
  });

  it('survives an empty file', () => {
    expect(parseDelimitedUpload('', 'school')).toEqual([]);
    expect(parseIcsUpload('', 'school')).toEqual([]);
  });

  it('survives an .ics with a malformed event', () => {
    const file = ics([
      'BEGIN:VEVENT\r\nSUMMARY:No date at all\r\nEND:VEVENT',
      vevent('Divisionals', '20280715'),
    ].join('\r\n'));
    const rows = parseIcsUpload(file, 'swim');
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe('Divisionals');
  });

  it('handles quoted commas inside a title', () => {
    const rows = parseDelimitedUpload('2028-06-10,"Dual Meet, Home vs Moraga"', 'swim');
    expect(rows[0].title).toBe('Dual Meet, Home vs Moraga');
  });

  it('treats a reversed date range as a single day rather than inverting it', () => {
    const rows = parseDelimitedUpload('2028-06-10,2028-06-01,"Backwards Meet"', 'swim');
    expect(rows[0].starts_on <= rows[0].ends_on).toBe(true);
  });

  // Guessing a missing year would move a constraint by up to twelve months.
  it('refuses a date with no year rather than guessing', () => {
    expect(toISO('9/4')).toBeNull();
    expect(toISO('Sep 4')).toBeNull();
  });

  it('parses the date shapes that do turn up', () => {
    expect(toISO('2028-06-10')).toBe('2028-06-10');
    expect(toISO('6/10/2028')).toBe('2028-06-10');
    expect(toISO('06/10/28')).toBe('2028-06-10');
    expect(toISO('Jun 10, 2028')).toBe('2028-06-10');
    expect(toISO('June 10 2028')).toBe('2028-06-10');
    expect(toISO('June 10th, 2028')).toBe('2028-06-10');
    expect(toISO('not a date')).toBeNull();
    expect(toISO('13/45/2028')).toBeNull();
  });

  it('splits rows on commas or tabs, respecting quotes', () => {
    expect(splitRow('a,b,c')).toEqual(['a', 'b', 'c']);
    expect(splitRow('a\tb\tc')).toEqual(['a', 'b', 'c']);
    expect(splitRow('"a,b",c')).toEqual(['a,b', 'c']);
  });

  // Vision extraction reads a grid cell whole, date and all.
  describe('stripDatePrefix', () => {
    it('drops a leading date echo', () => {
      expect(stripDatePrefix('Aug 6-7: PD Day')).toBe('PD Day');
      expect(stripDatePrefix('Sep 7: Labor Day')).toBe('Labor Day');
      expect(stripDatePrefix('Feb 12/15: Presidents’ Day Weekend')).toBe('Presidents’ Day Weekend');
      expect(stripDatePrefix('Nov 23-27 - Thanksgiving Break')).toBe('Thanksgiving Break');
      expect(stripDatePrefix('12/25: Christmas')).toBe('Christmas');
    });

    it('leaves an ordinary title alone', () => {
      expect(stripDatePrefix('March Madness Bracket')).toBe('March Madness Bracket');
      expect(stripDatePrefix('Spring Break')).toBe('Spring Break');
      expect(stripDatePrefix('Dual Meet vs Moraga')).toBe('Dual Meet vs Moraga');
      expect(stripDatePrefix('May Day Social')).toBe('May Day Social');
    });

    it('never strips a title down to nothing', () => {
      expect(stripDatePrefix('Aug 6-7:')).toBe('Aug 6-7:');
    });
  });

  it('never returns a row without a title or a valid date', () => {
    const messy = [
      ',,,',
      '2028-06-10,,',
      ',Something with no date,',
      '2028-06-10,"Real Meet"',
    ].join('\n');
    for (const r of parseDelimitedUpload(messy, 'swim')) {
      expect(r.title.length).toBeGreaterThan(0);
      expect(r.starts_on).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});
