import { describe, it, expect } from 'vitest';
import { answersByPlayer, rowsWithAnswers, answerTally, type SavedCourt } from './lineupSave';

/** The real shape: Nikki + Leena on court 1, Stef + Brenda on court 2. */
const existing = [
  {
    court_number: 1,
    player1_id: 'nikki',
    player2_id: 'leena',
    player1_confirmed_at: '2026-08-21T18:00:00.000Z',
    player1_confirmed_source: 'player',
    player1_declined_at: null,
    player1_decline_note: null,
    player2_confirmed_at: null,
    player2_confirmed_source: null,
    player2_declined_at: null,
    player2_decline_note: null,
  },
  {
    court_number: 2,
    player1_id: 'brenda',
    player2_id: 'stef',
    player1_confirmed_at: null,
    player1_confirmed_source: null,
    player1_declined_at: null,
    player1_decline_note: null,
    player2_confirmed_at: '2026-08-21T18:20:36.889Z',
    player2_confirmed_source: 'player',
    player2_declined_at: null,
    player2_decline_note: null,
  },
];

const base = { team_id: 'team', match_id: 'match' };

const court = (n: number, p1: string | null, p2: string | null): SavedCourt => ({
  courtNumber: n,
  courtType: 'doubles',
  player1Id: p1,
  player2Id: p2,
});

describe('answersByPlayer', () => {
  it('keys every answer by the player who gave it', () => {
    const a = answersByPlayer(existing);
    expect([...a.keys()].sort()).toEqual(['nikki', 'stef']);
    expect(a.get('stef')?.confirmedAt).toBe('2026-08-21T18:20:36.889Z');
  });

  it('ignores slots with no answer, so "has an answer" stays true', () => {
    expect(answersByPlayer(existing).has('leena')).toBe(false);
    expect(answersByPlayer(existing).has('brenda')).toBe(false);
  });

  it('keeps a withdrawal and its note', () => {
    const a = answersByPlayer([
      {
        player1_id: 'jamie',
        player2_id: null,
        player1_confirmed_at: null,
        player1_confirmed_source: null,
        player1_declined_at: '2026-08-25T10:00:00.000Z',
        player1_decline_note: 'back went out',
      },
    ]);
    expect(a.get('jamie')).toMatchObject({
      declinedAt: '2026-08-25T10:00:00.000Z',
      declineNote: 'back went out',
    });
  });
});

describe('rowsWithAnswers', () => {
  it('keeps a confirmation when the player stays where they are', () => {
    const rows = rowsWithAnswers(
      [court(1, 'nikki', 'leena'), court(2, 'brenda', 'stef')],
      answersByPlayer(existing),
      base,
    );
    expect(rows[0].player1_confirmed_at).toBe('2026-08-21T18:00:00.000Z');
    expect(rows[1].player2_confirmed_at).toBe('2026-08-21T18:20:36.889Z');
  });

  it('follows a player to a different court and a different slot', () => {
    // The exact 2026-08-28 case: a substitution reshuffles the sheet and every
    // confirmation used to be destroyed by it.
    const rows = rowsWithAnswers(
      [court(1, 'stef', 'nikki'), court(2, 'brenda', 'leena')],
      answersByPlayer(existing),
      base,
    );
    expect(rows[0].player1_confirmed_at).toBe('2026-08-21T18:20:36.889Z'); // stef, moved court + slot
    expect(rows[0].player2_confirmed_at).toBe('2026-08-21T18:00:00.000Z'); // nikki, moved slot
    expect(rows[0].player1_confirmed_source).toBe('player');
  });

  it('drops the answer of a player taken out of the lineup', () => {
    const rows = rowsWithAnswers(
      [court(1, 'nikki', 'leena'), court(2, 'brenda', 'newcomer')],
      answersByPlayer(existing),
      base,
    );
    // Stef is gone; nobody inherits her confirmation.
    expect(rows.some((r) => r.player1_confirmed_at === '2026-08-21T18:20:36.889Z')).toBe(false);
    expect(rows.some((r) => r.player2_confirmed_at === '2026-08-21T18:20:36.889Z')).toBe(false);
  });

  it('gives a newly added player no answer at all', () => {
    const rows = rowsWithAnswers([court(1, 'newcomer', 'leena')], answersByPlayer(existing), base);
    expect(rows[0].player1_confirmed_at).toBeNull();
    expect(rows[0].player1_confirmed_source).toBeNull();
  });

  it('never invents an answer for an empty slot', () => {
    const rows = rowsWithAnswers([court(1, 'nikki', null)], answersByPlayer(existing), base);
    expect(rows[0].player2_id).toBeNull();
    expect(rows[0].player2_confirmed_at).toBeNull();
  });

  it('carries a withdrawal across too, so a bail cannot be erased by a save', () => {
    const withBail = answersByPlayer([
      {
        player1_id: 'jamie',
        player2_id: null,
        player1_declined_at: '2026-08-25T10:00:00.000Z',
        player1_decline_note: 'back went out',
        player1_confirmed_at: null,
        player1_confirmed_source: null,
      },
    ]);
    const rows = rowsWithAnswers([court(3, 'kate', 'jamie')], withBail, base);
    expect(rows[0].player2_declined_at).toBe('2026-08-25T10:00:00.000Z');
    expect(rows[0].player2_decline_note).toBe('back went out');
  });
});

describe('answerTally', () => {
  it('counts what survived and what left with its player', () => {
    const answers = answersByPlayer(existing);
    expect(answerTally([court(1, 'nikki', 'leena')], answers)).toEqual({ kept: 1, dropped: 1 });
    expect(answerTally([court(1, 'nikki', 'stef')], answers)).toEqual({ kept: 2, dropped: 0 });
    expect(answerTally([court(1, 'newcomer', null)], answers)).toEqual({ kept: 0, dropped: 2 });
  });
});
