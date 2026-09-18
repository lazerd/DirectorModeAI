import { describe, it, expect, vi } from 'vitest';

// emails.ts pulls in Resend through @/lib/email just to export sendAll; the
// builders are pure. Stub the transport, same as lineupEmail.test.ts.
vi.mock('@/lib/email', () => ({ sendBilledEmails: vi.fn() }));

import { defaultLinesNote, hostingBodyText } from './emails';

describe('defaultLinesNote — Junior Team Tennis', () => {
  const jtt = { singlesCourts: 4, doublesCourts: 4, minPlayers: 3 };

  it('says how the rounds run on our courts, in plain words', () => {
    const note = defaultLinesNote(8, { ...jtt, courtFormat: 3 });
    expect(note).toContain("We'll have 3 courts, so the match runs in three rounds");
    expect(note).not.toMatch(/format|scorecard|defaulted/);
  });

  it('asks how many players they are bringing', () => {
    expect(defaultLinesNote(8, { ...jtt, courtFormat: 2 })).toMatch(/How many players are you bringing\?/);
  });

  it('still asks when the court count has not been set', () => {
    expect(defaultLinesNote(8, jtt)).toBe('How many players are you bringing? It helps us plan the afternoon.');
  });

  it('never asks an adult captain how many players they are bringing', () => {
    const note = defaultLinesNote(5);
    expect(note).toContain('all 5 lines covered');
    expect(note).not.toMatch(/how many players/i);
  });

  it('stays empty for a match with no lines', () => {
    expect(defaultLinesNote(0)).toBe('');
    expect(defaultLinesNote(null)).toBe('');
  });
});

describe('hostingBodyText', () => {
  it('reads like a note from a coach', () => {
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
      },
      'America/Los_Angeles',
    );
    expect(body).toContain(
      "We're looking forward to hosting you on Sunday, September 20 at 4:00 pm at Sleepy Hollow Swim & Tennis Club, 1 Sunnyside Lane, Orinda, CA, 94563.",
    );
    expect(body).toContain('Thanks, and see you Sunday!');
  });
});
