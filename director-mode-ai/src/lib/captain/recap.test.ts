import { describe, expect, it, vi } from 'vitest';

// @/lib/email drags in Resend + Supabase for sendAll; the builders are pure.
vi.mock('@/lib/email', () => ({ sendBilledEmails: vi.fn() }));

import {
  DEFAULT_RECAP,
  renderRecap,
  seasonRecord,
  tallyCourts,
  templateFor,
  type RecapCourt,
  type RecapVars,
} from './recap';
import { matchRecapEmail, type MatchInfo, type RecapCourtRow } from './emails';

const court = (n: number, won: boolean | null, extra: Partial<RecapCourt> = {}): RecapCourt => ({
  courtNumber: n,
  courtType: 'doubles',
  names: ['Ann Adams', 'Bea Brooks'],
  playerIds: [`p${n}a`, `p${n}b`],
  score: '6-4, 6-3',
  won,
  defaulted: false,
  ...extra,
});

describe('tallyCourts', () => {
  it('reads the team result off the courts', () => {
    expect(tallyCourts([court(1, true), court(2, true), court(3, false)])).toMatchObject({
      won: 2,
      lost: 1,
      outcome: 'win',
      scoreline: '2-1',
    });
  });

  it('calls an even split a tie, not a win', () => {
    expect(tallyCourts([court(1, true), court(2, false)]).outcome).toBe('tie');
  });

  it('counts a defaulted court — the league scores it as a point either way', () => {
    const t = tallyCourts([
      court(1, true, { defaulted: true, score: null }),
      court(2, false),
      court(3, false),
    ]);
    expect(t).toMatchObject({ won: 1, lost: 2, outcome: 'loss' });
  });

  it('ignores courts with no result rather than counting them as losses', () => {
    expect(tallyCourts([court(1, true), court(2, null), court(3, null)])).toMatchObject({
      won: 1,
      lost: 0,
      outcome: 'win',
      scoreline: '1-0',
    });
  });
});

describe('seasonRecord', () => {
  it('counts one win or loss per MATCH, not per court', () => {
    const r = seasonRecord([
      { matchId: 'm1', courts: [{ won: true }, { won: true }, { won: false }] },
      { matchId: 'm2', courts: [{ won: false }, { won: false }, { won: true }] },
      { matchId: 'm3', courts: [{ won: true }, { won: true }, { won: true }] },
    ]);
    expect(r).toMatchObject({ wins: 2, losses: 1, label: '2-1' });
  });

  it('leaves a played-but-unscored match out of the record entirely', () => {
    const r = seasonRecord([
      { matchId: 'm1', courts: [{ won: true }, { won: false }, { won: true }] },
      { matchId: 'm2', courts: [] },
    ]);
    expect(r).toMatchObject({ wins: 1, losses: 0, ties: 0, label: '1-0' });
  });

  it('shows ties in the label only when there are some', () => {
    expect(seasonRecord([{ matchId: 'm1', courts: [{ won: true }, { won: false }] }]).label).toBe(
      '0-0-1',
    );
  });
});

const VARS: RecapVars = {
  team: 'Fall B2/B3',
  name: 'Robyn Rogin',
  opponent: 'Diablo Valley',
  when: 'Sat, Aug 30, 9:30 AM',
  home_away: 'home',
  score: '4-1',
  result: 'win',
  record: '3-1',
};

describe('renderRecap', () => {
  it('fills the variables a captain is told about', () => {
    expect(renderRecap('{team} beat {opponent} {score} — now {record}', VARS)).toBe(
      'Fall B2/B3 beat Diablo Valley 4-1 — now 3-1',
    );
  });

  it('leaves anything else exactly as typed — a stray brace is not a bug', () => {
    expect(renderRecap('Bring {snacks} for {name}', VARS)).toBe('Bring {snacks} for Robyn Rogin');
  });
});

describe('templateFor', () => {
  it('uses the built-in wording when the captain has saved nothing', () => {
    const t = templateFor('loss', []);
    expect(t.body).toBe(DEFAULT_RECAP.loss.body);
    expect(t.isDefault).toBe(true);
  });

  it("keeps the default subject when only the body was rewritten", () => {
    const t = templateFor('win', [{ outcome: 'win', subject: null, body: 'Huge day, team.' }]);
    expect(t.subject).toBe(DEFAULT_RECAP.win.subject);
    expect(t.body).toBe('Huge day, team.');
    expect(t.isDefault).toBe(false);
  });

  it('never returns another outcome’s wording', () => {
    const t = templateFor('loss', [{ outcome: 'win', subject: 'We won!', body: 'Party 🎉' }]);
    expect(t.subject).toBe(DEFAULT_RECAP.loss.subject);
  });
});

describe('the default voices', () => {
  it('celebrates on a win and consoles on a loss', () => {
    expect(DEFAULT_RECAP.win.body.toLowerCase()).toContain('what a day');
    expect(DEFAULT_RECAP.loss.body.toLowerCase()).toContain("we'll get 'em next time");
  });

  it('never congratulates the team on a loss', () => {
    const loss = DEFAULT_RECAP.loss.subject + DEFAULT_RECAP.loss.body;
    expect(loss.toLowerCase()).not.toMatch(/\bwe (won|beat)\b/);
  });
});

const MATCH: MatchInfo = {
  id: 'match-1',
  matchAt: '2026-08-30T16:30:00.000Z', // 9:30am club time
  isHome: true,
  opponent: 'Diablo Valley',
  location: 'Sleepy Hollow Swim & Tennis',
  arrivalNote: null,
};

const ME = { playerId: 'p1a', name: 'Robyn Rogin', email: 'robyn@example.com', token: 'tok123' };

const ROWS: RecapCourtRow[] = [
  {
    courtNumber: 1,
    courtType: 'doubles',
    names: ['Robyn Rogin', 'Cara Cole'],
    playerIds: ['p1a', 'p1b'],
    score: '6-4, 6-3',
    won: true,
    defaulted: false,
  },
  {
    courtNumber: 2,
    courtType: 'singles',
    names: ['Ann Adams'],
    playerIds: ['p2a'],
    score: null,
    won: true,
    defaulted: true,
  },
  {
    courtNumber: 3,
    courtType: 'doubles',
    names: ['Bea Brooks', 'Dee Dunn'],
    playerIds: ['p3a', 'p3b'],
    score: '4-6, 2-6',
    won: false,
    defaulted: false,
  },
];

describe('matchRecapEmail', () => {
  const email = matchRecapEmail(
    'Fall B2/B3',
    MATCH,
    ME,
    {
      subject: 'Fall B2/B3 takes it 2-1',
      bodyText: 'What a day, team!\n\nScoreboard below.',
      outcome: 'win',
      scoreline: '2-1',
      courts: ROWS,
      record: '3-1',
      nextMatch: { ...MATCH, id: 'match-2', matchAt: '2026-09-13T16:30:00.000Z', opponent: 'Orinda', isHome: false },
    },
    'America/Los_Angeles',
  );

  it('leads with the result, not with a generic subject', () => {
    expect(email.subject).toBe('Fall B2/B3 takes it 2-1');
    expect(email.html).toContain('We beat Diablo Valley 2-1');
  });

  it("carries the captain's words as paragraphs", () => {
    expect(email.html).toContain('What a day, team!');
    expect(email.html).toContain('Scoreboard below.');
  });

  it('prints every court with its score', () => {
    expect(email.html).toContain('Robyn Rogin / Cara Cole');
    expect(email.html).toContain('6-4, 6-3');
    expect(email.html).toContain('Bea Brooks / Dee Dunn');
    expect(email.html).toContain('Singles 2');
  });

  it('shows a defaulted court as a default instead of an empty score', () => {
    expect(email.html).toContain('Default');
  });

  it("marks the reader's own court so nobody hunts for their line", () => {
    expect(email.html).toContain('(you)');
  });

  it('ends looking forward: season record and the next fixture', () => {
    expect(email.html).toContain('Season record:');
    expect(email.html).toContain('3-1');
    expect(email.html).toContain('Next up:');
    expect(email.html).toContain('Orinda');
    // Away next time — the recap should not tell 20 people to come to our club.
    expect(email.html).toContain('away');
  });

  it('uses club time, not the server’s UTC', () => {
    expect(email.html).toContain('9:30 AM');
  });

  it('escapes names rather than letting them into the markup', () => {
    const evil = matchRecapEmail(
      'T',
      MATCH,
      ME,
      {
        subject: 's',
        bodyText: 'b',
        outcome: 'loss',
        scoreline: '0-3',
        courts: [{ ...ROWS[0], names: ['<script>alert(1)</script>'] }],
      },
      'America/Los_Angeles',
    );
    expect(evil.html).not.toContain('<script>');
    expect(evil.html).toContain('&lt;script&gt;');
  });

  it('softens the headline on a loss', () => {
    const lost = matchRecapEmail(
      'Fall B2/B3',
      MATCH,
      ME,
      { subject: 's', bodyText: 'b', outcome: 'loss', scoreline: '1-2', courts: ROWS },
      'America/Los_Angeles',
    );
    expect(lost.html).toContain('Diablo Valley took it 1-2');
    expect(lost.html).not.toContain('We beat');
  });
});
