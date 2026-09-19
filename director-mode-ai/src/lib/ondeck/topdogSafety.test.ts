import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { parseSchedule, type TopDogMatch } from './topdog';
import { mergeResults, missingLiveMatches, parseResults, type MatchResult } from './topdogResults';

/**
 * The rule these tests exist for: a match that hasn't been played must never
 * disappear from the desk. A hidden match is a kid who never gets called,
 * a court that sits empty, and a draw that stalls — the one failure that can
 * wreck a tournament day.
 *
 * The fixtures are TopDog's real pages from Saturday afternoon of the
 * RSPA/USPTA Jr Circuit, 9/19/2026, including the Boys' 10 consolation
 * rematch (Cardenas v Frase) that once went missing.
 */
const fx = (name: string) => readFileSync(join(__dirname, '__fixtures__', name), 'utf8');

const saturday = parseSchedule(fx('topdog-schedule-afternoon.html'), '1715');
const sunday = parseSchedule(fx('topdog-schedule-sunday.html'), '1715');
const { results } = parseResults(fx('topdog-results-afternoon.html'));

const merged = mergeResults(saturday.matches, results);
const mergedSunday = mergeResults(sunday.matches, results);

function line(html: string): TopDogMatch[] {
  return parseSchedule(`<h2>T</h2><select><option value="9/19/2026" selected>Sat</option></select>
    <table class="table table-striped">
      <tr><td></td><td>Unknown Court</td></tr>
      <tr><td>1:30pm</td><td class="matches">${html}&nbsp;</td></tr>
    </table>`, '1715').matches;
}

function row(over: Partial<MatchResult>): MatchResult {
  return {
    division: "Boys' 10 Singles", round: 'Quarters', date: '09/19/26',
    playerA: 'Ava Thornton', playerB: 'Leo Marchetti', score: 'Scheduled', done: false,
    ...over,
  };
}

describe('no live match is ever hidden — real TopDog pages', () => {
  it('Saturday: every match TopDog lists as Scheduled is playable on the desk', () => {
    expect(missingLiveMatches(merged, results)).toEqual([]);
  });

  it('Sunday: the same', () => {
    expect(missingLiveMatches(mergedSunday, results)).toEqual([]);
  });

  it('the Cardenas v Frase consolation rematch is playable', () => {
    const rematch = merged.find(
      (m) => m.round === 'Consol Quarters' && [m.playerA, m.playerB].sort().join() === 'Massimo Cardenas,Rory Frase'
    );
    expect(rematch).toBeTruthy();
    expect(rematch!.ready).toBe(true);
    expect(rematch!.completed).toBe(false);
  });

  it('their Round 16 default is still finished', () => {
    const r16 = merged.find(
      (m) => m.round === 'Round 16' && [m.playerA, m.playerB].sort().join() === 'Massimo Cardenas,Rory Frase'
    );
    expect(r16?.completed).toBe(true);
  });

  it('every result TopDog has is finished on the desk', () => {
    for (const r of results.filter((x) => x.done)) {
      const m = merged.find(
        (x) => x.event === r.division && x.round === r.round &&
          [x.playerA, x.playerB].sort().join() === [r.playerA, r.playerB].sort().join()
      );
      if (m) expect({ match: `${r.playerA} v ${r.playerB} ${r.round}`, completed: m.completed })
        .toEqual({ match: `${r.playerA} v ${r.playerB} ${r.round}`, completed: true });
    }
  });

  it('every match on the sheet is in exactly one state', () => {
    for (const m of [...merged, ...mergedSunday]) {
      const tbd = !m.playerA || !m.playerB;
      const states = [m.ready, m.completed, tbd && !m.completed].filter(Boolean).length;
      expect({ id: m.id, states }).toEqual({ id: m.id, states: 1 });
    }
  });

  it('no two matches share an id', () => {
    for (const day of [merged, mergedSunday]) {
      const ids = day.map((m) => m.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
});

describe('the results page is the final word', () => {
  it('a match TopDog still has as Scheduled is playable, whatever the schedule page looked like', () => {
    // A bolded name on the schedule page reads as a finished match. If the
    // results page says Scheduled, it isn't.
    const [m] = line("Boys' 10 Singles Quarters <b>Ava Thornton</b> vs. Leo Marchetti");
    expect(m.completed).toBe(true);
    const [out] = mergeResults([m], [row({})]);
    expect(out.completed).toBe(false);
    expect(out.ready).toBe(true);
    expect(out.winner).toBeNull();
  });

  it('a score on the results page finishes the match', () => {
    const [m] = line("Boys' 10 Singles Quarters Ava Thornton vs. Leo Marchetti");
    const [out] = mergeResults([m], [row({ score: '6-3,6-4', done: true })]);
    expect(out.completed).toBe(true);
    expect(out.score).toBe('6-3,6-4');
  });

  it('two rows for one match: the result wins', () => {
    const [m] = line("Boys' 10 Singles Quarters Ava Thornton vs. Leo Marchetti");
    const [out] = mergeResults([m], [row({}), row({ score: '6-0,6-0', done: true })]);
    expect(out.completed).toBe(true);
  });

  it('a BYE stays finished even though TopDog lists it as Scheduled', () => {
    const [m] = line("Boys' 12 Singles Consol Semis Kiran Liu vs. BYE");
    const [out] = mergeResults([m], [row({
      division: "Boys' 12 Singles", round: 'Consol Semis', playerA: 'Kiran Liu', playerB: 'BYE',
    })]);
    expect(out.completed).toBe(true);
    expect(out.ready).toBe(false);
  });

  it('a result for a different round never touches this one', () => {
    const [m] = line("Boys' 10 Singles Consol Quarters Rory Frase vs. Massimo Cardenas");
    const [out] = mergeResults([m], [row({
      round: 'Round 16', playerA: 'Massimo Cardenas', playerB: 'Rory Frase', score: 'DF', done: true,
    })]);
    expect(out.ready).toBe(true);
  });
});

describe('the schedule page cannot hide a match on its own', () => {
  it('a seed in brackets is not a score', () => {
    const [m] = line("Girls' 14 Singles Semis Ava Thornton (1) vs. Maya Okafor (4)");
    expect(m.completed).toBe(false);
    expect(m.ready).toBe(true);
  });

  it('a set score in brackets is', () => {
    const [m] = line("Girls' 14 Singles Semis Ava Thornton vs. Maya Okafor (6-4,3-6,1-0)");
    expect(m.completed).toBe(true);
    expect(m.playerB).toBe('Maya Okafor');
  });

  it('the same match printed twice stays twice', () => {
    const ms = line(
      "Boys' 10 Singles Quarters Ava Thornton vs. Leo Marchetti<br>" +
      "Boys' 10 Singles Quarters Ava Thornton vs. Leo Marchetti"
    );
    expect(ms).toHaveLength(2);
    expect(ms[0].id).not.toBe(ms[1].id);
    expect(ms.every((x) => x.ready)).toBe(true);
  });

  it('a line in a shape we have never seen shows up rather than vanishing', () => {
    const [m] = line('Something TopDog has never printed before');
    expect(m).toBeTruthy();
    expect(m.completed).toBe(false);
  });
});

describe('missingLiveMatches catches the bug if it ever comes back', () => {
  it('flags a Scheduled match the desk has as finished', () => {
    const [m] = line("Boys' 10 Singles Quarters Ava Thornton vs. Leo Marchetti");
    const hidden = { ...m, completed: true, ready: false };
    expect(missingLiveMatches([hidden], [row({})])).toHaveLength(1);
  });

  it('does not flag a match that is on another day', () => {
    expect(missingLiveMatches([], [row({})])).toEqual([]);
  });
});
