import { describe, expect, it } from 'vitest';
import { buildFitPrompt, parseFit } from './aiFit';

const opening = {
  club_name: 'Lakeside CC',
  title: 'Director of Racquets',
  dept: 'Tennis/Racquets',
  comp_min: 140000,
  comp_max: 180000,
  city: 'Orinda',
  state: 'CA',
  requirements: 'USPTA Elite; 5+ years running a junior program',
};
const candidate = {
  headline: 'Head Pro, 600-member club',
  dept: 'Tennis/Racquets',
  years_experience: 9,
  current_comp: 120000,
  home_zip: '94563',
  certifications: 'USPTA Elite, PTR',
  experience_summary: 'Grew juniors from 80 to 220 players.',
};

describe('buildFitPrompt', () => {
  it('includes the opening and candidate job facts', () => {
    const p = buildFitPrompt(opening, candidate);
    expect(p).toContain('Lakeside CC');
    expect(p).toContain('Orinda, CA');
    expect(p).toContain('$140,000 to $180,000');
    expect(p).toContain('USPTA Elite, PTR');
    expect(p).toContain('Grew juniors from 80 to 220');
    expect(p).toContain('Years of experience: 9');
  });

  it('states the fairness rules and asks for JSON', () => {
    const p = buildFitPrompt(opening, candidate);
    expect(p).toMatch(/Do NOT consider or mention age, gender/);
    expect(p).toMatch(/culture fit/);
    expect(p).toMatch(/cite the candidate's own stated information/);
    expect(p).toMatch(/ONLY a JSON object/);
  });

  it('marks missing info as not stated rather than inventing it', () => {
    const p = buildFitPrompt({ dept: 'Tennis/Racquets', comp_max: 100000 }, { dept: 'Tennis/Racquets' });
    expect(p).toContain('Certifications: not stated');
    expect(p).toContain('Years of experience: not stated');
    expect(p).toContain('up to $100,000');
  });

  it('never includes identity fields', () => {
    const p = buildFitPrompt(opening, { ...candidate, ...({ full_name: 'Jane Q', email: 'jane@x.com' } as object) });
    expect(p).not.toContain('Jane Q');
    expect(p).not.toContain('jane@x.com');
  });
});

describe('parseFit', () => {
  it('parses a clean JSON reply', () => {
    const f = parseFit('{"score": 82, "summary": "Strong.", "strengths": ["USPTA Elite"], "gaps": [], "questions": ["Budget size?"]}');
    expect(f).toEqual({ score: 82, summary: 'Strong.', strengths: ['USPTA Elite'], gaps: [], questions: ['Budget size?'] });
  });

  it('tolerates code fences and surrounding prose', () => {
    const f = parseFit('Here you go:\n```json\n{"score": 64.6, "summary": "ok", "strengths": [], "gaps": ["No GM exposure stated"], "questions": []}\n```');
    expect(f?.score).toBe(65);
    expect(f?.gaps).toEqual(['No GM exposure stated']);
  });

  it('clamps the score and drops junk list items', () => {
    const f = parseFit('{"score": 140, "summary": 3, "strengths": ["a", 2, "", "b"], "gaps": "none"}');
    expect(f).toEqual({ score: 100, summary: '', strengths: ['a', 'b'], gaps: [], questions: [] });
    expect(parseFit('{"score": -5}')?.score).toBe(0);
  });

  it('caps lists at five items', () => {
    const f = parseFit(JSON.stringify({ score: 50, summary: '', strengths: ['1', '2', '3', '4', '5', '6', '7'] }));
    expect(f?.strengths).toHaveLength(5);
  });

  it('returns null for unusable replies', () => {
    expect(parseFit('')).toBeNull();
    expect(parseFit('no json here')).toBeNull();
    expect(parseFit('{not json}')).toBeNull();
    expect(parseFit('{"summary": "missing score"}')).toBeNull();
  });
});
