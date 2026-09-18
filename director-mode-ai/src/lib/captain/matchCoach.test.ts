import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/email', () => ({ sendBilledEmails: vi.fn() }));

import { withMatchCoach } from './teamContacts';
import { availabilityEmail } from './emails';
import { lineupAsText } from './lineupText';

const ALEX = { id: 'c1', name: 'Alex P', email: 'alex@example.com', phone: '(510) 846-8720' };

describe('the coach at this match is copied', () => {
  it('when not on team emails', () => {
    expect(withMatchCoach([], ALEX).map((c) => c.email)).toEqual(['alex@example.com']);
  });
  it('once, when already on team emails (any case)', () => {
    const team = [{ name: 'Alex P', email: 'ALEX@example.com', role: 'coach' }];
    expect(withMatchCoach(team, ALEX)).toHaveLength(1);
  });
  it('not when already receiving it as a player address', () => {
    expect(withMatchCoach([], ALEX, ['alex@example.com'])).toEqual([]);
  });
  it('not when nobody is named', () => {
    expect(withMatchCoach([], null)).toEqual([]);
  });
});

describe('parents are told who the coach is', () => {
  const m = { id: 'm', matchAt: '2026-09-27T23:00:00Z', isHome: false, coachName: 'Alex P', coachPhone: '(510) 846-8720' };
  it('in every player email', () => {
    const e = availabilityEmail('12U', m, { playerId: 'p', name: 'Kid', email: 'k@example.com', token: 't' });
    expect(e.html).toContain('Our coach at the match: Alex P · (510) 846-8720');
  });
  it('in the group-chat text', () => {
    const t = lineupAsText({ teamName: '12U', matchAt: m.matchAt, isHome: false, coachName: 'Alex P', courts: [] });
    expect(t).toContain('Coach at the match: Alex P');
  });
});
