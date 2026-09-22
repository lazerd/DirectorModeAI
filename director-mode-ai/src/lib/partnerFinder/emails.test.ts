import { describe, it, expect } from 'vitest';
import { gameFullEmail } from './emails';
import { TENNIS_SCALE } from '@/lib/levels';
import type { Club, Game, GroupMember } from './server';

const club: Club = {
  id: 'club-1',
  name: 'Sleepy Hollow Swim & Tennis Club',
  slug: 'sleepy-hollow',
  timezone: 'America/Los_Angeles',
  owner_id: 'owner-1',
  sports: ['tennis'],
  levels: TENNIS_SCALE,
  contactEmail: 'darrin@sleepyhollowclub.com',
};

const game: Game = {
  id: 'game-1',
  club_id: 'club-1',
  posted_by: 'walden-user',
  starts_at: '2026-09-22T20:00:00.000Z', // Tue 1:00pm Pacific
  duration_min: 90,
  format: 'doubles',
  spots_needed: 2,
  rating_min: 3,
  rating_max: 3.5,
  include_unrated: true,
  court: '6',
  note: 'Looking for two guys for doubles at 1pm.',
  status: 'full',
  notified_count: 16,
  filled_at: '2026-09-22T17:26:00.000Z',
  cancelled_at: null,
  reminder_sent_at: null,
  created_at: '2026-09-21T18:17:37.676Z',
};

const group: GroupMember[] = [
  { personId: 'p-walden', name: 'Walden Browne', short: 'Walden B.', email: 'walden@example.com', phone: null, isPoster: true, isGuest: false },
  { personId: 'p-gabe', name: 'Gabrial Fett', short: 'Gabrial F.', email: 'gabe@example.com', phone: null, isPoster: false, isGuest: false },
  { personId: 'p-peter', name: 'Peter Schwaikert', short: 'Peter S.', email: 'peter@example.com', phone: null, isPoster: false, isGuest: false },
  { personId: 'p-chris', name: 'Chris Cortner', short: 'Chris C.', email: 'chris@example.com', phone: null, isPoster: false, isGuest: false },
];

describe('the email when a game fills', () => {
  it('tells the poster WHO took the last spot, in the subject', () => {
    // Walden reported this one missing (2026-09-22). It had been delivered --
    // every earlier join reaches the poster as "Peter S. is in", so a bare
    // "You're all set" does not read as the answer to "did Chris take it?".
    const mail = gameFullEmail(game, club, {
      to: 'walden@example.com',
      name: 'Walden Browne',
      group,
      token: 'tok-walden',
      joiner: 'Chris C.',
      isPoster: true,
    });
    expect(mail.subject).toContain('Chris C. is in');
    expect(mail.subject).toContain('is full');
    expect(mail.html).toContain('took the last spot');
    expect(mail.sms).toContain('Chris C. is in');
  });

  it('gives everyone else the plain line-up, with no joiner singled out', () => {
    const mail = gameFullEmail(game, club, {
      to: 'peter@example.com',
      name: 'Peter Schwaikert',
      group,
      token: 'tok-peter',
      joiner: 'Chris C.',
      isPoster: false,
    });
    expect(mail.subject).toContain("You're all set");
    expect(mail.subject).not.toContain('Chris C.');
    expect(mail.html).toContain('the game is full');
  });

  it('falls back to the plain subject when the joiner is unknown', () => {
    const mail = gameFullEmail(game, club, {
      to: 'walden@example.com',
      name: 'Walden Browne',
      group,
      token: 'tok-walden',
      joiner: null,
      isPoster: true,
    });
    expect(mail.subject).toContain("You're all set");
  });

  it('still lists every player for the poster', () => {
    const mail = gameFullEmail(game, club, {
      to: 'walden@example.com',
      name: 'Walden Browne',
      group,
      token: 'tok-walden',
      joiner: 'Chris C.',
      isPoster: true,
    });
    for (const m of group) expect(mail.html).toContain(m.short);
  });
});

describe('a guest the host seated', () => {
  const withGuest: GroupMember[] = [
    ...group.slice(0, 3),
    { personId: 'seat-9', name: 'Jamie Visitor', short: 'Jamie Visitor', email: null, phone: null, isPoster: false, isGuest: true },
  ];

  it('is named in the line-up like anyone else', () => {
    const mail = gameFullEmail(game, club, {
      to: 'peter@example.com',
      name: 'Peter Schwaikert',
      group: withGuest,
      token: 'tok-peter',
      isPoster: false,
    });
    expect(mail.html).toContain('Jamie Visitor');
  });

  it('can be the one who completed the game', () => {
    const mail = gameFullEmail(game, club, {
      to: 'walden@example.com',
      name: 'Walden Browne',
      group: withGuest,
      token: 'tok-walden',
      joiner: 'Jamie Visitor',
      isPoster: true,
    });
    expect(mail.subject).toContain('Jamie Visitor is in');
  });
});
