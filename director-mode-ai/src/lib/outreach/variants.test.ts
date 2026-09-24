import { describe, expect, it } from 'vitest';
import { canBeSentC, linkFor, newRef, nextVariant, renderLetter } from './variants';

const links = { demo_url: 'https://clubmode.ai/demo/TOKEN', mixer_url: 'https://clubmode.ai/demo/TOKEN/enter?as=director&next=%2Fmixer%2Fevents%2Fid%3Ftab%3Drounds' };

describe('letters', () => {
  it('A links the tour, B links the mixer, both carry the ref', () => {
    const a = renderLetter('intro', 'A', { club: 'Aberdeen Club', fullName: 'Jane Smith' }, links, 'abc123xyz9')!;
    const b = renderLetter('intro', 'B', { club: 'Aberdeen Club', fullName: 'Jane Smith' }, links, 'abc123xyz9')!;
    expect(a.body).toContain('https://clubmode.ai/demo/TOKEN?r=abc123xyz9');
    expect(b.body).toContain('next=%2Fmixer%2Fevents%2Fid%3Ftab%3Drounds');
    expect(b.body).toContain('r=abc123xyz9');
    for (const l of [a, b]) {
      expect(l.body.startsWith('Hi Jane,')).toBe(true);
      expect(l.body).toContain('Aberdeen Club');
      expect(l.body).not.toMatch(/—|\{\{|Darrin|Kevin|Sleepy Hollow/);
    }
  });
  it('every intro carries the every-tool link, with the ref', () => {
    for (const v of ['A', 'B', 'C'] as const) {
      const l = renderLetter('intro', v, { club: 'X Club', fullName: 'Y Z' }, links, 'abc123xyz9')!;
      expect(l.body).toContain('https://clubmode.ai/demo/TOKEN/enter?as=director&next=%2Ftools&r=abc123xyz9');
    }
  });
  it('never says free or no cost (reads as free software, Darrin 9/24)', () => {
    for (const kind of ['intro', 'followup'] as const) {
      for (const v of ['A', 'B', 'C'] as const) {
        const l = renderLetter(kind, v, { club: 'X Club', fullName: 'Y Z' }, links, 'abc123xyz9')!;
        expect(`${l.subject} ${l.body}`).not.toMatch(/\bfree\b|no cost|no charge|costs? (you )?nothing/i);
      }
    }
  });
  it('no demo link means no letter', () => {
    expect(renderLetter('intro', 'A', { club: 'X', fullName: 'Y Z' }, { demo_url: null, mixer_url: null })).toBeNull();
  });
  it('B falls back to the tour', () => {
    expect(linkFor('B', { demo_url: 'https://x.test/d', mixer_url: null })).toBe('https://x.test/d');
  });
  it('keeps A and B balanced', () => {
    expect(nextVariant({})).toBe('A');
    expect(nextVariant({ A: 1 })).toBe('B');
    expect(nextVariant({ A: 1, B: 1 })).toBe('A');
  });
  it('makes a url-safe ref', () => {
    expect(newRef()).toMatch(/^[a-z2-9]{10}$/);
  });
});

describe('letter C (Benchmarks)', () => {
  it('goes only to racquet directors and head pros at their own address', () => {
    expect(canBeSentC({ title: 'Director of Tennis', email: 'pat@club.org' })).toBe(true);
    expect(canBeSentC({ title: 'Head Tennis Professional', email: 'pat@club.org' })).toBe(true);
    expect(canBeSentC({ title: 'Racquet Sports Director', email: 'pat@club.org' })).toBe(true);
    expect(canBeSentC({ title: 'General Manager', email: 'gm@club.org' })).toBe(false);
    expect(canBeSentC({ title: 'Board President', email: 'pres@club.org' })).toBe(false);
    expect(canBeSentC({ title: 'Director of Tennis', email: 'info@club.org' })).toBe(false);
    expect(canBeSentC({ title: null, email: 'pat@club.org' })).toBe(false);
    // Directors Club members are directors by membership, but never at a club inbox.
    expect(canBeSentC({ title: null, email: 'pat@gmail.com' }, { knownDirector: true })).toBe(true);
    expect(canBeSentC({ title: null, email: 'info@club.org' }, { knownDirector: true })).toBe(false);
  });
  it('links the comp score page and says nothing about the club paying', () => {
    const l = renderLetter('intro', 'C', { club: 'X Club', fullName: 'Pat Lee' }, links, 'abc123xyz9')!;
    expect(l.body).toContain('next=%2Fbenchmarks%2Fscore');
    expect(l.body).toContain('Hi Pat,');
    expect(l.subject).not.toContain('X Club');
  });
  it('is only picked when allowed, and balances when it is', () => {
    expect(nextVariant({ A: 5, B: 5 })).toBe('A');
    expect(nextVariant({ A: 1, B: 1 }, ['A', 'B', 'C'])).toBe('C');
    expect(nextVariant({ A: 1, B: 1, C: 1 }, ['A', 'B', 'C'])).toBe('A');
  });
});
