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

import { FONT_CHOICES, TEXT_SIZES } from './schema';

export type TextSize = (typeof TEXT_SIZES)[number];

export type ClubTheme = {
  primary: string;
  secondary: string;
  ink: string;
  cream: string;
  surface: string;
  /** A real CSS font stack, never a bare family name the visitor may not have. */
  fontFamily: string;
  headingFamily: string;
  /** 'large' for clubs whose members read better at ~19px. See largeTextCss. */
  textSize: TextSize;
};

const DEFAULT: Omit<ClubTheme, 'fontFamily' | 'headingFamily' | 'textSize'> = {
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
  text_size?: string | null;
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
    textSize: site?.text_size === 'large' ? 'large' : 'standard',
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

/**
 * The club's ink at `alpha`, for SECONDARY TEXT — darker when text is large.
 *
 * The pages draw captions, dates and labels as the ink colour faded to
 * 55–70%. On a cream ground that is fine for most eyes and a strain for the
 * members a large-text club turned it on for, so large text lifts any
 * text-strength tint to at least 85%. Borders and panel washes (alpha below
 * 0.35) are left alone — darkening those would make the page heavier, not more
 * readable. With standard text this is exactly `tint(theme.ink, alpha)`, so a
 * club that never touches the setting renders byte-for-byte as before.
 */
export function inkTint(theme: Pick<ClubTheme, 'ink' | 'textSize'>, alpha: number): string {
  if (theme.textSize === 'large' && alpha >= 0.35) return tint(theme.ink, Math.max(alpha, 0.85));
  return tint(theme.ink, alpha);
}

/**
 * The stylesheet a large-text page adds, or '' for standard.
 *
 * Done by raising the ROOT font size rather than rewriting every Tailwind size
 * class on every club page: the pages size everything in rem, so one rule
 * scales body text to 19px and every heading, gap and card with it, in
 * proportion — the same page, just bigger, which is what "easier to read"
 * should mean. It is rendered inside the club's own page tree, so it leaves
 * with the page on navigation and never reaches the director app.
 *
 * On top of that: inputs whose font size is set inline in px (the registration
 * form) are brought up to match, anything tappable is at least 44px tall (the
 * WCAG target size), and on the DARK shared surfaces — court sheet, calendar —
 * the faded white/40–60 captions are lifted, since those use Tailwind opacity
 * classes that inkTint cannot reach.
 */
export function largeTextCss(textSize: TextSize | null | undefined): string {
  if (textSize !== 'large') return '';
  return [
    'html{font-size:118.75%}',
    'input,select,textarea{font-size:1.05rem!important}',
    'button,select,input:not([type=checkbox]):not([type=radio]):not([type=hidden]),[role=button]{min-height:44px}',
    'a.inline-block,a.block,a[class*="rounded"]{min-height:44px}',
    'a.inline-block{padding-top:.5rem;padding-bottom:.5rem}',
    // A button-shaped link that grew to 44px keeps its label centred in it.
    'a.rounded-lg:not(.block),a.rounded-xl:not(.block){display:inline-flex;align-items:center;justify-content:center}',
    '[class*="text-white/30"],[class*="text-white/40"],[class*="text-white/50"],[class*="text-white/60"]{color:rgba(255,255,255,.85)!important}',
    '.opacity-40,.opacity-50,.opacity-60{opacity:.85!important}',
  ].join('\n');
}
