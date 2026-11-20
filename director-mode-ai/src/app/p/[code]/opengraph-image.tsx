import { ImageResponse } from 'next/og';

// The card a group chat shows when someone pastes the link. Edge + plain REST
// (same Windows font-path reason as app/opengraph-image.tsx).
export const runtime = 'edge';
export const alt = 'Racquets IRL game';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const get = async (path: string) => {
  const r = await fetch(`${URL_}/rest/v1/${path}`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` }, cache: 'no-store' });
  return r.ok ? r.json() : [];
};

export default async function Image({ params }: { params: { code: string } }) {
  const code = params.code.toLowerCase().replace(/[^a-z0-9]/g, '');
  const [e] = await get(`play_events?code=eq.${code}&select=id,title,sport,format,level,location,starts_at,when_text,spots,status,state`);
  let inN = 0;
  if (e) inN = (await get(`play_rsvps?event_id=eq.${e.id}&status=eq.in&select=id`)).length;
  const when = e?.starts_at
    ? new Date(e.starts_at).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/Los_Angeles' }).replace(':00', '')
    : e?.when_text ?? '';
  // champion for a finished event
  let champ = '';
  const m = e?.state?.mixer;
  if (e?.status === 'done' && m) {
    const w = new Map<string, number>();
    for (const r of m.rounds) for (const x of r.matches) {
      if (x.scoreA == null || x.scoreB == null || x.scoreA === x.scoreB) continue;
      for (const id of x.scoreA > x.scoreB ? x.teamA : x.teamB) w.set(id, (w.get(id) ?? 0) + 1);
    }
    const top = [...w.entries()].sort((a, b) => b[1] - a[1])[0];
    if (top) champ = m.players.find((p: { id: string; name: string }) => p.id === top[0])?.name ?? '';
  }
  const left = e ? Math.max(0, e.spots - inN) : 0;
  const ink = '#103c32', lime = '#d4ff49';
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', background: ink, color: '#fff', padding: 64, fontFamily: 'sans-serif' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, fontSize: 30, color: '#bccdbb' }}>
          <div style={{ width: 44, height: 44, borderRadius: 14, background: lime, display: 'flex' }} />
          Racquets IRL · {e ? `${e.sport}${e.level ? ' · ' + e.level : ''}` : 'tennis · pickleball · padel'}
        </div>
        <div style={{ fontSize: 84, fontWeight: 700, letterSpacing: -3, lineHeight: 1.02, marginTop: 40, display: 'flex' }}>{e?.title ?? 'Get a game together'}</div>
        <div style={{ fontSize: 40, marginTop: 24, color: '#dfe8dc', display: 'flex' }}>{[when, e?.location].filter(Boolean).join(' · ')}</div>
        <div style={{ marginTop: 'auto', display: 'flex', alignItems: 'center', gap: 24 }}>
          {e?.status === 'done' ? (
            <div style={{ background: lime, color: ink, borderRadius: 999, padding: '18px 36px', fontSize: 44, fontWeight: 700, display: 'flex' }}>🏆 {champ ? `${champ} took it` : 'Final results'}</div>
          ) : e?.status === 'live' ? (
            <div style={{ background: lime, color: ink, borderRadius: 999, padding: '18px 36px', fontSize: 44, fontWeight: 700, display: 'flex' }}>● Live now</div>
          ) : (
            <>
              <div style={{ background: lime, color: ink, borderRadius: 999, padding: '18px 36px', fontSize: 44, fontWeight: 700, display: 'flex' }}>{left > 0 ? `${left} spot${left === 1 ? '' : 's'} left · tap to join` : 'Full · join the waitlist'}</div>
              <div style={{ fontSize: 36, color: '#bccdbb', display: 'flex' }}>{inN} in</div>
            </>
          )}
        </div>
      </div>
    ),
    size,
  );
}
