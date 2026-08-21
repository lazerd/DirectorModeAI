import { describe, expect, it, vi } from 'vitest';

// The module pulls in Resend + Supabase through @/lib/email just to export
// sendAll; the builders themselves are pure. Stub the transport so the tests
// stay a pure check on what lands in the reader's inbox.
vi.mock('@/lib/email', () => ({ sendBilledEmails: vi.fn() }));

import { lineupEmail, matchReminderEmail, withdrawalAlertEmail, type MatchInfo } from './emails';

const MATCH: MatchInfo = {
  id: 'match-1',
  matchAt: '2026-08-30T16:30:00.000Z', // 9:30am club time
  isHome: true,
  opponent: 'Diablo Valley',
  location: 'Sleepy Hollow Swim & Tennis',
  arrivalNote: 'Arrive 15 minutes early.',
};

const ME = { playerId: 'p1', name: 'Robyn Rogin', email: 'robyn@example.com', token: 'tok123' };

const ROWS = [
  { courtNumber: 1, courtType: 'doubles' as const, names: ['Ann Adams', 'Bea Brooks'] },
  { courtNumber: 2, courtType: 'doubles' as const, names: ['Robyn Rogin', 'Cara Cole'] },
];

describe('lineupEmail — a player who is in it', () => {
  const html = lineupEmail('Fall B2/B3', MATCH, ROWS, ME, true).html;

  it('confirms in ONE tap - the Yes link records it, no page button to find', () => {
    expect(html).toContain('/api/captain/confirm/tok123/match-1/yes');
  });

  it('sends a decline to a page instead, where it costs a deliberate second tap', () => {
    expect(html).toContain('/captain/confirm/tok123/match-1?a=out');
    // A mis-tap that pulls someone from a match must never be one-tap.
    expect(html).not.toContain('/out');
  });

  it('offers Google and .ics separately — no email client tells us which to pick', () => {
    expect(html).toContain('https://calendar.google.com/calendar/render?action=TEMPLATE');
    expect(html).toContain('/api/captain/calendar/tok123/match-1');
  });

  it('puts the reader’s own court in the calendar event, not just the match', () => {
    const raw = html.match(/https:\/\/calendar\.google\.com[^"]+/)?.[0] || '';
    // URLSearchParams writes spaces as '+', which decodeURIComponent leaves alone.
    const gcal = decodeURIComponent(raw.replace(/\+/g, ' '));
    expect(gcal).toContain("You're on Doubles 2.");
    expect(gcal).toContain('Arrive 15 minutes early.');
  });

  it('quotes club time, never the UTC hour Vercel would default to', () => {
    expect(html).toContain('9:30 AM');
    expect(html).not.toContain('4:30 PM');
  });
});

describe('lineupEmail — a player who is not in it', () => {
  const html = lineupEmail('Fall B2/B3', MATCH, ROWS, { ...ME, name: 'Dee Dunn' }, false).html;

  it('shows the lineup but asks for nothing and adds nothing to a calendar', () => {
    expect(html).toContain('Doubles 2');
    expect(html).not.toContain('/captain/confirm/');
    expect(html).not.toContain('/api/captain/confirm/');
    expect(html).not.toContain('calendar.google.com');
  });
});

describe('matchReminderEmail', () => {
  const html = matchReminderEmail('Fall B2/B3', MATCH, ME, 'Doubles 2').html;

  it('still lets a late bail reach the captain', () => {
    expect(html).toContain('/captain/confirm/tok123/match-1?a=out');
  });

  it('carries the calendar links for anyone who never added it', () => {
    expect(html).toContain('/api/captain/calendar/tok123/match-1');
  });
});

describe('withdrawalAlertEmail', () => {
  const html = withdrawalAlertEmail(
    'captain@example.com',
    'Fall B2/B3',
    MATCH,
    'Robyn Rogin',
    'Doubles 2',
    'Shoulder is acting up <script>alert(1)</script>',
    'team-9',
  ).html;

  it('names the player, the court and links straight to the match workspace', () => {
    expect(html).toContain('Robyn Rogin');
    expect(html).toContain('Doubles 2');
    expect(html).toContain('/captain/team-9/match/match-1');
  });

  it('escapes the free-text note — it is player input landing in the captain’s inbox', () => {
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('says the subject line loudly enough to read on a lock screen', () => {
    const subject = withdrawalAlertEmail(
      'captain@example.com',
      'Fall B2/B3',
      MATCH,
      'Robyn Rogin',
      'Doubles 2',
      null,
      'team-9',
    ).subject;
    expect(subject).toBe('Robyn Rogin pulled out — Fall B2/B3 Sun, Aug 30, 9:30 AM');
  });
});
