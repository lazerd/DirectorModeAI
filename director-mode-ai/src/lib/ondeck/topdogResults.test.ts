import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  parseResults, mergeResults, eventIdFor, resultsUrl, scoreEntryUrl,
} from './topdogResults';
import { parseSchedule, type TopDogMatch } from './topdog';

const RESULTS_HTML = readFileSync(join(__dirname, '__fixtures__/topdog-results.html'), 'utf8');
const SCHEDULE_HTML = readFileSync(join(__dirname, '__fixtures__/topdog-schedule.html'), 'utf8');

const page = parseResults(RESULTS_HTML);

function m(over: Partial<TopDogMatch> = {}): TopDogMatch {
  return {
    id: 'x', slot: '8:00am', slot24: '08:00', court: null,
    event: "Boys' 10 Singles", round: 'Round 16',
    playerA: 'Bodhi Liu', playerB: 'Fares T Fakhouri',
    winner: null, defaulted: false, completed: false, ready: true,
    ...over,
  };
}

describe('parseResults', () => {
  it('lists every division with its TopDog event id', () => {
    expect(page.divisions.length).toBeGreaterThanOrEqual(8);
    expect(page.divisions).toContainEqual({ name: "Boys' 10 Singles", eventId: '17166' });
    expect(page.divisions).toContainEqual({ name: "Girls' 14 Singles", eventId: '17172' });
  });

  it('leaves "All Divisions" out of the division list', () => {
    expect(page.divisions.some((d) => d.eventId === '0')).toBe(false);
  });

  it('reads a match that has not been played', () => {
    const row = page.results.find((r) => r.playerA === 'Bodhi Liu');
    expect(row).toMatchObject({
      division: "Boys' 10 Singles", round: 'Round 16', score: 'Scheduled', done: false,
    });
  });

  it('reads a default as a finished match', () => {
    const row = page.results.find((r) => r.playerA === 'Massimo Cardenas' && r.playerB === 'Rory Frase');
    expect(row?.score).toBe('DF');
    expect(row?.done).toBe(true);
  });

  it('finds every row on the sheet', () => {
    expect(page.results.length).toBeGreaterThan(15);
    expect(page.results.every((r) => r.division && r.playerA)).toBe(true);
  });
});

describe('mergeResults', () => {
  it('marks a match TopDog has a score for as finished', () => {
    const match = m({ playerA: 'Massimo Cardenas', playerB: 'Rory Frase' });
    const [out] = mergeResults([match], page.results);
    expect(out.completed).toBe(true);
    expect(out.ready).toBe(false);
    expect(out.score).toBe('DF');
  });

  it('leaves a match that is still only scheduled alone', () => {
    const [out] = mergeResults([m()], page.results);
    expect(out.completed).toBe(false);
    expect(out.ready).toBe(true);
  });

  it('matches regardless of which side TopDog calls the opponent', () => {
    const flipped = m({ playerA: 'Rory Frase', playerB: 'Massimo Cardenas' });
    expect(mergeResults([flipped], page.results)[0].completed).toBe(true);
  });

  it('never joins two half-empty matches to each other', () => {
    const tbdA = m({ id: 'a', playerA: '', playerB: '', ready: false });
    const tbdB = m({ id: 'b', playerA: '', playerB: '', ready: false });
    const out = mergeResults([tbdA, tbdB], [
      { division: 'x', round: 'Semis', date: '09/19/26', playerA: '', playerB: '', score: '6-0 6-0', done: true },
    ]);
    expect(out.every((o) => !o.completed)).toBe(true);
  });

  it('is a no-op when the results page could not be read', () => {
    const matches = [m()];
    expect(mergeResults(matches, [])).toBe(matches);
  });

  it('folds the real results page into the real schedule', () => {
    const schedule = parseSchedule(SCHEDULE_HTML, '1715');
    const merged = mergeResults(schedule.matches, page.results);
    // The one default on the sheet is finished in both feeds, and nothing
    // that is merely scheduled got marked done.
    expect(merged.filter((x) => x.completed).length).toBeGreaterThanOrEqual(1);
    expect(merged.filter((x) => x.ready).length).toBeLessThan(schedule.matches.length);
  });
});

describe('eventIdFor', () => {
  it('points a match at its own division', () => {
    expect(eventIdFor(m({ event: "Girls' 12 Singles" }), page.divisions)).toBe('17171');
  });

  it('returns nothing rather than guessing at an unknown division', () => {
    expect(eventIdFor(m({ event: "Mixed 18 Doubles" }), page.divisions)).toBeNull();
  });
});

describe('urls', () => {
  it('builds the results and score-entry links', () => {
    expect(resultsUrl('1715')).toContain('matches_list.asp?idevent=0&t=1715');
    expect(scoreEntryUrl('17166')).toContain('scoresbatch.asp?idevent=17166');
  });
});

describe('mergeResults across rounds', () => {
  const r = (round: string, score: string) => ({
    division: "Boys' 10 Singles", round, date: '09/19/26',
    playerA: 'Massimo Cardenas', playerB: 'Rory Frase', score, done: score !== 'Scheduled',
  });

  it('does not give a consolation rematch the main-draw score', () => {
    // A Round 16 default in the morning; the same two meet again in the consolation.
    const consol = m({ round: 'Consol Quarters', playerA: 'Rory Frase', playerB: 'Massimo Cardenas' });
    const [out] = mergeResults([consol], [r('Round 16', 'DF'), r('Consol Quarters', 'Scheduled')]);
    expect(out.completed).toBe(false);
    expect(out.ready).toBe(true);
  });

  it('still finishes the round that was actually played', () => {
    const r16 = m({ round: 'Round 16', playerA: 'Massimo Cardenas', playerB: 'Rory Frase' });
    const [out] = mergeResults([r16], [r('Round 16', '6-1,6-0')]);
    expect(out.completed).toBe(true);
    expect(out.score).toBe('6-1,6-0');
  });

  it('keeps divisions apart', () => {
    const other = m({ event: "Girls' 10 Singles", round: 'Round 16', playerA: 'Massimo Cardenas', playerB: 'Rory Frase' });
    expect(mergeResults([other], [r('Round 16', 'DF')])[0].completed).toBe(false);
  });
});
