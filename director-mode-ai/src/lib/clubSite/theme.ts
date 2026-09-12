/**
 * A club's palette, resolved.
 *
 * The five keys are deliberately the same as `Sponsor.colors` in
 * config/sponsors.ts, because the technique that already works on a
 * public-facing branded page in this app is that shape applied as INLINE
 * styles (see components/quads/SponsoredQuadLanding.tsx). Tailwind classes
 * cannot carry a color that arrives from the database at request time.
 *
 * Why a default palette at all: the club site has to look finished the moment
 * a row exists, before anyone has picked a color. The default is a warm,
 * neutral club look — not ClubMode's own dark teal and lime, because the whole
 * point of this page is that it belongs to the club and not to us.
 */

import { FONT_CHOICES } from './schema';

export type ClubTheme = {
  primary: string;
  secondary: string;
  ink: string;
  cream: string;
  surface: string;
  /** A real CSS font stack, never a bare family name the visitor may not have. */
  fontFamily: string;
  headingFamily: string;
};

const DEFAULT: Omit<ClubTheme, 'fontFamily' | 'headingFamily'> = {
  primary: '#14532d',
  secondary: '#b8860b',
  ink: '#1c2321',
  cream: '#faf7f2',
  surface: '#ffffff',
};

/**
 * Three stacks, chosen rather than typed. A free-text font field means a club
 * picks a family nobody else has installed and every visitor sees Times.
 * Barlow is already loaded globally in app/layout.tsx, so 'condensed' costs
 * nothing extra.
 */
const FONTS: Record<(typeof FONT_CHOICES)[number], { body: string; heading: string }> = {
  sans: {
    body: '"Inter", system-ui, -apple-system, "Segoe UI", sans-serif',
    heading: '"Inter", system-ui, -apple-system, "Segoe UI", sans-serif',
  },
  serif: {
    body: 'Georgia, "Iowan Old Style", "Times New Roman", serif',
    heading: 'Georgia, "Iowan Old Style", "Times New Roman", serif',
  },
  condensed: {
    body: '"Barlow", system-ui, -apple-system, sans-serif',
    heading: '"Barlow Condensed", "Barlow", system-ui, sans-serif',
  },
};

type ThemeSource = {
  color_primary?: string | null;
  color_secondary?: string | null;
  color_ink?: string | null;
  color_cream?: string | null;
  color_surface?: string | null;
  font_choice?: string | null;
};

const hex = (value: string | null | undefined, fallback: string): string => {
  const v = (value || '').trim();
  return /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(v) ? v : fallback;
};

export function resolveTheme(site: ThemeSource | null | undefined): ClubTheme {
  const choice = (site?.font_choice || 'sans') as (typeof FONT_CHOICES)[number];
  const fonts = FONTS[choice] ?? FONTS.sans;
  return {
    primary: hex(site?.color_primary, DEFAULT.primary),
    secondary: hex(site?.color_secondary, DEFAULT.secondary),
    ink: hex(site?.color_ink, DEFAULT.ink),
    cream: hex(site?.color_cream, DEFAULT.cream),
    surface: hex(site?.color_surface, DEFAULT.surface),
    fontFamily: fonts.body,
    headingFamily: fonts.heading,
  };
}

/**
 * Black or white, whichever is readable on the given background.
 *
 * A club will pick a pale yellow for its primary and put white text on it
 * otherwise. Relative luminance per WCAG, so the choice is the accessible one
 * rather than a guess from the hex digits.
 */
export function readableOn(background: string): string {
  const h = background.replace('#', '');
  const full = h.length === 3 ? h.replace(/./g, (c) => c + c) : h;
  const n = parseInt(full, 16);
  if (Number.isNaN(n)) return '#ffffff';
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const luminance =
    0.2126 * channel((n >> 16) & 255) +
    0.7152 * channel((n >> 8) & 255) +
    0.0722 * channel(n & 255);
  // Contrast against white vs against black; pick the better one.
  return (1.05) / (luminance + 0.05) >= (luminance + 0.05) / 0.05 ? '#ffffff' : '#111111';
}

/** `#14532d` at 12% — for tinted panels, without a second color field. */
export function tint(color: string, alpha: number): string {
  const h = color.replace('#', '');
  const full = h.length === 3 ? h.replace(/./g, (c) => c + c) : h;
  const n = parseInt(full, 16);
  if (Number.isNaN(n)) return `rgba(0,0,0,${alpha})`;
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}
