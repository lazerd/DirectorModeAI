import { describe, it, expect } from 'vitest';
import {
  MIN_ACCENT_CONTRAST,
  MIN_TEXT_CONTRAST,
  contrast,
  darkGround,
  darken,
  legibleAccent,
  lighten,
  luminance,
  resolveChrome,
} from './chrome';
import { resolveTheme } from './theme';

/**
 * Branding a dark page with a light palette.
 *
 * Worth testing because the naive version is actively harmful and looks fine
 * in code review: hand Lafayette's #14532d forest green to a near-black page
 * as the accent and every label on the court sheet becomes invisible. The club
 * gets a page that is branded and unusable, which is strictly worse than one
 * that is neither.
 */

describe('contrast', () => {
  it('matches the WCAG extremes', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 1);
    expect(contrast('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
  });

  it('does not care which way round the arguments go', () => {
    expect(contrast('#14532d', '#ffffff')).toBeCloseTo(contrast('#ffffff', '#14532d'), 6);
  });
});

describe('luminance', () => {
  it('places known colours in the right order', () => {
    expect(luminance('#000000')).toBe(0);
    expect(luminance('#ffffff')).toBeCloseTo(1, 5);
    expect(luminance('#14532d')).toBeLessThan(luminance('#b8860b'));
  });

  it('survives junk instead of throwing', () => {
    expect(luminance('not a colour')).toBe(0);
    expect(luminance('')).toBe(0);
  });
});

describe('darken / lighten', () => {
  it('moves toward black and white', () => {
    expect(luminance(darken('#14532d', 0.5))).toBeLessThan(luminance('#14532d'));
    expect(luminance(lighten('#14532d', 0.5))).toBeGreaterThan(luminance('#14532d'));
  });

  it('keeps the hue when lightening — a green club stays green', () => {
    // Not white: the whole point is that the club's colour survives.
    const lit = lighten('#14532d', 0.5);
    expect(lit).not.toBe('#ffffff');
    // Green still the dominant channel.
    const g = parseInt(lit.slice(3, 5), 16);
    const r = parseInt(lit.slice(1, 3), 16);
    expect(g).toBeGreaterThan(r);
  });

  it('clamps rather than overflowing', () => {
    expect(lighten('#ffffff', 1)).toBe('#ffffff');
    expect(darken('#000000', 1)).toBe('#000000');
  });
});

describe('legibleAccent', () => {
  it('leaves a colour alone when it already works', () => {
    // ClubMode's own lime on its own dark teal — already legible.
    expect(legibleAccent(['#D3FB52'], '#001820')).toBe('#D3FB52');
  });

  it('lightens a dark club colour rather than shipping it unreadable', () => {
    // Lafayette's forest green on a near-black ground: 1.4:1 as given.
    const ground = '#141a18';
    expect(contrast('#14532d', ground)).toBeLessThan(MIN_ACCENT_CONTRAST);
    const accent = legibleAccent(['#14532d'], ground);
    expect(contrast(accent, ground)).toBeGreaterThanOrEqual(MIN_ACCENT_CONTRAST);
    expect(accent).not.toBe('#ffffff');
  });

  it('prefers whichever club colour already passes', () => {
    // Goldenrod passes on near-black where the forest green does not, so the
    // club's own secondary is used untouched rather than a lightened primary.
    expect(legibleAccent(['#14532d', '#b8860b'], '#141a18')).toBe('#b8860b');
  });

  it('lifts even an all-black palette to something legible, not to white', () => {
    /*
     * The guarantee is legibility, and white is the LAST resort rather than
     * the shortcut — so a club with nothing but black still gets a grey that
     * passes instead of ClubMode deciding their accent is white.
     */
    const accent = legibleAccent(['#000000'], '#000000');
    expect(contrast(accent, '#000000')).toBeGreaterThanOrEqual(MIN_ACCENT_CONTRAST);
    expect(accent).not.toBe('#ffffff');
  });

  it('reaches white only where lightening cannot help at all', () => {
    // A light ground, which darkGround never produces — proof the last resort
    // exists rather than being dead code.
    expect(legibleAccent(['#ffffff'], '#ffffff')).toBe('#ffffff');
  });

  it('ignores junk colours instead of emitting them', () => {
    expect(legibleAccent(['nope', '#D3FB52'], '#001820')).toBe('#D3FB52');
    expect(legibleAccent(['nope'], '#001820')).toBe('#ffffff');
  });
});

describe('darkGround', () => {
  it('uses the club’s own darkest colour when it is dark enough', () => {
    expect(darkGround({ primary: '#14532d', ink: '#0a0c0b', secondary: '#b8860b' })).toBe('#0a0c0b');
  });

  it('darkens a bright palette instead of defaulting to neutral black', () => {
    // A club of pastels still gets a ground derived from their hue.
    const ground = darkGround({ primary: '#88ccee', ink: '#446677', secondary: '#ffddaa' });
    expect(luminance(ground)).toBeLessThan(0.04);
    expect(ground).not.toBe('#000000');
  });

  it('survives a club with no valid colours', () => {
    expect(darkGround({ primary: '', ink: '', secondary: '' })).toBe('#001820');
  });
});

describe('resolveChrome', () => {
  it('produces a readable page for Lafayette’s real palette', () => {
    // Exactly the row in the database: forest green, goldenrod, near-black ink.
    const theme = resolveTheme({
      color_primary: '#14532d',
      color_secondary: '#b8860b',
      color_ink: '#1c2321',
      color_cream: '#faf7f2',
      color_surface: '#ffffff',
      font_choice: 'condensed',
    });
    const chrome = resolveChrome(theme);

    expect(contrast(chrome.accent, chrome.ground)).toBeGreaterThanOrEqual(MIN_ACCENT_CONTRAST);
    expect(contrast(chrome.text, chrome.ground)).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
    expect(contrast(chrome.onAccent, chrome.accent)).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
    // The panel must be distinguishable from the ground or cards vanish.
    expect(chrome.panel).not.toBe(chrome.ground);
    // And it must carry the club's font through, not ClubMode's.
    expect(chrome.headingFamily).toContain('Barlow Condensed');
  });

  it('keeps text legible for every default and extreme palette', () => {
    const palettes = [
      {}, // the default club look
      { color_primary: '#000000', color_secondary: '#000000', color_ink: '#000000' },
      { color_primary: '#ffffff', color_secondary: '#ffffff', color_ink: '#ffffff' },
      { color_primary: '#ffff00', color_secondary: '#00ffff', color_ink: '#ff00ff' },
      { color_primary: 'garbage', color_secondary: null, color_ink: undefined },
    ];
    for (const p of palettes) {
      const chrome = resolveChrome(resolveTheme(p));
      expect(contrast(chrome.text, chrome.ground)).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
      expect(contrast(chrome.accent, chrome.ground)).toBeGreaterThanOrEqual(MIN_ACCENT_CONTRAST);
      expect(contrast(chrome.onAccent, chrome.accent)).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
    }
  });
});
