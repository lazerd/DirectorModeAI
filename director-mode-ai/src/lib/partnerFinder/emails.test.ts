import { describe, it, expect } from 'vitest';
import { addressedTo, championReferralEmail, gameChangedEmail, gameFullEmail, inviteEmail, removedByHostEmail } from './emails';
import { sharedInboxes } from './format';
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
  gender: null,
  sport: null,
  list_id: null,
  status: 'full',
  notified_count: 16,
  filled_at: '2026-09-22T17:26:00.000Z',
  cancelled_at: null,
  reminder_sent_at: null,
  nudged_at: null,
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

describe('a shared family inbox', () => {
  // Pat and Sam Kim read one address (QA, 2026-10-27): identical subjects
  // threaded together, and Pat could drop Sam by mistake.
  const invite = (name: string) =>
    inviteEmail({ ...game, status: 'open' }, club, {
      to: 'kims@example.com',
      name,
      poster: 'Walden B.',
      token: 'tok',
      stopToken: null,
      spotsLeft: 1,
    });

  it('puts the first name in the subject and the full name on the email', () => {
    const mail = addressedTo(invite('Sam Kim'), 'Sam Kim', true);
    expect(mail.subject.startsWith('For Sam: ')).toBe(true);
    expect(mail.html).toContain('For Sam Kim');
    expect(mail.html.indexOf('For Sam Kim')).toBeLessThan(mail.html.indexOf('<h1'));
    expect(addressedTo(invite('Pat Kim'), 'Pat Kim', true).subject).not.toBe(mail.subject);
  });

  it("leaves everyone else's email exactly as it was", () => {
    const plain = invite('Peter Schwaikert');
    expect(addressedTo(plain, 'Peter Schwaikert', false)).toEqual(plain);
  });

  it('finds the inboxes two people share, whatever the case', () => {
    const shared = sharedInboxes([
      { person_id: 'pat', email: 'Kims@example.com' },
      { person_id: 'sam', email: 'kims@example.com ' },
      { person_id: 'peter', email: 'peter@example.com' },
      { person_id: 'nobody', email: null },
    ]);
    expect([...shared]).toEqual(['kims@example.com']);
  });
});

describe('the email when the host takes someone off', () => {
  it('says who took them off and which game, with no way back in', () => {
    const mail = removedByHostEmail(game, club, { to: 'jordan@example.com', name: 'Jordan Lee', poster: 'Walden B.' });
    expect(mail.subject).toContain('Walden B. took you off the doubles');
    expect(mail.html).toContain('no longer playing');
    expect(mail.html).not.toContain('/play/i/');
  });
});

describe('the email when a game changes', () => {
  const moved = { ...game, starts_at: '2026-09-23T17:00:00.000Z', court: '3' }; // Wed 10:00am Pacific
  const changes = [
    { field: 'when' as const, label: 'When', from: 'Tue Sep 22, 1:00pm', to: 'Wed Sep 23, 10:00am' },
    { field: 'court' as const, label: 'Court', from: '6', to: '3' },
  ];

  it('shows old and new, and says who changed it', () => {
    const mail = gameChangedEmail(moved, club, { to: 'gabe@example.com', name: 'Gabrial Fett', by: 'Walden B.', changes, token: 'tok-gabe' });
    expect(mail.html).toContain('Walden B. changed a game');
    expect(mail.html).toContain('Tue Sep 22, 1:00pm');
    expect(mail.html).toContain('Wed Sep 23, 10:00am');
    expect(mail.html).toContain('/play/i/tok-gabe');
    expect(mail.html).toContain('the new time');
  });

  it('puts the new time and court in an ASCII subject', () => {
    const mail = gameChangedEmail(moved, club, { to: 'gabe@example.com', name: 'Gabrial Fett', by: 'Walden B.', changes, token: 'tok-gabe' });
    expect(mail.subject).toBe('Changed: doubles now Wed Sep 23, 10:00am, court 3');
    expect(/^[\x20-\x7e]*$/.test(mail.subject)).toBe(true);
  });
});

describe('championReferralEmail', () => {
  const m = championReferralEmail(club, { to: 'walden@example.com', name: 'Lawrence Walden Browne', games: 8, code: 'abc123def0' });

  it('thanks them by first name, counts their games, and makes the one ask', () => {
    expect(m.html).toContain('Hi Lawrence');
    expect(m.html).toContain('8 games');
    expect(m.html).toContain('Know someone at another club who organizes games?');
    expect(m.html).toContain("only time we'll ask");
  });

  it('links to the CourtConnect front door tagged with their code', () => {
    expect(m.html).toContain('/courtconnect?ref=abc123def0');
    expect(m.sms).toContain('/courtconnect?ref=abc123def0');
  });

  it('keeps the subject ASCII', () => {
    expect(m.subject).toBe('Thanks for organizing games at Sleepy Hollow Swim & Tennis Club');
    expect(/^[ -~]*$/.test(m.subject)).toBe(true);
  });
});
