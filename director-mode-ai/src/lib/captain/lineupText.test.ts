import { describe, it, expect } from 'vitest';
import { lineupAsText } from './lineupText';

const base = {
  teamName: 'Fall B2/B3',
  // 16:30Z is 9:30am Pacific — the exact value that rendered as 4:30 PM when a
  // formatter was left without a timezone.
  matchAt: '2026-09-01T16:30:00.000Z',
  opponent: 'Crow Canyon',
  isHome: true,
  location: 'Sleepy Hollow Swim & Tennis',
  courts: [
    { courtNumber: 1, courtType: 'doubles' as const, names: ['Nikki Mains', 'Leena Elias'] },
    { courtNumber: 2, courtType: 'doubles' as const, names: ['Brenda Pech-Bitton', 'Stef Cohen'] },
  ],
};

describe('lineupAsText', () => {
  it('leads with the team, the opponent and the club-time date', () => {
    const t = lineupAsText(base);
    expect(t).toContain('Fall B2/B3 vs Crow Canyon');
    expect(t).toContain('Tuesday, September 1 at 9:30 AM');
    // Never the UTC hour.
    expect(t).not.toContain('4:30');
  });

  it('says where, and to turn up early', () => {
    const t = lineupAsText(base);
    expect(t).toContain('Home — Sleepy Hollow Swim & Tennis');
    expect(t).toContain('Please arrive 30 minutes early for warmups.');
  });

  it('uses the captain&apos;s own arrival wording when they set one', () => {
    const t = lineupAsText({ ...base, arrivalNote: 'Courts held 9:00-11:30am, get there by 9.' });
    expect(t).toContain('Courts held 9:00-11:30am, get there by 9.');
    expect(t).not.toContain('30 minutes early');
  });

  it('lists every court with both names', () => {
    const t = lineupAsText(base);
    expect(t).toContain('Doubles 1: Nikki Mains / Leena Elias');
    expect(t).toContain('Doubles 2: Brenda Pech-Bitton / Stef Cohen');
  });

  it('closes by asking people to speak up early', () => {
    expect(lineupAsText(base)).toContain(
      'If something has come up and you can no longer make it, please let me know ASAP. Thanks!',
    );
  });

  it('NEVER carries a tokenised link', () => {
    // A confirm link identifies the player it was minted for. Pasted into a
    // group, any teammate could confirm — or withdraw — as somebody else.
    const t = lineupAsText(base);
    expect(t).not.toMatch(/https?:\/\//);
    expect(t.toLowerCase()).not.toContain('confirm/');
  });

  it('skips an empty court rather than printing a row of dashes', () => {
    const t = lineupAsText({
      ...base,
      courts: [
        ...base.courts,
        { courtNumber: 3, courtType: 'doubles' as const, names: ['—', '—'] },
      ],
    });
    expect(t).not.toContain('Doubles 3');
  });

  it('handles an away match with no location set', () => {
    const t = lineupAsText({ ...base, isHome: false, location: null });
    expect(t).toContain('Away — Away');
  });

  it('drops the "vs" when there is no opponent yet', () => {
    const t = lineupAsText({ ...base, opponent: null });
    expect(t.split('\n')[0]).toBe('Fall B2/B3');
  });

  it('labels a singles court as singles', () => {
    const t = lineupAsText({
      ...base,
      courts: [{ courtNumber: 1, courtType: 'singles' as const, names: ['Nikki Mains'] }],
    });
    expect(t).toContain('Singles 1: Nikki Mains');
  });

  it('uses no markdown — group chats render it inconsistently or not at all', () => {
    const t = lineupAsText(base);
    expect(t).not.toContain('*');
    expect(t).not.toContain('_');
    expect(t).not.toContain('#');
  });
});
