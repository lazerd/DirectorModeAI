import { ImageResponse } from 'next/og';
import { standings, teamScore } from '@/lib/mixer/guestMixer';
import { awards, drawAwards, formatLabel, whenLine } from '@/lib/play/core';
import { drawProgress, standingsFor } from '@/lib/play/draw';
import type { PlayDraft, PlayState } from '@/lib/play/core';

/**
 * /p/<code>/results.png — the night's results as one share image (1080×1350, like
 * MixerMode's results card): champion, top 8 with rank and W-L, Team Battle score.
 * A tournament: champion, then the top 8 places with how far each got.
 * Same look as the per-player card at /p/<code>/card/<pid>.
 */
// Edge + plain REST, like the card route (next/og's node runtime breaks on Windows font paths). Read-only.
export const runtime = 'edge';
export const dynamic = 'force-dynamic';

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
type Ev = PlayDraft & { code: string; state: PlayState; created_at: string };

export async function GET(_req: Request, { params }: { params: { code: string } }) {
  const code = params.code.toLowerCase().replace(/[^a-z0-9]/g, '');
  const r = await fetch(`${URL_}/rest/v1/play_events?code=eq.${code}&select=code,title,sport,format,location,starts_at,when_text,created_at,state`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` }, cache: 'no-store' });
  const [e] = (r.ok ? await r.json() : []) as Ev[];
  if (!code || !e) return new Response('Not found', { status: 404 });
  e.state = e.state ?? {};
  const m = e.state.mixer;
  const d = e.format === 'tournament' ? e.state.draw ?? null : null;
  const st = m ? standings(m) : [];
  const dw = d ? drawAwards(d) : [];
  const champ = m ? awards(m)[0] : dw[0]?.title === 'Champion' ? dw[0] : null;
  const tb = m && m.format === 'team-battle' ? teamScore(m) : null;
  const tn = { A: e.state.teamNames?.A || 'Team A', B: e.state.teamNames?.B || 'Team B' };
  const date = whenLine(e, 'America/Los_Angeles') ?? new Date(e.created_at).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'America/Los_Angeles' });
  const places = d ? standingsFor(d) : [];
  const meta = d
    ? [date, e.location, `${places.length} ${d.matchType === 'doubles' ? 'pairs' : 'players'}`, `${drawProgress(d).done} matches`].filter(Boolean).join(' · ')
    : [date, e.location, m ? `${m.rounds.length} round${m.rounds.length === 1 ? '' : 's'}` : null, st.length ? `${st.length} players` : null].filter(Boolean).join(' · ');
  const ink = '#103c32', lime = '#d4ff49', soft = '#bccdbb';
  // One row shape for both: a night's standings (+/− games) or a draw's places (how far each got).
  const top = d
    ? places.slice(0, 8).map((s) => ({ id: s.id, rank: s.place, name: s.name, wins: s.wins, losses: s.losses, right: s.label.replace('Consolation', 'Cons.') }))
    : st.slice(0, 8).map((s) => ({ id: s.id, rank: s.rank, name: s.name, wins: s.wins, losses: s.losses, right: `${s.gamesFor - s.gamesAgainst > 0 ? '+' : ''}${s.gamesFor - s.gamesAgainst}` }));
  const tbLead = tb ? (tb.A === tb.B ? null : tb.A > tb.B ? 'A' : 'B') : null;

  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', background: ink, color: '#fff', padding: 72, fontFamily: 'sans-serif' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 18, fontSize: 32, color: soft }}>
          <div style={{ width: 48, height: 48, borderRadius: 16, background: lime, display: 'flex' }} />
          Racquets IRL · {formatLabel({ format: m?.format ?? e.format, state: e.state }) ?? 'Results'}
        </div>
        <div style={{ marginTop: 36, fontSize: 72, fontWeight: 700, letterSpacing: -2, lineHeight: 1.15, display: 'flex', flexShrink: 0 }}>{e.title.length > 34 ? e.title.slice(0, 33) + '…' : e.title}</div>
        <div style={{ marginTop: 8, fontSize: 30, color: soft, display: 'flex', flexShrink: 0 }}>{meta}</div>

        {tb ? (
          <div style={{ marginTop: 30, display: 'flex', flexShrink: 0, alignItems: 'center', justifyContent: 'space-between', background: '#fff7d6', color: ink, borderRadius: 28, padding: '16px 34px' }}>
            <div style={{ display: 'flex', fontSize: 38, fontWeight: 700 }}>{tn.A}</div>
            <div style={{ display: 'flex', fontSize: 64, fontWeight: 700 }}>{tb.A} – {tb.B}</div>
            <div style={{ display: 'flex', fontSize: 38, fontWeight: 700 }}>{tn.B}</div>
          </div>
        ) : null}

        {champ ? (
          <div style={{ marginTop: tb ? 22 : 40, display: 'flex', flexShrink: 0, flexDirection: 'column', background: 'rgba(212,255,73,0.12)', border: `2px solid ${lime}`, borderRadius: 28, padding: '20px 34px' }}>
            <div style={{ display: 'flex', fontSize: 28, color: lime, letterSpacing: 4, textTransform: 'uppercase' }}>{tbLead ? `🏆 ${tn[tbLead]} win · top player` : '🏆 Champion'}</div>
            <div style={{ display: 'flex', fontSize: 64, fontWeight: 700, letterSpacing: -2, lineHeight: 1.15 }}>{champ.who}</div>
            <div style={{ display: 'flex', fontSize: 30, color: soft }}>{champ.why}</div>
          </div>
        ) : (
          <div style={{ marginTop: 40, display: 'flex', fontSize: 40, color: soft }}>No scores in yet.</div>
        )}

        {top.length ? (
          <div style={{ marginTop: 22, display: 'flex', flexDirection: 'column' }}>
            {top.map((s, i) => (
              <div key={s.id} style={{ display: 'flex', alignItems: 'center', padding: '8px 6px', borderTop: i ? '1px solid rgba(255,255,255,0.12)' : 'none', fontSize: 36 }}>
                <div style={{ display: 'flex', width: 110, color: i === 0 ? lime : soft, fontWeight: 700 }}>{s.rank}</div>
                <div style={{ display: 'flex', flex: 1, fontWeight: i === 0 ? 700 : 400 }}>{s.name.length > 24 ? s.name.slice(0, 23) + '…' : s.name}</div>
                <div style={{ display: 'flex', width: 150, justifyContent: 'flex-end', fontWeight: 700 }}>{s.wins}–{s.losses}</div>
                <div style={{ display: 'flex', width: d ? 250 : 150, justifyContent: 'flex-end', color: soft, fontSize: d ? 26 : 30 }}>{s.right}</div>
              </div>
            ))}
          </div>
        ) : null}

        <div style={{ marginTop: 'auto', display: 'flex', fontSize: 30, color: lime }}>clubmode.ai/p/{e.code} · host your own</div>
      </div>
    ),
    { width: 1080, height: 1350, headers: { 'Cache-Control': 'no-store' } },
  );
}
