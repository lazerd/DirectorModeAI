import { describe, expect, it } from 'vitest';
import { linkFor, newRef, nextVariant, renderLetter } from './variants';

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
