import { describe, it, expect } from 'vitest';
import {
  normalise, shortCourt, spokenEvent, announcementText,
  diffForAnnouncement, observeCompletions, isAnnounceable,
  type RawMatchUp, type NormalisedMatch,
} from './servetennis';

/** Shaped from the real feed for tournament 55882F65 on 2026-08-22. */
const RAW: RawMatchUp = {
  matchUpId: 'm1',
  eventName: "Girls' 14 & under singles",
  roundName: 'Quarterfinals',
  matchUpStatus: 'IN_PROGRESS',
  allParticipantsCheckedIn: true,
  schedule: {
    scheduledDate: '2026-08-22',
    scheduledTime: '15:15',
    startTime: '16:03',
    courtName: 'SHSTC 5',
    venueName: 'Sleepy Hollow Swim  Tennis Club',
  },
  sides: [
    { sideNumber: 1, participant: { participantName: 'Sloane Hrdlicka' } },
    { sideNumber: 2, participant: { participantName: 'Astraea Browei' } },
  ],
};

function match(p: Partial<NormalisedMatch> & { id: string }): NormalisedMatch {
  return {
    event: "Girls' 14 & under singles", round: 'Quarterfinals',
    court: '5', courtRaw: 'SHSTC 5', status: 'IN_PROGRESS',
    startTime: '16:03', scheduledTime: '15:15', scheduledDate: '2026-08-22',
    playerA: 'A Player', playerB: 'B Player', allCheckedIn: true, ...p,
  };
}

describe('normalise', () => {
  it('pulls the fields the announcer needs out of the real shape', () => {
    const m = normalise(RAW);
    expect(m).toMatchObject({
      id: 'm1', court: '5', status: 'IN_PROGRESS', startTime: '16:03',
      playerA: 'Sloane Hrdlicka', playerB: 'Astraea Browei',
    });
  });

  it('says TBD rather than inventing a name when a side is unfilled', () => {
    const m = normalise({ ...RAW, sides: [RAW.sides![0]] });
    expect(m.playerB).toBe('TBD');
  });
});

describe('shortCourt', () => {
  it('drops the venue prefix so the PA says "court 5"', () => {
    expect(shortCourt('SHSTC 5')).toBe('5');
    expect(shortCourt('SHSTC 11a')).toBe('11a');
  });
  it('keeps anything it does not recognise rather than mangling it', () => {
    expect(shortCourt('Stadium')).toBe('Stadium');
    expect(shortCourt(null)).toBeNull();
  });
});

describe('spokenEvent', () => {
  it('makes the event name speakable', () => {
    expect(spokenEvent("Girls' 14 & under singles")).toBe('girls fourteen and under singles');
    expect(spokenEvent("Boys' 12 & under singles")).toBe('boys twelve and under singles');
  });
});

describe('announcementText', () => {
  it('leads and closes with the court', () => {
    const t = announcementText(match({ id: 'm1', playerA: 'Jayden Miller', playerB: 'Lucas Chen' }));
    expect(t.startsWith('Attention please. On court 5,')).toBe(true);
    expect(t.endsWith('report to court 5.')).toBe(true);
    expect(t).toContain('Jayden Miller versus Lucas Chen');
  });
});

describe('isAnnounceable', () => {
  it('needs a court', () => {
    expect(isAnnounceable(match({ id: 'a', court: null, courtRaw: null }))).toBe(false);
  });
  it('accepts a court assignment even before the status flips', () => {
    expect(isAnnounceable(match({ id: 'a', status: 'TO_BE_PLAYED', startTime: '09:00' }))).toBe(true);
  });
  it('ignores a match with no court and no start', () => {
    expect(isAnnounceable(match({ id: 'a', status: 'TO_BE_PLAYED', court: null, startTime: null }))).toBe(false);
  });
});

describe('diffForAnnouncement', () => {
  it('announces nothing on the first poll, just seeds', () => {
    const live = [match({ id: 'a' }), match({ id: 'b' })];
    const { toAnnounce, nextAnnounced } = diffForAnnouncement(live, new Set(), { seedOnly: true });
    expect(toAnnounce).toHaveLength(0);
    expect(nextAnnounced.size).toBe(2);
  });

  it('announces only genuinely new matches', () => {
    const seen = new Set(['a']);
    const live = [match({ id: 'a' }), match({ id: 'b' })];
    const { toAnnounce } = diffForAnnouncement(live, seen);
    expect(toAnnounce.map((m) => m.id)).toEqual(['b']);
  });

  it('never repeats a match across polls', () => {
    const live = [match({ id: 'a' })];
    const first = diffForAnnouncement(live, new Set());
    expect(first.toAnnounce).toHaveLength(1);
    const second = diffForAnnouncement(live, first.nextAnnounced);
    expect(second.toAnnounce).toHaveLength(0);
  });

  it('skips matches with no court yet', () => {
    const live = [match({ id: 'a', court: null, courtRaw: null, startTime: null, status: 'TO_BE_PLAYED' })];
    expect(diffForAnnouncement(live, new Set()).toAnnounce).toHaveLength(0);
  });
});

describe('observeCompletions', () => {
  const now = new Date('2026-08-23T11:30:00-07:00');

  it('times a match by noticing it left in-progress', () => {
    const before = [match({ id: 'a', status: 'IN_PROGRESS', startTime: '10:15' })];
    const after: NormalisedMatch[] = [];
    const done = observeCompletions(before, after, now);
    expect(done).toEqual([{ id: 'a', startTime: '10:15', endedAt: now.toISOString() }]);
  });

  it('leaves still-running matches alone', () => {
    const live = [match({ id: 'a', status: 'IN_PROGRESS' })];
    expect(observeCompletions(live, live, now)).toHaveLength(0);
  });

  it('ignores matches that never started', () => {
    const before = [match({ id: 'a', status: 'TO_BE_PLAYED', startTime: null })];
    expect(observeCompletions(before, [], now)).toHaveLength(0);
  });
});
