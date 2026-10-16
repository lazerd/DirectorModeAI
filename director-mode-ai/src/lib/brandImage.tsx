/**
 * brandImage.tsx — the ClubMode mark and share card, drawn for `ImageResponse`.
 *
 * The file-based metadata routes (app/icon, app/apple-icon, app/opengraph-image,
 * app/twitter-image) render JSX through Satori, which cannot load lucide-react
 * or the app's CSS. So the lightning bolt is lucide's own Zap path, inlined, and
 * every style is a plain object. Keep it that way: no external fonts or images,
 * so the routes stay edge-safe and never fail on a network fetch.
 *
 * Satori rule worth knowing before editing: any element with more than one child
 * must be `display: flex`, or the render throws.
 */

export const BRAND = {
  ink: '#001820',
  deep: '#002838',
  lime: '#D3FB52',
} as const;

/** lucide-react v0.441 `Zap`, 24×24 viewBox. */
const ZAP_PATH =
  'M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z';

/** The lime rounded square with the dark bolt — the logo mark at any size. */
export function BrandMark({ size }: { size: number }) {
  const bolt = Math.round(size * 0.58);
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.24),
        background: BRAND.lime,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <svg width={bolt} height={bolt} viewBox="0 0 24 24">
        <path d={ZAP_PATH} fill={BRAND.deep} stroke={BRAND.deep} strokeWidth={1.5} strokeLinejoin="round" />
      </svg>
    </div>
  );
}

export const SHARE_CARD_SIZE = { width: 1200, height: 630 };
export const SHARE_CARD_ALT = 'ClubMode AI — Run your club from one screen.';

const TOOLS = ['CourtSheet', 'Leagues', 'Mixers', 'Tournaments', 'Lessons', 'Stringing'];

/** The 1200×630 link-preview card used for both OpenGraph and Twitter. */
export function ShareCard() {
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: '72px 80px',
        background: `linear-gradient(135deg, ${BRAND.ink} 0%, ${BRAND.deep} 100%)`,
        color: '#ffffff',
        fontFamily: 'sans-serif',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
        <BrandMark size={88} />
        <div style={{ display: 'flex', fontSize: 52, fontWeight: 700, letterSpacing: -1 }}>
          <span>ClubMode</span>
          <span style={{ color: BRAND.lime, marginLeft: 14 }}>AI</span>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', fontSize: 84, fontWeight: 700, letterSpacing: -2, lineHeight: 1.05 }}>
          Run your club from one screen.
        </div>
        <div style={{ display: 'flex', marginTop: 28, fontSize: 32, color: 'rgba(255,255,255,0.72)' }}>
          {TOOLS.join('  ·  ')}
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', fontSize: 28, color: 'rgba(255,255,255,0.55)' }}>
          For tennis & racquet-sports club directors
        </div>
        <div style={{ display: 'flex', fontSize: 30, fontWeight: 700, color: BRAND.lime }}>clubmode.ai</div>
      </div>
    </div>
  );
}

export const MIXER_SHARE_CARD_ALT = 'MixerMode by ClubMode — More play. Less planning. Run a free club mixer.';

/** A campaign landing page's link preview: one product, one invitation. */
function CampaignShareCard({ eyebrow, line1, line2, foot }: { eyebrow: string; line1: string; line2: string; foot: string }) {
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: '72px 80px',
        background: `linear-gradient(135deg, ${BRAND.ink} 0%, ${BRAND.deep} 100%)`,
        color: '#ffffff',
        fontFamily: 'sans-serif',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
        <BrandMark size={88} />
        <div style={{ display: 'flex', fontSize: 52, fontWeight: 700, letterSpacing: -1 }}>
          <span>ClubMode</span>
          <span style={{ color: BRAND.lime, marginLeft: 14 }}>AI</span>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', fontSize: 30, fontWeight: 600, color: BRAND.lime }}>
          {eyebrow}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', marginTop: 18, fontSize: 92, fontWeight: 700, letterSpacing: -2, lineHeight: 1.02 }}>
          <span>{line1}</span>
          <span style={{ color: 'rgba(255,255,255,0.5)' }}>{line2}</span>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', fontSize: 28, color: 'rgba(255,255,255,0.55)' }}>
          {foot}
        </div>
        <div style={{ display: 'flex', fontSize: 30, fontWeight: 700, color: BRAND.lime }}>clubmode.ai</div>
      </div>
    </div>
  );
}

export function MixerShareCard() {
  return <CampaignShareCard eyebrow="Meet MixerMode by ClubMode" line1="More play." line2="Less planning." foot="Run your next club mixer free. No account needed." />;
}

export const PULSE_SHARE_CARD_ALT = 'Director Pulse by ClubMode — What they make. What they charge.';

export function PulseShareCard() {
  return <CampaignShareCard eyebrow="Meet Director Pulse by ClubMode" line1="What they make." line2="What they charge." foot="Anonymous pay and pricing from racquet pros." />;
}
