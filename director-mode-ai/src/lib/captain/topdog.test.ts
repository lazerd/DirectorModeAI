import { describe, it, expect } from 'vitest';
import { buildFillPayload, parseTopDogLink, topdogEntryUrl, topdogSets, type FillCourt } from './topdog';

describe('parseTopDogLink', () => {
  it('reads every page TopDog links a match from', () => {
    const host = 'fallleague.topdoglive.com';
    for (const link of [
      'https://fallleague.topdoglive.com/pages/leagues/list_scorecard.asp?id=400887',
      'https://fallleague.topdoglive.com/pages/leagues/ScoreCardEntry.asp?s=400887&action=insert',
      'https://fallleague.topdoglive.com/pages/leagues/lineup_edit.asp?matchid=400887&teamid=77513',
      'fallleague.topdoglive.com/pages/leagues/scorecardblank.asp?id=400887&teamid=77513',
    ]) {
      expect(parseTopDogLink(link)).toEqual({ host, matchId: '400887' });
    }
  });

  it('does not read the team id off the lineup page as the match', () => {
    expect(
      parseTopDogLink('https://x.topdoglive.com/pages/leagues/lineup_edit.asp?teamid=77513&matchid=1234'),
    ).toEqual({ host: 'x.topdoglive.com', matchId: '1234' });
  });

  it('refuses anything that is not TopDog', () => {
    expect(parseTopDogLink('https://evil.com/list_scorecard.asp?id=400887')).toBeNull();
    expect(parseTopDogLink('https://topdoglive.com.evil.com/x.asp?id=1')).toBeNull();
    expect(parseTopDogLink('not a link')).toBeNull();
  });

  it('takes a bare id only when the host is already known', () => {
    expect(parseTopDogLink('400887')).toBeNull();
    expect(parseTopDogLink('400887', 'fallleague.topdoglive.com')?.matchId).toBe('400887');
  });

  it('builds the entry page url', () => {
    expect(topdogEntryUrl({ host: 'fallleague.topdoglive.com', matchId: '400887' })).toBe(
      'https://fallleague.topdoglive.com/pages/leagues/ScoreCardEntry.asp?s=400887&action=insert',
    );
  });
});

describe('topdogSets', () => {
  it('reads straight sets', () => {
    expect(topdogSets('6-1, 6-0')).toEqual({ sets: [[6, 1], [6, 0]], retired: false });
  });

  it('drops tiebreak points', () => {
    expect(topdogSets('7-6(5), 6-3').sets).toEqual([[7, 6], [6, 3]]);
  });

  it('turns a match tiebreak into the 1-0 TopDog asks for', () => {
    expect(topdogSets('6-4, 4-6, 10-8').sets).toEqual([[6, 4], [4, 6], [1, 0]]);
    expect(topdogSets('4-6, 6-4, 7-10').sets).toEqual([[4, 6], [6, 4], [0, 1]]);
    expect(topdogSets('6-4, 4-6, 0-1').sets).toEqual([[6, 4], [4, 6], [0, 1]]);
  });

  it('flags a retirement and keeps the games played', () => {
    expect(topdogSets('6-4, 5-6 RET')).toEqual({ sets: [[6, 4], [5, 6]], retired: true });
  });

  it('does not treat a normal third set as a tiebreak', () => {
    expect(topdogSets('6-4, 4-6, 7-5').sets).toEqual([[6, 4], [4, 6], [7, 5]]);
  });
});

const court = (n: number, over: Partial<FillCourt> = {}): FillCourt => ({
  courtNumber: n,
  courtType: 'doubles',
  players: ['A One', 'B Two'],
  score: '6-1, 6-0',
  won: true,
  defaulted: false,
  defaultBy: null,
  ...over,
});

describe('buildFillPayload', () => {
  const base = {
    matchId: '400883',
    // 9:30am Pacific on Sep 1 is 16:30 UTC.
    matchAt: '2026-09-01T16:30:00Z',
    timeZone: 'America/Los_Angeles',
    isHome: true,
    opponent: 'Crow Canyon',
  };

  it('writes the date in the club zone and puts us on the home side', () => {
    const { payload, problems } = buildFillPayload({ ...base, courts: [court(1)] });
    expect(payload.date).toBe('9/1/2026');
    expect(payload.side).toBe('H');
    expect(payload.lines[0]).toMatchObject({ type: 'D', status: 'C', winner: 'us', them: null });
    expect(problems).toEqual([]);
  });

  it('puts us on the visitor side away from home', () => {
    expect(buildFillPayload({ ...base, isHome: false, courts: [court(1)] }).payload.side).toBe('V');
  });

  it('records a default by them as 6-0 6-0 with Default opponents', () => {
    const { payload, problems } = buildFillPayload({
      ...base,
      courts: [court(4, { score: null, won: true, defaulted: true, defaultBy: 'them' })],
    });
    expect(payload.lines[0]).toMatchObject({
      status: 'DF',
      winner: 'us',
      us: ['A One', 'B Two'],
      them: 'default',
      sets: [[6, 0], [6, 0]],
    });
    expect(problems).toEqual([]);
  });

  it('records our own default with our side marked Default', () => {
    const { payload } = buildFillPayload({
      ...base,
      courts: [court(4, { players: [null, null], won: false, defaulted: true, defaultBy: 'us' })],
    });
    expect(payload.lines[0]).toMatchObject({ winner: 'them', us: 'default', sets: [[0, 6], [0, 6]] });
  });

  it('marks a retirement', () => {
    const { payload } = buildFillPayload({ ...base, courts: [court(1, { score: '6-4, 5-6 RET', won: false })] });
    expect(payload.lines[0]).toMatchObject({ status: 'RE', winner: 'them', sets: [[6, 4], [5, 6]] });
  });

  it('orders courts and names what is missing', () => {
    const { payload, problems } = buildFillPayload({
      ...base,
      courts: [court(2, { score: '', won: null }), court(1, { players: ['A One', null] })],
    });
    expect(payload.lines.map((l) => l.court)).toEqual([1, 2]);
    expect(problems).toEqual([
      'Doubles 1: a player is missing from the lineup.',
      'Doubles 2: no score saved.',
      'Doubles 2: no winner marked.',
    ]);
  });

  it('carries the opponent names read off the scorecard', () => {
    const { payload } = buildFillPayload({
      ...base,
      courts: [court(1, { opponents: [' Jane Smith ', 'Ann Lee', 'stray'] }), court(2)],
    });
    expect(payload.lines[0].them).toEqual(['Jane Smith', 'Ann Lee']);
    expect(payload.lines[1].them).toBeNull();
  });

  it('keeps Default for their side when they defaulted, whatever names were written', () => {
    const { payload } = buildFillPayload({
      ...base,
      courts: [court(4, { opponents: ['Jane Smith'], won: true, defaulted: true, defaultBy: 'them' })],
    });
    expect(payload.lines[0].them).toBe('default');
  });

  it('sends one name for a singles court', () => {
    const { payload } = buildFillPayload({
      ...base,
      courts: [court(1, { courtType: 'singles', players: ['Solo Player', 'stray'] })],
    });
    expect(payload.lines[0]).toMatchObject({ type: 'S', us: ['Solo Player'] });
  });
});
