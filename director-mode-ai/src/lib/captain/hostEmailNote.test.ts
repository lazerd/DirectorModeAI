import { describe, it, expect, vi } from 'vitest';

// emails.ts pulls in Resend through @/lib/email just to export sendAll; the
// builders are pure. Stub the transport, same as lineupEmail.test.ts.
vi.mock('@/lib/email', () => ({ sendBilledEmails: vi.fn() }));

import { confirmedLineCount, defaultLinesNote, hostingBodyText } from './emails';

describe('defaultLinesNote — Junior Team Tennis', () => {
  const jtt = { singlesCourts: 4, doublesCourts: 4, minPlayers: 3 };

  it("is Darrin's two sentences: the format, then the ask", () => {
    expect(defaultLinesNote(8, { ...jtt, courtFormat: 3 })).toBe(
      "We'll be running a 3-court format. Could you let me know roughly how many players you're bringing?",
    );
  });

  it('never lectures about the scorecard or defaults', () => {
    expect(defaultLinesNote(8, { ...jtt, courtFormat: 3 })).not.toMatch(/scorecard|defaulted|at least/);
  });

  it('still asks when the court count has not been set', () => {
    expect(defaultLinesNote(8, jtt)).toBe("Could you let me know roughly how many players you're bringing?");
  });

  it('never asks an adult captain how many players they are bringing', () => {
    const note = defaultLinesNote(5, { confirmedLines: 5 });
    expect(note).toContain('all 5 lines covered');
    expect(note).not.toMatch(/how many players/i);
  });

  it('never claims every line is covered until every line has confirmed', () => {
    for (const confirmedLines of [undefined, null, 0, 2]) {
      const note = defaultLinesNote(3, { confirmedLines });
      expect(note).not.toMatch(/covered/);
      expect(note).toBe('If you end up short on any lines, just let me know so we can plan the courts.');
    }
  });

  it('stays empty for a match with no lines', () => {
    expect(defaultLinesNote(0)).toBe('');
    expect(defaultLinesNote(null)).toBe('');
  });
});

describe('hostingBodyText', () => {
  it("matches Darrin's own version, warm-up and phone included", () => {
    const body = hostingBodyText(
      { id: 'm', matchAt: '2026-09-20T23:00:00Z', isHome: true },
      {
        opposingCaptainName: 'Adi Zilberstein',
        clubName: 'Sleepy Hollow Swim & Tennis Club',
        address: '1 Sunnyside Lane, Orinda, CA, 94563',
        courtFormat: 3,
        singlesCourts: 4,
        doublesCourts: 4,
        minPlayers: 3,
        fromName: 'Darrin Cohen',
        fromPhone: '(925) 788-8058',
      },
      'America/Los_Angeles',
    );
    expect(body).toBe(
      [
        'Hi Adi,',
        'Looking forward to hosting your team Sun, Sep 20, 4:00 PM. Warm-up courts available at 3:30 PM.',
        'Sleepy Hollow Swim & Tennis Club\n1 Sunnyside Lane, Orinda, CA, 94563',
        "We'll be running a 3-court format. Could you let me know roughly how many players you're bringing?",
        'Thanks, and see you then!',
        'Darrin Cohen\n(925) 788-8058',
      ].join('\n\n'),
    );
  });
});

describe('confirmedLineCount', () => {
  const yes = '2026-10-01T00:00:00Z';
  const seat = { player1_id: null, player2_id: null, player1_confirmed_at: null, player2_confirmed_at: null };

  it('counts a line only when every seat it needs has said yes', () => {
    expect(
      confirmedLineCount([
        { ...seat, court_type: 'singles', player1_id: 'a', player1_confirmed_at: yes },
        { ...seat, court_type: 'doubles', player1_id: 'b', player2_id: 'c', player1_confirmed_at: yes, player2_confirmed_at: yes },
        // Named but only one yes.
        { ...seat, court_type: 'doubles', player1_id: 'd', player2_id: 'e', player1_confirmed_at: yes },
        // Sent, nobody answered.
        { ...seat, court_type: 'singles', player1_id: 'f' },
      ]),
    ).toBe(2);
  });

  it('does not count a seat whose player has since pulled out', () => {
    expect(
      confirmedLineCount([
        { ...seat, court_type: 'singles', player1_id: 'a', player1_confirmed_at: yes, player1_declined_at: yes },
      ]),
    ).toBe(0);
  });

  it('is zero with no saved lineup', () => {
    expect(confirmedLineCount([])).toBe(0);
  });
});
