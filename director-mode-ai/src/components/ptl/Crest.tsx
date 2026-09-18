'use client';

import { useId } from 'react';

/**
 * The PTL crest.
 *
 * A striped European shield with crossed racquets in saltire, PTL on the band
 * across the waist. Drawn as geometry rather than shipped as an image file, so
 * it is sharp at any size, themes itself, and costs one HTTP request of nothing.
 *
 * Two deliberate decisions worth not undoing:
 *
 *   No strings in the racquet frames. They are the first thing to disappear
 *   when a crest shrinks, and this mark has to survive 32px in a browser tab
 *   and a shirt badge across a court.
 *
 *   The NorCal byline is off by DEFAULT but on everywhere PTL currently renders
 *   — header, hero and footer — because Darrin asked for it there. The default
 *   stays off so the crest is clean wherever someone drops it in without
 *   thinking, and so that pulling NorCal's name back out of the whole product
 *   is three props rather than a redraw. Worth remembering that USTA NorCal
 *   have not greenlit the league yet, and their name is their mark.
 *
 * Colour: ink comes from `currentColor`, so the crest inherits whatever text
 * colour it sits in and works on light and dark without a second drawing. The
 * accent reads `--ptl-accent`, falling back to the league teal.
 */

type Variant = 'crest' | 'lockup' | 'horizontal';

type Props = {
  /** crest = shield only (favicons, avatars). lockup = stacked. horizontal = header. */
  variant?: Variant;
  /** Add "PRESENTED BY USTA NORCAL". Off until NorCal has actually agreed. */
  byline?: boolean;
  /** Rendered width. Height follows the viewBox. */
  width?: number | string;
  className?: string;
  /** Accessible name; pass null for a purely decorative instance. */
  title?: string | null;
};

const ACCENT = 'var(--ptl-accent, #0F766E)';
/** What the stripes and racquets are knocked out of — the surface behind the crest. */
const FIELD = 'var(--ptl-field, #FFFFFF)';
const FONT = 'Archivo, "Helvetica Neue", Arial, sans-serif';

const SHIELD = 'M16 10 H104 V68 C104 98 83 117 60 127 C37 117 16 98 16 68 Z';

/**
 * One racquet, upright around its own origin, so the pair can be crossed at
 * any angle and scale. "In saltire" is the heraldic term for two charges
 * crossed diagonally — the same slot crossed swords or keys occupy on a club
 * badge, which is why it reads as heraldry rather than tennis clip art.
 */
function Racquet({ id }: { id: string }) {
  return (
    <g id={id}>
      {/*
        Proportions matter more than detail here. A real racquet is roughly half
        head, and the first draft made the head a third — at crest size that
        reads as a pair of scissors, not racquets. So: big head, thin-ish frame
        so the string bed stays open at small sizes, short handle.
      */}
      <ellipse cx="0" cy="-31" rx="17" ry="21" fill="none" stroke="currentColor" strokeWidth="5" />
      <path d="M-10 -12 L-5 2 M10 -12 L5 2" fill="none" stroke="currentColor" strokeWidth="4.5" strokeLinecap="round" />
      <rect x="-4.2" y="0" width="8.4" height="22" rx="3" fill="currentColor" />
      <rect x="-6" y="16" width="12" height="8" rx="2.5" fill="currentColor" />
    </g>
  );
}

/** The shield itself, in its own 120x138 box. */
function Shield({ uid }: { uid: string }) {
  const clip = `ptl-clip-${uid}`;
  const racquet = `ptl-racquet-${uid}`;
  return (
    <>
      <defs>
        <clipPath id={clip}>
          <path d={SHIELD} />
        </clipPath>
        <Racquet id={racquet} />
      </defs>

      <g clipPath={`url(#${clip})`}>
        <rect x="16" y="10" width="88" height="118" fill="currentColor" />
        <rect x="38" y="10" width="15" height="118" fill={ACCENT} />
        <rect x="67" y="10" width="15" height="118" fill={ACCENT} />
        {/* knocked out of the stripes, so they read on either colour beneath */}
        {/* Drawn large enough to fill the upper field. Small racquets crossed
            over a big empty shield is what makes the pair read as scissors —
            every real crossed-racquet crest uses heads that nearly touch the
            shield edges, with the handles crossing low and short. */}
        <g color={FIELD}>
          <use href={`#${racquet}`} transform="translate(60 46) rotate(-40) scale(0.68)" />
          <use href={`#${racquet}`} transform="translate(60 46) rotate(40) scale(0.68)" />
        </g>
      </g>

      <path d={SHIELD} fill="none" stroke="currentColor" strokeWidth="5" />

      {/* The name band runs past the shield edge on both sides, the way a club
          band does — it is what stops the stripes and the racquets competing. */}
      <rect x="10" y="62" width="100" height="27" fill="currentColor" />
      <text
        x="60"
        y="82"
        textAnchor="middle"
        fontFamily={FONT}
        fontWeight="900"
        fontSize="22"
        letterSpacing="1"
        fill={FIELD}
      >
        PTL
      </text>
    </>
  );
}

const WORDMARK = 'PREMIER TENNIS LEAGUE';
const BYLINE = 'PRESENTED BY USTA NORCAL';

export function PtlCrest({
  variant = 'lockup',
  byline = false,
  width,
  className,
  title = 'Premier Tennis League',
}: Props) {
  // Ids must be unique per instance or two crests on one page share a clipPath
  // and the second one renders as a rectangle.
  const uid = useId().replace(/:/g, '');

  const viewBox =
    variant === 'crest' ? '0 0 120 138'
    : variant === 'horizontal' ? '0 0 420 150'
    : byline ? '0 0 250 222'
    : '0 0 250 196';

  const a11y = title
    ? { role: 'img' as const, 'aria-label': title }
    : { 'aria-hidden': true as const };

  return (
    <svg
      viewBox={viewBox}
      width={width}
      className={className}
      style={{ height: 'auto', display: 'block', maxWidth: '100%' }}
      {...a11y}
    >
      {variant === 'crest' && <Shield uid={uid} />}

      {variant === 'lockup' && (
        <>
          <g transform="translate(65 0)">
            <Shield uid={uid} />
          </g>
          <text
            x="125" y="168" textAnchor="middle" fontFamily={FONT}
            fontWeight="700" fontSize="12.5" letterSpacing="2.7" fill="currentColor"
          >
            {WORDMARK}
          </text>
          {byline && (
            <>
              <rect x="90" y="182" width="70" height="1.5" fill="currentColor" opacity="0.32" />
              <text
                x="125" y="202" textAnchor="middle" fontFamily={FONT}
                fontWeight="500" fontSize="8.2" letterSpacing="2.4"
                fill="currentColor" opacity="0.62"
              >
                {BYLINE}
              </text>
            </>
          )}
        </>
      )}

      {variant === 'horizontal' && (
        <>
          <g transform="translate(6 8) scale(0.967)">
            <Shield uid={uid} />
          </g>
          <text
            x="140" y={byline ? 64 : 80} fontFamily={FONT}
            fontWeight="800" fontSize="17" letterSpacing="2.6" fill="currentColor"
          >
            {WORDMARK}
          </text>
          {byline && (
            <>
              <rect x="140" y="76" width="254" height="1.5" fill={ACCENT} />
              <text
                x="140" y="97" fontFamily={FONT} fontWeight="500" fontSize="9"
                letterSpacing="2.2" fill="currentColor" opacity="0.62"
              >
                {BYLINE}
              </text>
            </>
          )}
        </>
      )}
    </svg>
  );
}

export default PtlCrest;
