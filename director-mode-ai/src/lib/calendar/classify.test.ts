import { describe, it, expect } from 'vitest';
import { classifyImported, widenForLongSpans } from './classify';

describe('classifyImported', () => {
  it('marks school socials as blocking', () => {
    for (const t of ['Homecoming Dance', 'Junior Prom', 'Graduation Ceremony', 'Winter Formal']) {
      expect(classifyImported(t).impact, t).toBe('blocking');
    }
  });

  // The signed-impact case: a no-school day is an OPPORTUNITY, not a conflict.
  it('treats no-school days as favorable for juniors', () => {
    for (const t of ['No School', 'Teacher In-Service Day', 'Staff Development — No Students', 'School Closed']) {
      const c = classifyImported(t);
      expect(c.impact, t).toBe('favorable');
      expect(c.audience_tags, t).toContain('junior');
    }
  });

  it('splits the breaks by whether families travel', () => {
    expect(classifyImported('Spring Break').impact).toBe('favorable');
    expect(classifyImported('Winter Break').impact).toBe('heavy');
    expect(classifyImported('Thanksgiving Break').impact).toBe('heavy');
    expect(classifyImported('Fall Recess').impact).toBe('favorable');
  });

  it('protects juniors from exam weeks', () => {
    for (const t of ['Final Exams', 'AP Testing', 'Midterms', 'State Testing Window']) {
      const c = classifyImported(t);
      expect(c.impact, t).toBe('heavy');
      expect(c.audience_tags, t).toContain('junior');
    }
  });

  it('flags administrative noise as ignorable', () => {
    for (const t of ['Picture Day', 'Book Fair', 'PTA Meeting', 'Report Cards Issued']) {
      expect(classifyImported(t).ignore, t).toBe(true);
    }
  });

  it('recognises club-side conflicts', () => {
    expect(classifyImported('Golf Member-Guest', 'club').impact).toBe('blocking');
    expect(classifyImported('Court Resurfacing', 'club').impact).toBe('blocking');
    expect(classifyImported('USTA League Match', 'club').impact).toBe('blocking');
    expect(classifyImported('Private Wedding Rental', 'club').impact).toBe('blocking');
  });

  it('is case- and punctuation-insensitive', () => {
    expect(classifyImported('SPRING BREAK').impact).toBe('favorable');
    expect(classifyImported('no school!').impact).toBe('favorable');
    expect(classifyImported('  Homecoming  ').impact).toBe('blocking');
  });

  it('keeps an unknown entry visible but harmless', () => {
    const c = classifyImported('Chess Club Regional Qualifier');
    expect(c.impact).toBe('light');
    expect(c.ignore).toBe(false);
    expect(c.note.length).toBeGreaterThan(0);
  });

  it('drops an empty title', () => {
    expect(classifyImported('').ignore).toBe(true);
  });

  it('always explains itself', () => {
    for (const t of ['Spring Break', 'Homecoming', 'Something Unknown', 'Picture Day']) {
      expect(classifyImported(t).note.length, t).toBeGreaterThan(10);
    }
  });
});

describe('widenForLongSpans', () => {
  it('promotes a vague week-long entry to a real break', () => {
    const base = classifyImported('Non-Student Days');
    expect(base.impact).toBe('light');
    const widened = widenForLongSpans(base, 7);
    expect(widened.impact).toBe('heavy');
    expect(widened.note).toContain('7 days');
  });

  it('leaves short entries alone', () => {
    const base = classifyImported('Non-Student Days');
    expect(widenForLongSpans(base, 2).impact).toBe('light');
  });

  it('never downgrades an explicit classification', () => {
    const blocking = classifyImported('Graduation');
    expect(widenForLongSpans(blocking, 10).impact).toBe('blocking');
    const favorable = classifyImported('Spring Break');
    expect(widenForLongSpans(favorable, 10).impact).toBe('favorable');
  });

  it('leaves ignorable rows ignorable', () => {
    const noise = classifyImported('Book Fair');
    expect(widenForLongSpans(noise, 10).ignore).toBe(true);
  });
});
