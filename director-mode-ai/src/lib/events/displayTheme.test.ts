import { describe, it, expect } from 'vitest';
import { contrast } from '@/lib/clubSite/chrome';
import {
  DEFAULT_THEME,
  DISPLAY_THEMES,
  THEME_CHOICES,
  displayTheme,
} from './displayTheme';

/**
 * A themed console is cast to a TV that people read from across a room.
 *
 * So the test is legibility, measured — a pretty palette that renders the
 * court number unreadable at ten feet is worse than ClubMode's own colours.
 * Contrast comes from lib/clubSite/chrome rather than a second copy of the
 * WCAG maths, so the two cannot drift.
 */

describe('displayTheme', () => {
  it('falls back to ClubMode for no theme', () => {
    expect(displayTheme(null)).toBe(DEFAULT_THEME);
    expect(displayTheme(undefined)).toBe(DEFAULT_THEME);
    expect(displayTheme('')).toBe(DEFAULT_THEME);
  });

  it('never throws on a typo — a bad column must not take the TV down', () => {
    expect(displayTheme('us open')).toBe(DEFAULT_THEME);
    expect(displayTheme('nonsense')).toBe(DEFAULT_THEME);
  });

  it('is forgiving about case and stray spaces', () => {
    expect(displayTheme('  US-Open ')).toBe(DISPLAY_THEMES['us-open']);
  });

  it('reads across a room in every theme', () => {
    // 4.5:1 is the small-text bar; a court number on a TV deserves at least
    // that against its own background.
    for (const [name, t] of Object.entries({ default: DEFAULT_THEME, ...DISPLAY_THEMES })) {
      expect(contrast(t.text, t.ground), `${name} text`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(t.accent, t.ground), `${name} accent`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(t.onAccent, t.accent), `${name} on-accent`).toBeGreaterThanOrEqual(4.5);
      // The live court is the one thing to spot from the far side of the room.
      expect(contrast(t.live, t.ground), `${name} live`).toBeGreaterThanOrEqual(3);
    }
  });

  it('keeps the live colour distinct from the accent', () => {
    // If "in progress" looks like every heading, the screen stops answering
    // the only question people walk up to it with.
    for (const [name, t] of Object.entries(DISPLAY_THEMES)) {
      expect(t.live.toLowerCase(), name).not.toBe(t.accent.toLowerCase());
    }
  });

  it('offers the default first, then every theme', () => {
    expect(THEME_CHOICES[0].value).toBeNull();
    expect(THEME_CHOICES.map((c) => c.value)).toContain('us-open');
    expect(THEME_CHOICES).toHaveLength(Object.keys(DISPLAY_THEMES).length + 1);
  });

  it('dresses the US Open screen without borrowing a mark', () => {
    const t = DISPLAY_THEMES['us-open'];
    expect(t.kicker).toBe('US Open Watch Party');
    // Palette only — no logo, wordmark or asset URL anywhere in a theme.
    expect(JSON.stringify(t)).not.toMatch(/http|\.svg|\.png|logo/i);
  });
});
