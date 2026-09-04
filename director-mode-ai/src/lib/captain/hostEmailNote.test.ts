import { describe, it, expect, vi } from 'vitest';

// emails.ts pulls in Resend through @/lib/email just to export sendAll; the
// builders are pure. Stub the transport, same as lineupEmail.test.ts.
vi.mock('@/lib/email', () => ({ sendBilledEmails: vi.fn() }));

import { defaultLinesNote } from './emails';

describe('defaultLinesNote — Junior Team Tennis', () => {
  const jtt = { singlesCourts: 4, doublesCourts: 4, minPlayers: 3 };

  it('leads with the court format, because that decides how long the day runs', () => {
    const note = defaultLinesNote(8, { ...jtt, courtFormat: 3 });
    expect(note).toContain('3-court format');
    expect(note).toContain('4 singles and 4 doubles');
    expect(note).toContain('8 lines');
  });

  it('asks for their numbers and states the minimum to take the court', () => {
    const note = defaultLinesNote(8, { ...jtt, courtFormat: 3 });
    expect(note).toMatch(/how many players you're bringing/);
    expect(note).toContain('at least 3');
    expect(note).toContain('defaulted');
  });

  it('still says something useful when the format has not been set', () => {
    const note = defaultLinesNote(8, jtt);
    expect(note).not.toContain('court format');
    expect(note).toContain('4 singles and 4 doubles');
    expect(note).toContain('at least 3');
  });

  it('never asks an adult captain how many players they are bringing', () => {
    const note = defaultLinesNote(5);
    expect(note).toContain("We've filled all 5 lines");
    expect(note).not.toMatch(/how many players/);
  });

  it('stays empty for a match with no lines', () => {
    expect(defaultLinesNote(0)).toBe('');
    expect(defaultLinesNote(null)).toBe('');
  });
});
