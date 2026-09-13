/**
 * How the live console looks on the clubhouse TV.
 *
 * The console is cast to a screen people stand in front of, and for a themed
 * social — a US Open watch party, Oktoberfest doubles — the club wants the
 * screen to look like the occasion rather than like ClubMode.
 *
 * NAMED themes, selected by `events.display_theme`, never hex typed onto an
 * event. Two reasons. A director picking colours on a phone produces yellow
 * text on white; and the contrast of a named theme is tested once here rather
 * than re-argued per event.
 *
 * NO TRADEMARKED MARKS. A palette evokes an occasion and belongs to nobody; a
 * wordmark belongs to someone, and one baked into this file would ship to every
 * club on the platform. A club that wants the actual logo on its own TV sets
 * `events.logo_url` — that is the club's own call, on the club's own screen,
 * and it stays out of the product.
 */

export type DisplayTheme = {
  /** The name a director sees when choosing. */
  label: string;
  /** Page background. */
  ground: string;
  /** Cards sitting on the ground. */
  panel: string;
  /** Borders and dividers. */
  line: string;
  /** Headings, court numbers, the accent everything reads against. */
  accent: string;
  /** Text ON the accent. */
  onAccent: string;
  /** A court with a match in progress — the one thing to spot from across a room. */
  live: string;
  /** Body text and secondary text. */
  text: string;
  muted: string;
  /** Optional one-line dressing above the event name. */
  kicker: string | null;
};

/**
 * ClubMode's own look, and the fallback for every event without a theme.
 * Identical to what the console rendered before themes existed, so an
 * unthemed event is unchanged.
 */
export const DEFAULT_THEME: DisplayTheme = {
  label: 'ClubMode',
  ground: '#001820',
  panel: 'rgba(255,255,255,0.05)',
  line: 'rgba(255,255,255,0.10)',
  accent: '#D3FB52',
  onAccent: '#001820',
  live: '#34d399',
  text: '#ffffff',
  muted: 'rgba(255,255,255,0.45)',
  kicker: null,
};

export const DISPLAY_THEMES: Record<string, DisplayTheme> = {
  /**
   * US Open watch party.
   *
   * The palette everyone recognises without a single mark being copied: the
   * deep navy of the night session, the distinctive blue of the Flushing
   * Meadows hard court, the tournament yellow — and Honey Deuce pink for the
   * live court, because that is what is in everyone's hand at 11am.
   */
  'us-open': {
    label: 'US Open',
    ground: '#0C2340',
    panel: 'rgba(29,109,181,0.20)',
    line: 'rgba(255,212,0,0.28)',
    accent: '#FFD400',
    onAccent: '#0C2340',
    live: '#FF5C8A',
    text: '#ffffff',
    muted: 'rgba(255,255,255,0.55)',
    kicker: 'US Open Watch Party',
  },

  /** Wimbledon: the dark green and aubergine, and nothing else. */
  wimbledon: {
    label: 'Wimbledon',
    ground: '#0E3B2E',
    panel: 'rgba(255,255,255,0.07)',
    line: 'rgba(255,255,255,0.16)',
    accent: '#F2E8C9',
    onAccent: '#0E3B2E',
    live: '#C9A227',
    text: '#ffffff',
    muted: 'rgba(255,255,255,0.55)',
    kicker: 'Wimbledon Watch Party',
  },

  /** Autumn social — Oktoberfest, fall leagues, anything September to November. */
  autumn: {
    label: 'Autumn',
    ground: '#2A1A0E',
    panel: 'rgba(255,255,255,0.06)',
    line: 'rgba(230,145,56,0.30)',
    accent: '#E69138',
    onAccent: '#2A1A0E',
    live: '#F6B26B',
    text: '#ffffff',
    muted: 'rgba(255,255,255,0.55)',
    kicker: null,
  },
};

/** Every theme a director may pick, default first. */
export const THEME_CHOICES: { value: string | null; label: string }[] = [
  { value: null, label: DEFAULT_THEME.label },
  ...Object.entries(DISPLAY_THEMES).map(([value, t]) => ({ value, label: t.label })),
];

/**
 * The theme for an event.
 *
 * An unknown name falls back to the default rather than throwing: a typo in a
 * column must never take the TV down mid-event.
 */
export function displayTheme(name: string | null | undefined): DisplayTheme {
  if (!name) return DEFAULT_THEME;
  return DISPLAY_THEMES[name.trim().toLowerCase()] ?? DEFAULT_THEME;
}

/** CSS custom properties, so the page styles itself without prop-threading. */
export function themeVars(t: DisplayTheme): React.CSSProperties {
  return {
    '--ev-ground': t.ground,
    '--ev-panel': t.panel,
    '--ev-line': t.line,
    '--ev-accent': t.accent,
    '--ev-on-accent': t.onAccent,
    '--ev-live': t.live,
    '--ev-text': t.text,
    '--ev-muted': t.muted,
  } as React.CSSProperties;
}
