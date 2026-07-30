import { describe, it, expect } from 'vitest';
import {
  parseRatingLine,
  parseRatingsBlock,
  resolveRatings,
  rankByRating,
} from './ratingsPaste';

const roster = [
  { id: 'a', name: 'Paula Garcia', rating: 3.5 },
  { id: 'b', name: 'Shannon Moore', rating: 3.5 },
  { id: 'c', name: 'Brenda Pech-Bitton', rating: 3.0 },
  { id: 'd', name: 'Jen Acker Parks', rating: 3.0 },
  { id: 'e', name: 'Nikki Mains', rating: null },
];

describe('parseRatingLine', () => {
  it('reads a tab-separated row', () => {
    expect(parseRatingLine('Paula Garcia\t3.42\t12\t0.667')).toEqual({
      name: 'Paula Garcia',
      rating: 3.42,
    });
  });

  it('reads a space-separated row', () => {
    expect(parseRatingLine('Shannon Moore 3.61 8 0.500')).toEqual({
      name: 'Shannon Moore',
      rating: 3.61,
    });
  });

  it('takes the rating column, not a later number that looks like one', () => {
    // win% of 0.667 is out of band; match count 12 has no decimal.
    expect(parseRatingLine('Paula Garcia   3.42   12   0.667')?.rating).toBe(3.42);
  });

  it('ignores a leading number that is out of the rating band', () => {
    expect(parseRatingLine('Jen Acker Parks  12.5  3.05')?.rating).toBe(3.05);
  });

  it('keeps three decimals — the whole reason for importing', () => {
    // Most of a B2/B3 roster self-rates a flat 3.0, so the decimals are the
    // only thing that can order them. captain_players.rating is numeric(6,3).
    expect(parseRatingLine('Paula Garcia\t3.236\t8-4')?.rating).toBe(3.236);
    expect(parseRatingLine('Shannon Moore\t3.198\t7-5')?.rating).toBe(3.198);
  });

  it('orders two players who share an NTRP level', () => {
    const a = parseRatingLine('Paula Garcia\t3.236')!;
    const b = parseRatingLine('Shannon Moore\t3.198')!;
    expect(a.rating).toBeGreaterThan(b.rating);
  });

  it('handles "Last, First"', () => {
    expect(parseRatingLine('Pech-Bitton, Brenda\t2.98')).toEqual({
      name: 'Pech-Bitton, Brenda',
      rating: 2.98,
    });
  });

  it('keeps hyphenated surnames intact', () => {
    expect(parseRatingLine('Brenda Pech-Bitton 3.10')?.name).toBe('Brenda Pech-Bitton');
  });

  it('strips a parenthetical from the name', () => {
    expect(parseRatingLine('Paula Garcia (3.5C)\t3.42')?.name).toBe('Paula Garcia');
  });

  it('takes the dynamic rating, not the USTA level tagged on the name', () => {
    // "(3.5C)" is the coarse level; 3.42 is the number worth having. Reading
    // the tag throws away the precision the whole import is for.
    expect(parseRatingLine('Paula Garcia (3.5C)\t3.42')?.rating).toBe(3.42);
    expect(parseRatingLine('Moore, Shannon (4.0S)  3.61  7-5')?.rating).toBe(3.61);
  });

  it('returns null for a header row', () => {
    expect(parseRatingLine('Player\tRating\tMatches')).toBeNull();
  });

  it('returns null for a line with no rating', () => {
    expect(parseRatingLine('Paula Garcia')).toBeNull();
  });

  it('returns null for a single word plus a number', () => {
    // "Garcia 3.42" is too little to match a roster confidently.
    expect(parseRatingLine('Garcia 3.42')).toBeNull();
  });

  it('returns null on blank', () => {
    expect(parseRatingLine('   ')).toBeNull();
  });
});

describe('parseRatingsBlock', () => {
  it('separates parsed rows from junk', () => {
    const { parsed, ignored } = parseRatingsBlock(
      ['Player\tRating', 'Paula Garcia\t3.42', '', 'Shannon Moore\t3.61', 'Totals'].join('\n'),
    );
    expect(parsed).toHaveLength(2);
    expect(ignored).toEqual(['Player\tRating', 'Totals']);
  });
});

describe('resolveRatings', () => {
  it('matches exact names', () => {
    const r = resolveRatings([{ name: 'Paula Garcia', rating: 3.42 }], roster);
    expect(r.matched).toHaveLength(1);
    expect(r.matched[0]).toMatchObject({
      playerId: 'a',
      rating: 3.42,
      matchedOn: 'exact',
      previousRating: 3.5,
    });
  });

  it('matches "Last, First" against "First Last"', () => {
    const r = resolveRatings([{ name: 'Pech-Bitton, Brenda', rating: 2.98 }], roster);
    expect(r.matched[0]).toMatchObject({ playerId: 'c', matchedOn: 'exact' });
  });

  it('matches on last name plus first initial', () => {
    const r = resolveRatings([{ name: 'N. Mains', rating: 3.2 }], roster);
    expect(r.matched[0]).toMatchObject({ playerId: 'e', matchedOn: 'last-name + initial' });
  });

  it('is case and accent insensitive', () => {
    const r = resolveRatings([{ name: 'páula garcía', rating: 3.4 }], roster);
    expect(r.matched[0]?.playerId).toBe('a');
  });

  it('refuses to guess between two players with the same surname', () => {
    const two = [
      { id: 'x', name: 'Jane Smith', rating: null },
      { id: 'y', name: 'Julie Smith', rating: null },
    ];
    const r = resolveRatings([{ name: 'J. Smith', rating: 3.5 }], two);
    expect(r.matched).toHaveLength(0);
    expect(r.ambiguous[0].candidates.sort()).toEqual(['Jane Smith', 'Julie Smith']);
  });

  it('reports a name that is not on the roster instead of forcing it', () => {
    const r = resolveRatings([{ name: 'Someone Else', rating: 4.0 }], roster);
    expect(r.matched).toHaveLength(0);
    expect(r.unmatched).toEqual([{ name: 'Someone Else', rating: 4.0 }]);
  });

  it('never assigns two pasted rows to the same player', () => {
    const r = resolveRatings(
      [
        { name: 'Paula Garcia', rating: 3.42 },
        { name: 'P. Garcia', rating: 9.9 },
      ],
      roster,
    );
    expect(r.matched).toHaveLength(1);
    expect(r.matched[0].rating).toBe(3.42);
    expect(r.unmatched).toHaveLength(1);
  });

  it('handles a whole realistic paste', () => {
    const { parsed, ignored } = parseRatingsBlock(
      [
        'Player\tRating\tRecord',
        'Paula Garcia\t3.42\t8-4',
        'Moore, Shannon\t3.61\t7-5',
        'Brenda Pech-Bitton\t2.98\t6-6',
        'Someone Notonteam\t3.10\t1-1',
      ].join('\n'),
    );
    const r = resolveRatings(parsed, roster, ignored);
    expect(r.matched.map((m) => m.playerId).sort()).toEqual(['a', 'b', 'c']);
    expect(r.unmatched).toHaveLength(1);
    expect(r.ambiguous).toHaveLength(0);
  });
});

describe('rankByRating', () => {
  it('orders strongest first', () => {
    expect(
      rankByRating([
        { id: 'lo', name: 'Lo', rating: 2.5 },
        { id: 'hi', name: 'Hi', rating: 4.0 },
        { id: 'mid', name: 'Mid', rating: 3.0 },
      ]),
    ).toEqual(['hi', 'mid', 'lo']);
  });

  it('keeps an existing manual rank as the tiebreak, so a re-import is stable', () => {
    expect(
      rankByRating([
        { id: 'second', name: 'B', rating: 3.0, sort_order: 2 },
        { id: 'first', name: 'A', rating: 3.0, sort_order: 1 },
      ]),
    ).toEqual(['first', 'second']);
  });

  it('sorts unrated players last', () => {
    expect(
      rankByRating([
        { id: 'none', name: 'None', rating: null },
        { id: 'rated', name: 'Rated', rating: 2.5 },
      ]),
    ).toEqual(['rated', 'none']);
  });
});
