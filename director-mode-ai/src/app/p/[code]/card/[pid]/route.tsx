import { ImageResponse } from 'next/og';

/**
 * One player's share card from the AI recap (1080×1350, made for Instagram stories
 * and group chats): their nickname and line, the headline, the crown.
 */
export const runtime = 'edge';

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export async function GET(_req: Request, { params }: { params: { code: string; pid: string } }) {
  const code = params.code.toLowerCase().replace(/[^a-z0-9]/g, '');
  const r = await fetch(`${URL_}/rest/v1/play_events?code=eq.${code}&select=title,location,sport,state`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` }, cache: 'no-store' });
  const [e] = r.ok ? await r.json() : [];
  const recap = e?.state?.recap;
  const line = recap?.lines?.find((l: { id: string; skipped?: boolean }) => l.id === params.pid && !l.skipped);
  if (!e || !recap || !line) return new Response('Not found', { status: 404 });
  const ink = '#103c32', lime = '#d4ff49';
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', background: ink, color: '#fff', padding: 72, fontFamily: 'sans-serif' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 18, fontSize: 32, color: '#bccdbb' }}>
          <div style={{ width: 48, height: 48, borderRadius: 16, background: lime, display: 'flex' }} />
          🎙️ Racquets IRL · {e.title}
        </div>
        <div style={{ marginTop: 70, fontSize: 40, color: lime, letterSpacing: 4, textTransform: 'uppercase', display: 'flex' }}>{line.tag}</div>
        <div style={{ marginTop: 10, fontSize: 104, fontWeight: 700, letterSpacing: -4, lineHeight: 1, display: 'flex' }}>{line.name}</div>
        <div style={{ marginTop: 44, fontSize: 56, lineHeight: 1.25, display: 'flex' }}>“{line.line}”</div>
        <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 20 }}>
          {recap.crown ? <div style={{ background: '#fff7d6', color: ink, borderRadius: 28, padding: '22px 30px', fontSize: 36, fontWeight: 700, display: 'flex' }}>{recap.crown}</div> : null}
          <div style={{ fontSize: 34, color: '#bccdbb', display: 'flex' }}>{recap.headline}</div>
          <div style={{ fontSize: 30, color: lime, display: 'flex' }}>racquetsirl.com/p/{code} · host your own</div>
        </div>
      </div>
    ),
    { width: 1080, height: 1350 },
  );
}
