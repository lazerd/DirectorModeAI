import { describe, it, expect } from 'vitest';
import { classifyImported, widenForLongSpans, CALENDAR_KINDS, type CalendarKind } from './classify';

describe('school calendars', () => {
  it('marks school socials as blocking', () => {
    for (const t of ['Homecoming Dance', 'Junior Prom', 'Graduation Ceremony', 'Winter Formal', 'Sadie Hawkins']) {
      expect(classifyImported(t, 'school').impact, t).toBe('blocking');
    }
  });

  // The signed-impact case: a no-school day is an OPPORTUNITY, not a conflict.
  it('treats no-school days as favorable for juniors', () => {
    for (const t of ['No School', 'Teacher In-Service Day', 'Staff Development — No Students', 'School Closed', 'Non-Student Day']) {
      const c = classifyImported(t, 'school');
      expect(c.impact, t).toBe('favorable');
      expect(c.audience_tags, t).toContain('junior');
    }
  });

  it('splits the breaks by whether families travel', () => {
    expect(classifyImported('Spring Break', 'school').impact).toBe('favorable');
    expect(classifyImported('Winter Break', 'school').impact).toBe('heavy');
    expect(classifyImported('Thanksgiving Break', 'school').impact).toBe('heavy');
    expect(classifyImported('Fall Recess', 'school').impact).toBe('favorable');
  });

  it('protects juniors from exam weeks', () => {
    for (const t of ['Final Exams', 'AP Testing', 'Midterms', 'State Testing Window', 'SAT']) {
      const c = classifyImported(t, 'school');
      expect(c.impact, t).toBe('heavy');
      expect(c.audience_tags, t).toContain('junior');
    }
  });

  it('flags administrative noise as ignorable', () => {
    for (const t of ['Picture Day', 'Book Fair', 'PTA Meeting', 'Report Cards Issued', 'Registration Opens']) {
      expect(classifyImported(t, 'school').ignore, t).toBe(true);
    }
  });
});

// The gap that prompted all of this: a swim meet schedule used to come in as
// an undifferentiated pile of "light" notes.
describe('swim & meet calendars', () => {
  it('treats championship meets as blocking', () => {
    for (const t of ['Divisionals', 'County Champs', 'All-Star Meet', 'Championship Meet', 'Junior Olympics', 'Far Westerns', 'Sectionals']) {
      const c = classifyImported(t, 'swim');
      expect(c.impact, t).toBe('blocking');
    }
  });

  it('treats regular meets as blocking too', () => {
    for (const t of ['Dual Meet vs Moraga', 'Home Meet', 'Away Meet', 'Swim Meet', 'Time Trials', 'Pentathlon', 'Relay Carnival', 'Invitational Meet']) {
      const c = classifyImported(t, 'swim');
      expect(c.impact, t).toBe('blocking');
      expect(c.audience_tags, t).toContain('family');
    }
  });

  it('knows practice is not a meet', () => {
    for (const t of ['Swim Team Practice', 'Morning Practice', 'Dryland']) {
      expect(classifyImported(t, 'swim').impact, t).toBe('light');
    }
  });

  it('flags swim socials as competing for the same families', () => {
    for (const t of ['Swim Banquet', 'End-of-Season Party', 'Pasta Feed']) {
      const c = classifyImported(t, 'swim');
      expect(c.impact, t).toBe('heavy');
      expect(c.audience_tags, t).toContain('family');
    }
  });

  it('handles water polo and diving', () => {
    expect(classifyImported('Water Polo Scrimmage', 'swim').impact).toBe('heavy');
    expect(classifyImported('Diving Meet', 'swim').impact).toBe('heavy');
  });

  it('does not treat lessons or lifeguard training as a conflict', () => {
    expect(classifyImported('Swim Lessons', 'swim').impact).toBe('light');
    expect(classifyImported('Lifeguard Training', 'swim').impact).toBe('light');
  });

  // The old behaviour: everything landed on 'light' and the plan learned nothing.
  it('assumes an unrecognised swim entry still occupies families', () => {
    const c = classifyImported('Blue Devils Splash Classic', 'swim');
    expect(c.impact).toBe('heavy');
    expect(c.ignore).toBe(false);
  });
});

describe('league schedules', () => {
  it('blocks league play', () => {
    for (const t of ['USTA League 3.5 Home Match', 'JTT Match Day', 'Junior Team Tennis', 'Interclub vs Diablo', 'Adult 4.0 Match', 'Mixed 40 Home']) {
      expect(classifyImported(t, 'usta').impact, t).toBe('blocking');
    }
  });

  it('blocks postseason play', () => {
    for (const t of ['Playoffs', 'Districts', 'NorCal Championships', 'Sectionals', 'Regionals']) {
      expect(classifyImported(t, 'usta').impact, t).toBe('blocking');
    }
  });

  it('keeps league admin light', () => {
    expect(classifyImported('Captains Meeting', 'usta').impact).toBe('light');
    expect(classifyImported('Line-up Due', 'usta').ignore).toBe(true);
  });

  it('assumes an unrecognised league row claims courts', () => {
    expect(classifyImported('Flight B vs Blackhawk', 'usta').impact).toBe('blocking');
  });
});

describe('facility calendars', () => {
  it('blocks closures and maintenance', () => {
    for (const t of ['Court Resurfacing', 'Courts 5-8 Closed', 'Pool Closed for Maintenance', 'Clubhouse Renovation', 'Construction']) {
      expect(classifyImported(t, 'facility').impact, t).toBe('blocking');
    }
  });

  it('blocks private rentals', () => {
    for (const t of ['Private Wedding Rental', 'Private Event', 'Full Buyout']) {
      expect(classifyImported(t, 'facility').impact, t).toBe('blocking');
    }
  });

  it('flags disruptive work as heavy', () => {
    expect(classifyImported('Deep Clean', 'facility').impact).toBe('heavy');
    expect(classifyImported('PSPS Power Shutoff', 'facility').impact).toBe('heavy');
  });

  it('assumes an unrecognised facility row closes something', () => {
    expect(classifyImported('North lot regrading', 'facility').impact).toBe('blocking');
  });
});

describe('club event calendars', () => {
  it('blocks flagship club events', () => {
    for (const t of ['Golf Member-Guest', 'Club Championships', 'Ladies Invitational', 'Calcutta']) {
      expect(classifyImported(t, 'club').impact, t).toBe('blocking');
    }
  });

  it('flags golf and socials as competing for members', () => {
    expect(classifyImported('Golf Shotgun Scramble', 'club').impact).toBe('heavy');
    expect(classifyImported('Wine Dinner', 'club').impact).toBe('heavy');
    expect(classifyImported('Member Appreciation Night', 'club').impact).toBe('heavy');
    expect(classifyImported('Trivia Night', 'club').impact).toBe('heavy');
  });

  it('flags junior programming as occupying courts and coaches', () => {
    const c = classifyImported('Junior Camp Week 3', 'club');
    expect(c.impact).toBe('heavy');
    expect(c.audience_tags).toContain('junior');
  });

  it('ignores meetings', () => {
    expect(classifyImported('Board Meeting', 'club').ignore).toBe(true);
    expect(classifyImported('Greens Committee Meeting', 'club').ignore).toBe(true);
  });
});

// The point of asking what kind of calendar it is: the same word means
// different things on different schedules.
describe('the calendar kind changes the reading', () => {
  it('reads "Championships" through the lens of the calendar it came from', () => {
    expect(classifyImported('Championship Meet', 'swim').note.toLowerCase()).toContain('meet');
    expect(classifyImported('Club Championships', 'club').note.toLowerCase()).toContain('club event');
  });

  it('defaults unknown rows differently per kind', () => {
    const t = 'Zephyr Cup';
    expect(classifyImported(t, 'school').impact).toBe('light');
    expect(classifyImported(t, 'swim').impact).toBe('heavy');
    expect(classifyImported(t, 'usta').impact).toBe('blocking');
    expect(classifyImported(t, 'facility').impact).toBe('blocking');
    expect(classifyImported(t, 'manual').impact).toBe('light');
  });

  it('still catches a hard closure on any calendar', () => {
    for (const k of ['school', 'swim', 'usta', 'club', 'facility', 'manual'] as CalendarKind[]) {
      expect(classifyImported('Court Resurfacing', k).impact, k).toBe('blocking');
    }
  });

  it('still catches league play on any calendar', () => {
    for (const k of ['school', 'swim', 'usta', 'club', 'facility', 'manual'] as CalendarKind[]) {
      expect(classifyImported('USTA League Match', k).impact, k).toBe('blocking');
    }
  });
});

describe('general behaviour', () => {
  it('is case- and punctuation-insensitive', () => {
    expect(classifyImported('SPRING BREAK', 'school').impact).toBe('favorable');
    expect(classifyImported('no school!', 'school').impact).toBe('favorable');
    expect(classifyImported('  DIVISIONALS  ', 'swim').impact).toBe('blocking');
  });

  it('drops an empty title', () => {
    expect(classifyImported('', 'school').ignore).toBe(true);
  });

  it('always explains itself', () => {
    const samples: Array<[string, CalendarKind]> = [
      ['Spring Break', 'school'], ['Divisionals', 'swim'], ['USTA Match', 'usta'],
      ['Something Unknown', 'club'], ['Picture Day', 'school'],
    ];
    for (const [t, k] of samples) expect(classifyImported(t, k).note.length, t).toBeGreaterThan(10);
  });

  it('offers a kind option for every classifier vocabulary', () => {
    const values = CALENDAR_KINDS.map((k) => k.value);
    expect(values).toContain('school');
    expect(values).toContain('swim');
    expect(values).toContain('usta');
    expect(values).toContain('club');
    expect(values).toContain('facility');
    for (const k of CALENDAR_KINDS) {
      expect(k.label.length).toBeGreaterThan(3);
      expect(k.hint.length).toBeGreaterThan(10);
      expect(k.examples.length).toBeGreaterThan(5);
    }
  });
});

describe('widenForLongSpans', () => {
  it('promotes a vague week-long entry to a real break', () => {
    const base = classifyImported('Miscellaneous Days', 'school');
    expect(base.impact).toBe('light');
    const widened = widenForLongSpans(base, 7);
    expect(widened.impact).toBe('heavy');
    expect(widened.note).toContain('7 days');
  });

  it('leaves short entries alone', () => {
    expect(widenForLongSpans(classifyImported('Miscellaneous Days', 'school'), 2).impact).toBe('light');
  });

  it('never downgrades an explicit classification', () => {
    expect(widenForLongSpans(classifyImported('Graduation', 'school'), 10).impact).toBe('blocking');
    expect(widenForLongSpans(classifyImported('Spring Break', 'school'), 10).impact).toBe('favorable');
  });

  it('leaves ignorable rows ignorable', () => {
    expect(widenForLongSpans(classifyImported('Book Fair', 'school'), 10).ignore).toBe(true);
  });
});
