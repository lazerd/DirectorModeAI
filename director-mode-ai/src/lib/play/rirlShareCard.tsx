/**
 * Link-preview card for Racquets IRL (iMessage, WhatsApp, Slack, text marketing).
 * Used by /racquetsirl, the signed-out homepage and /play/new. Edge-safe (no fonts/files).
 */
export const RIRL_CARD_SIZE = { width: 1200, height: 630 };
export const RIRL_CARD_ALT = 'Racquets IRL: Racquet Sports. Together. In Real Life. Free to use. No login needed.';

export function RirlShareCard() {
  const ink = '#103c32', lime = '#d4ff49', soft = '#bccdbb';
  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', background: ink, color: '#fff', padding: '64px 72px', fontFamily: 'sans-serif' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
        <div style={{ width: 56, height: 56, borderRadius: 18, background: lime, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 30, fontWeight: 800, color: ink }}>IRL</div>
        <div style={{ fontSize: 30, color: soft, letterSpacing: 4, textTransform: 'uppercase', display: 'flex' }}>Tennis · Pickleball · Padel</div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <div style={{ fontSize: 132, fontWeight: 700, letterSpacing: -5, lineHeight: 1, display: 'flex' }}>Racquets IRL</div>
        <div style={{ fontSize: 46, marginTop: 22, color: lime, display: 'flex' }}>Racquet Sports. Together. In Real Life.</div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div style={{ fontSize: 32, color: '#e8efe4', display: 'flex', maxWidth: 760 }}>One link. Everyone signs up. Courts done for you.</div>
        <div style={{ background: lime, color: ink, borderRadius: 999, padding: '14px 30px', fontSize: 32, fontWeight: 700, display: 'flex', flexShrink: 0, whiteSpace: 'nowrap' }}>Free · No login</div>
      </div>
    </div>
  );
}
