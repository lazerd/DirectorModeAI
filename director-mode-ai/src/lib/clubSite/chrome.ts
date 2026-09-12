/**
 * A club's palette, re-derived for ClubMode's DARK public surfaces.
 *
 * The club site at /c/[slug] is light: cream ground, dark ink, club colour on
 * top. The shared surfaces a club site links out to — the court sheet, the
 * calendar, open court time — are dark, because they were built as ClubMode's
 * own pages long before any club had a palette.
 *
 * So this cannot be a copy of the light theme. Lafayette's primary is
 * #14532d, a dark forest green: perfect as a header behind white text, and
 * invisible as an accent on a near-black ground. Handing the light palette
 * straight to a dark layout produces a page that is branded and unreadable,
 * which is worse than one that is neither.
 *
 * What this does instead is pick a dark GROUND from the club's own colours and
 * then find an ACCENT that is guaranteed legible on it — lightening the club's
 * colour as far as it takes, and only giving up on the club's hue entirely
 * when even white would be needed. Contrast is measured, not eyeballed: WCAG
 * relative luminance, the same maths as readableOn.
 *
 * Pure, and shared by the style layer and its tests.
 */

import type { ClubTheme } from './theme';

/** Minimum contrast for accent text on the ground. WCAG AA for large text. */
export const MIN_ACCENT_CONTRAST = 3.0;
/** Minimum for body text, which is small and carries the actual information. */
export const MIN_TEXT_CONTRAST = 4.5;

export type ClubChrome = {
  /** The page background. Always dark. */
  ground: string;
  /** Cards and inputs sitting on the ground — a touch lighter. */
  panel: string;
  /** The club's colour, made legible on the ground. */
  accent: string;
  /** Black or white, for text ON the accent. */
  onAccent: string;
  /** Body text. */
  text: string;
  /** Secondary text. */
  muted: string;
  border: string;
  fontFamily: string;
  headingFamily: string;
};

/* ------------------------------------------------------------ colour maths */

type Rgb = { r: number; g: number; b: number };

export function parseHex(hex: string): Rgb | null {
  const h = (hex || '').replace('#', '').trim();
  const full = h.length === 3 ? h.replace(/./g, (c) => c + c) : h;
  if (!/^[0-9a-f]{6}$/i.test(full)) return null;
  const n = parseInt(full, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

const toHex = (c: Rgb): string =>
  `#${[c.r, c.g, c.b]
    .map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0'))
    .join('')}`;

/** WCAG relative luminance, 0 (black) to 1 (white). */
export function luminance(hex: string): number {
  const c = parseHex(hex);
  if (!c) return 0;
  const channel = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
}

/** WCAG contrast ratio between two colours, 1 (identical) to 21 (black/white). */
export function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** Toward black. `amount` 0..1. */
export function darken(hex: string, amount: number): string {
  const c = parseHex(hex);
  if (!c) return hex;
  const k = 1 - Math.max(0, Math.min(1, amount));
  return toHex({ r: c.r * k, g: c.g * k, b: c.b * k });
}

/** Toward white. `amount` 0..1. Keeps the hue, which is the point. */
export function lighten(hex: string, amount: number): string {
  const c = parseHex(hex);
  if (!c) return hex;
  const k = Math.max(0, Math.min(1, amount));
  return toHex({
    r: c.r + (255 - c.r) * k,
    g: c.g + (255 - c.g) * k,
    b: c.b + (255 - c.b) * k,
  });
}

/**
 * The club's colour, lightened until it is legible on `ground`.
 *
 * Steps rather than solving directly, because each step must stay ON the
 * club's hue — a club whose green ends up as a different green is still their
 * green, a club whose green ends up white is not branded at all. White is the
 * last resort, not the shortcut.
 */
export function legibleAccent(
  candidates: string[],
  ground: string,
  min = MIN_ACCENT_CONTRAST,
): string {
  const valid = candidates.filter((c) => parseHex(c));

  // Anything already legible, best first — no need to touch a club's colour
  // that works as it is.
  const asIs = valid
    .map((c) => ({ c, ratio: contrast(c, ground) }))
    .filter((x) => x.ratio >= min)
    .sort((a, b) => b.ratio - a.ratio)[0];
  if (asIs) return asIs.c;

  // Otherwise lighten each, keeping the hue, and take the first that passes.
  for (const step of [0.2, 0.35, 0.5, 0.65, 0.8]) {
    for (const c of valid) {
      const lit = lighten(c, step);
      if (contrast(lit, ground) >= min) return lit;
    }
  }
  return '#ffffff';
}

/**
 * A dark ground from the club's own colours.
 *
 * Their darkest colour if it is genuinely dark, else their primary darkened
 * until it is — so the page still reads as theirs rather than defaulting to a
 * neutral black the moment a club picks bright colours.
 */
export function darkGround(theme: Pick<ClubTheme, 'primary' | 'ink' | 'secondary'>): string {
  const TARGET = 0.035; // luminance of a comfortable near-black
  const candidates = [theme.ink, theme.primary, theme.secondary].filter((c) => parseHex(c));
  if (candidates.length === 0) return '#001820';

  const darkest = candidates.sort((a, b) => luminance(a) - luminance(b))[0];
  if (luminance(darkest) <= TARGET) return darkest;

  for (const step of [0.3, 0.5, 0.65, 0.8, 0.9]) {
    const d = darken(darkest, step);
    if (luminance(d) <= TARGET) return d;
  }
  return darken(darkest, 0.92);
}

/* ------------------------------------------------------------- the resolver */

export function resolveChrome(theme: ClubTheme): ClubChrome {
  const ground = darkGround(theme);
  const accent = legibleAccent([theme.primary, theme.secondary], ground);

  /*
   * Text is white-ish rather than the club's cream, because a club may set
   * cream to something that fails on their own dark ground — and body text is
   * the one thing that must never be a branding casualty. Checked anyway.
   */
  const text = contrast('#ffffff', ground) >= MIN_TEXT_CONTRAST ? '#ffffff' : '#111111';

  return {
    ground,
    // A panel is the ground lifted toward the accent, so cards feel part of
    // the same palette instead of grey boxes on a coloured page.
    panel: lighten(ground, 0.07),
    accent,
    onAccent: contrast('#ffffff', accent) >= MIN_TEXT_CONTRAST ? '#ffffff' : '#111111',
    text,
    muted: text === '#ffffff' ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.6)',
    border: text === '#ffffff' ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.14)',
    fontFamily: theme.fontFamily,
    headingFamily: theme.headingFamily,
  };
}
