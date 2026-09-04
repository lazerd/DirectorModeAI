import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/email', () => ({ sendBilledEmails: vi.fn() }));

import { seasonOpenerBodyText, seasonOpenerEmail, seasonWhenText } from './emails';

/** 4:00pm club time on consecutive Sundays. */
const sundayAt4 = ['2026-09-13T23:00:00.000Z', '2026-09-20T23:00:00.000Z'];
/** Same Sundays, but one match is at 2:00pm — as the real East Bay sheet has. */
const mixedTimes = [...sundayAt4, '2026-09-27T21:00:00.000Z'];

describe('seasonWhenText — only claims a pattern the schedule supports', () => {
  it('says "Sundays at 4:00 PM" when every fixture is', () => {
    expect(seasonWhenText(sundayAt4)).toBe('Sundays at 4:00 PM');
  });

  it('REFUSES to say 4:00pm when one match is at 2:00pm', () => {
    // The single easiest way to discredit the whole email in front of a rival
    // captain who has the same spreadsheet open.
    const text = seasonWhenText(mixedTimes);
    expect(text).not.toContain('4:00');
    expect(text).toContain('Sundays');
    expect(text).toContain('start times vary');
  });

  it('falls back entirely when the days differ too', () => {
    expect(seasonWhenText([...sundayAt4, '2026-09-26T23:00:00.000Z'])).toBe(
      'on the dates and times in the league schedule',
    );
  });

  it('says something safe with no fixtures at all', () => {
    expect(seasonWhenText([])).toBe('on the dates in the league schedule');
    expect(seasonWhenText(['not-a-date'])).toBe('on the dates in the league schedule');
  });
});

describe('seasonOpenerBodyText', () => {
  const base = {
    teamName: 'Sleepy Hollow 10U Green',
    division: '10U Green Ball',
    clubName: 'Sleepy Hollow Swim & Tennis Club',
    address: '1 Sleepy Hollow Ln, Orinda, CA',
    whenText: 'Sundays at 4:00 PM',
    courtFormat: 3,
    singlesCourts: 4,
    doublesCourts: 4,
    minPlayers: 3,
    fromName: 'Darrin Cohen',
  };

  it('greets the opposing captain by first name', () => {
    const t = seasonOpenerBodyText({ ...base, opposingCaptainName: 'Thomas McGee' });
    expect(t.startsWith('Hi Thomas,')).toBe(true);
  });

  it('falls back gracefully when the league listed no name', () => {
    expect(seasonOpenerBodyText(base).startsWith('Hi there,')).toBe(true);
  });

  it('states the day, the court format and the line count', () => {
    const t = seasonOpenerBodyText(base);
    expect(t).toContain('Sundays at 4:00 PM');
    expect(t).toContain('3-court format');
    expect(t).toContain('4 singles and 4 doubles, 8 lines in all');
  });

  it('names the venue and the next meeting when there is one', () => {
    const t = seasonOpenerBodyText({
      ...base,
      nextMeeting: 'Sunday, October 4 at 4:00 PM here',
    });
    expect(t).toContain('Sleepy Hollow Swim & Tennis Club');
    expect(t).toContain('Sunday, October 4 at 4:00 PM here');
  });

  it('offers the short-numbers arrangement rather than just stating a rule', () => {
    const t = seasonOpenerBodyText(base);
    expect(t).toContain('let me know as early as you can');
    expect(t).toContain('a team needs 3 to take the court');
  });

  it('signs off with a real person', () => {
    expect(seasonOpenerBodyText(base).trimEnd().endsWith('Darrin Cohen')).toBe(true);
  });

  it('says nothing about court format when it has not been set', () => {
    const t = seasonOpenerBodyText({ ...base, courtFormat: null });
    expect(t).not.toContain('court format');
    expect(t).toContain('4 singles and 4 doubles');
  });

  it('drops the junior lines entirely for an adult team', () => {
    const t = seasonOpenerBodyText({
      ...base,
      courtFormat: null,
      singlesCourts: null,
      doublesCourts: null,
      minPlayers: null,
    });
    expect(t).not.toMatch(/lines in all/);
    expect(t).not.toMatch(/to take the court/);
  });
});

describe('seasonOpenerEmail — the referral line', () => {
  const email = seasonOpenerEmail({
    to: 'thomas@moragacc.com',
    subject: 'Sleepy Hollow 10U Green — 10U Green Ball season',
    bodyText: seasonOpenerBodyText({
      teamName: 'Sleepy Hollow 10U Green',
      clubName: 'Sleepy Hollow',
      whenText: 'Sundays at 4:00 PM',
    }),
    ref: 'opener-abc',
  });

  it('links to the page that actually grants the trial, not to pricing', () => {
    // A captain who clicks "free for 14 days" and lands on a checkout form is
    // the small betrayal that costs a professional relationship.
    expect(email.html).toContain('/captain/start?ref=opener-abc');
    expect(email.html).not.toContain('/captain/subscribe');
    expect(email.html).not.toContain('/pricing');
  });

  it('promises exactly what the landing page delivers', () => {
    expect(email.html).toContain('Free for 14 days, no card.');
  });

  it('keeps the pitch to one line, below the captain’s own words', () => {
    const promoAt = email.html.indexOf('CaptainMode</a>');
    const bodyAt = email.html.indexOf('Sundays at 4:00 PM');
    expect(bodyAt).toBeGreaterThan(-1);
    expect(promoAt).toBeGreaterThan(bodyAt);
  });

  it('carries the captain’s subject through unchanged', () => {
    expect(email.subject).toBe('Sleepy Hollow 10U Green — 10U Green Ball season');
    expect(email.to).toBe('thomas@moragacc.com');
  });
});
