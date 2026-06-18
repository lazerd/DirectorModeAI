'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export type MatchT = { token: string; a: string; b: string; score: string; winner_side: 'a' | 'b' | null; status: string };
export type StandingT = { name: string; w: number; l: number; gf: number; ga: number };
export type GroupT = { title: string; matches: MatchT[]; standings: StandingT[] | null };
export type Division = { id: string; name: string; num: string; color: string; accent: string; type: 'compass' | 'group'; groups: GroupT[]; compassR1?: [string, string][] };

const FONT = "https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600;700&family=Barlow+Condensed:wght@600;700;800;900&family=Barlow+Semi+Condensed:wght@600;700&display=swap";

export default function FlexHub({ divisions }: { divisions: Division[] }) {
  return (
    <main style={{ fontFamily: "'Barlow', system-ui, sans-serif", background: '#ECEFF4', minHeight: '100vh', padding: '28px 14px 80px' }}>
      <link rel="stylesheet" href={FONT} />
      <div style={{ maxWidth: 920, margin: '0 auto' }}>
        {/* HERO */}
        <div style={{ position: 'relative', overflow: 'hidden', background: 'linear-gradient(160deg,#1F4FA0 0%,#163670 100%)', borderRadius: 20, padding: '34px 30px 30px', color: '#fff', boxShadow: '0 16px 40px rgba(16,38,80,.28)' }}>
          <div style={{ position: 'absolute', width: 300, height: 300, borderRadius: '50%', background: '#FFC72C', opacity: 0.14, filter: 'blur(10px)', right: -110, top: -120 }} />
          <div style={{ position: 'relative', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontFamily: "'Barlow Semi Condensed'", fontWeight: 700, fontSize: 13, letterSpacing: '.22em', textTransform: 'uppercase', color: '#FFD24F' }}>Live Results · Summer 2026</div>
              <h1 style={{ fontFamily: "'Barlow Condensed'", fontWeight: 900, textTransform: 'uppercase', fontSize: 52, lineHeight: 0.95, margin: '8px 0 0' }}>Summer Flex League</h1>
            </div>
            <div style={{ textAlign: 'right', lineHeight: 1 }}>
              <div style={{ fontFamily: "'Barlow Condensed'", fontWeight: 900, textTransform: 'uppercase', fontSize: 20 }}>Sleepy Hollow</div>
              <div style={{ fontFamily: "'Barlow Semi Condensed'", fontWeight: 700, textTransform: 'uppercase', fontSize: 10, letterSpacing: '.16em', color: '#FFD24F', marginTop: 3 }}>Swim &amp; Tennis Club</div>
            </div>
          </div>
          <div style={{ position: 'relative', display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 18 }}>
            {divisions.map((d) => (
              <a key={d.id} href={`#${d.id}`} style={{ background: 'rgba(255,255,255,.14)', border: '1px solid rgba(255,255,255,.24)', borderRadius: 999, padding: '7px 15px', fontFamily: "'Barlow Semi Condensed'", fontWeight: 700, fontSize: 13.5, color: '#fff', textDecoration: 'none' }}>{d.name}</a>
            ))}
          </div>
        </div>

        <div style={{ background: '#FFF8E6', border: '1px solid #FFE08A', borderRadius: 14, padding: '13px 20px', marginTop: 16, color: '#9a3412', fontSize: 15 }}>
          <strong style={{ fontFamily: "'Barlow Condensed'", fontWeight: 800, fontSize: 18, textTransform: 'uppercase', color: '#c2410c' }}>Tap the winner, type the score, submit.</strong>{' '}
          Scores and standings update live. Best 2 of 3 sets, 10-pt match tiebreak for the 3rd. Play any round early if your opponent is free.
        </div>

        {divisions.map((d) => <DivisionCard key={d.id} d={d} />)}

        <div style={{ textAlign: 'center', color: '#6F7B90', fontSize: 13, marginTop: 30 }}>Sleepy Hollow Swim &amp; Tennis Club · Summer Flex League · June 22 – Aug 30</div>
      </div>
    </main>
  );
}

function DivisionCard({ d }: { d: Division }) {
  return (
    <section id={d.id} style={{ background: '#fff', border: '1px solid #DCE1EA', borderRadius: 18, boxShadow: '0 8px 24px rgba(16,38,80,.09)', overflow: 'hidden', marginTop: 22, scrollMarginTop: 12 }}>
      <div style={{ position: 'relative', overflow: 'hidden', background: d.color, padding: '20px 26px', color: '#fff' }}>
        <span style={{ position: 'absolute', right: 18, top: -20, fontFamily: "'Barlow Condensed'", fontWeight: 900, fontSize: 120, lineHeight: 1, color: 'rgba(255,255,255,.12)' }}>{d.num}</span>
        <h2 style={{ position: 'relative', fontFamily: "'Barlow Condensed'", fontWeight: 900, textTransform: 'uppercase', fontSize: 32, margin: 0 }}>{d.name}</h2>
      </div>
      <div style={{ padding: '20px 22px 24px' }}>
        {d.type === 'compass' && d.compassR1 && <CompassDraw r1={d.compassR1} />}
        {d.groups.map((g) => <Group key={g.title} g={g} accent={d.accent} />)}
      </div>
    </section>
  );
}

function Group({ g, accent }: { g: GroupT; accent: string }) {
  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{ width: 11, height: 11, borderRadius: '50%', background: accent }} />
        <span style={{ fontFamily: "'Barlow Condensed'", fontWeight: 800, fontSize: 19, textTransform: 'uppercase', color: '#111726' }}>{g.title}</span>
      </div>
      {g.standings && g.standings.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13.5, marginBottom: 12 }}>
          <thead>
            <tr style={{ textAlign: 'left', color: '#9AA5B8', textTransform: 'uppercase', fontFamily: "'Barlow Semi Condensed'", fontSize: 11, letterSpacing: '.06em' }}>
              <th style={{ padding: '4px 8px 4px 0', width: 26 }}>#</th><th style={{ padding: '4px 8px' }}>Player</th>
              <th style={{ padding: '4px 8px', textAlign: 'center' }}>W-L</th><th style={{ padding: '4px 8px', textAlign: 'center' }}>Games</th>
            </tr>
          </thead>
          <tbody>
            {g.standings.map((s, i) => (
              <tr key={s.name} style={{ borderTop: '1px solid #EEF1F6' }}>
                <td style={{ padding: '6px 8px 6px 0', color: '#9AA5B8', fontWeight: 700 }}>{i + 1}</td>
                <td style={{ padding: '6px 8px', color: '#1B2536', fontWeight: 500 }}>{s.name}</td>
                <td style={{ padding: '6px 8px', textAlign: 'center', fontWeight: 700, color: '#1B2536' }}>{s.w}-{s.l}</td>
                <td style={{ padding: '6px 8px', textAlign: 'center', color: '#6F7B90' }}>{s.gf}-{s.ga}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {g.matches.map((m, i) => <MatchRow key={m.token || i} m={m} />)}
    </div>
  );
}

function MatchRow({ m }: { m: MatchT }) {
  const router = useRouter();
  const [winner, setWinner] = useState<'a' | 'b' | ''>(m.winner_side || '');
  const [score, setScore] = useState(m.score || '');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const done = m.status === 'completed';
  const ready = m.a !== 'TBD' && m.b !== 'TBD';
  const [editing, setEditing] = useState(false);

  async function submit() {
    setErr('');
    if (winner !== 'a' && winner !== 'b') return setErr('Tap the winner.');
    if (!score.trim()) return setErr('Enter the score.');
    setBusy(true);
    const res = await fetch(`/api/tournaments/match/${m.token}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ winner_side: winner, score: score.trim(), reported_by_name: name.trim() }),
    });
    setBusy(false);
    if (res.ok) { setEditing(false); router.refresh(); }
    else { const j = await res.json().catch(() => ({})); setErr(j.error || 'Could not save.'); }
  }

  if (!done && !ready) {
    return (
      <div style={{ border: '1px dashed #DCE1EA', borderRadius: 10, padding: '10px 13px', marginBottom: 8, color: '#9AA5B8', fontSize: 14 }}>
        {m.a} <span style={{ color: '#cbd5e1' }}>vs</span> {m.b} &mdash; <em>awaiting earlier-round results</em>
      </div>
    );
  }

  if (done && !editing) {
    return (
      <div style={{ border: '1px solid #E5E7EB', borderRadius: 10, padding: '9px 13px', marginBottom: 8, background: '#f6fefb', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 14.5 }}>
          <span style={{ fontWeight: m.winner_side === 'a' ? 700 : 500, color: m.winner_side === 'a' ? '#15803d' : '#1B2536' }}>{m.a}</span>
          <span style={{ color: '#9AA5B8' }}> def. </span>
          <span style={{ fontWeight: m.winner_side === 'b' ? 700 : 500, color: m.winner_side === 'b' ? '#15803d' : '#1B2536' }}>{m.b}</span>
          {m.winner_side === 'a' ? '' : ''}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontWeight: 700, color: '#0f172a' }}>{m.score}</span>
          <button type="button" onClick={() => setEditing(true)} style={{ background: 'none', border: 'none', color: '#1d4ed8', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>Edit</button>
        </div>
      </div>
    );
  }

  const btn = (side: 'a' | 'b', label: string) => (
    <button type="button" onClick={() => setWinner(side)} disabled={!m.token} style={{ flex: 1, padding: '9px 10px', borderRadius: 8, cursor: m.token ? 'pointer' : 'default', fontSize: 14.5, fontWeight: 600, textAlign: 'left', border: winner === side ? '2px solid #16a34a' : '1px solid #d1d5db', background: winner === side ? '#dcfce7' : '#fff', color: '#111827' }}>{winner === side ? '✓ ' : ''}{label}</button>
  );

  return (
    <div style={{ border: '1px solid #E5E7EB', borderRadius: 10, padding: 11, marginBottom: 8, background: '#fff' }}>
      <div style={{ display: 'flex', gap: 7, marginBottom: 8, alignItems: 'center' }}>{btn('a', m.a)}<span style={{ color: '#9ca3af', fontWeight: 700, fontSize: 11 }}>vs</span>{btn('b', m.b)}</div>
      <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', alignItems: 'center' }}>
        <input value={score} onChange={(e) => setScore(e.target.value)} placeholder="6-4, 3-6, 10-7" style={{ flex: '2 1 150px', padding: '9px 11px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 14.5, color: '#111827', background: '#fff' }} />
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" style={{ flex: '1 1 100px', padding: '9px 11px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 14.5, color: '#111827', background: '#fff' }} />
        <button type="button" onClick={submit} disabled={busy || !m.token} style={{ padding: '9px 18px', borderRadius: 8, border: 'none', background: '#1d4ed8', color: '#fff', fontWeight: 700, fontSize: 14.5, cursor: 'pointer' }}>{busy ? 'Saving…' : 'Submit'}</button>
      </div>
      {err && <div style={{ color: '#dc2626', fontSize: 13, marginTop: 7 }}>{err}</div>}
    </div>
  );
}

function CompassDraw({ r1 }: { r1: [string, string][] }) {
  const names = r1.flat();
  const cols = [16, 8, 4, 2, 1], heads = ['Round 1', 'Round 2', 'Round 3', 'Semis', 'Champion'];
  const X = [10, 168, 326, 484, 626], BW = 150, BH = 23, top = 52, H = 760;
  const yOf = (c: number, k: number) => top + (k + 0.5) * H / cols[c];
  let s = '';
  for (let c = 0; c < 5; c++) s += `<text x="${X[c]}" y="36" font-family="Barlow Semi Condensed,Arial" font-weight="700" font-size="11" letter-spacing="1" fill="#9AA5B8">${heads[c].toUpperCase()}</text>`;
  for (let c = 0; c < 4; c++) for (let k = 0; k < cols[c + 1]; k++) {
    const yT = yOf(c, 2 * k), yB = yOf(c, 2 * k + 1), yM = yOf(c + 1, k), x1 = X[c] + BW, x2 = X[c + 1], xm = (x1 + x2) / 2;
    s += `<path d="M${x1} ${yT} H${xm} V${yB} H${x1}" fill="none" stroke="#C7D2E4" stroke-width="1.5"/><path d="M${xm} ${yM} H${x2}" fill="none" stroke="#C7D2E4" stroke-width="1.5"/>`;
  }
  for (let c = 0; c < 5; c++) for (let k = 0; k < cols[c]; k++) {
    const y = yOf(c, k) - BH / 2, fill = c === 0, champ = c === 4;
    s += `<rect x="${X[c]}" y="${y}" width="${BW}" height="${BH}" rx="5" fill="${fill ? '#fff' : (champ ? '#FFF8E6' : '#F8FAFC')}" stroke="${fill ? '#2052A8' : (champ ? '#F5B000' : '#DCE1EA')}" stroke-width="${fill || champ ? 1.4 : 1}"/>`;
    if (fill) s += `<text x="${X[c] + 8}" y="${y + 15}" font-family="Barlow,Arial" font-size="12" font-weight="600" fill="#1B2536">${names[k]}</text>`;
    if (champ) s += `<text x="${X[c] + BW / 2}" y="${y + 15}" text-anchor="middle" font-family="Barlow Condensed,Arial" font-weight="800" font-size="11" fill="#B07D00">EAST WINNER</text>`;
  }
  const W = X[4] + BW + 6, Ht = top + H + 8;
  const svg = `<svg width="100%" viewBox="0 0 ${W} ${Ht}" xmlns="http://www.w3.org/2000/svg" style="max-width:${W}px">${s}</svg>`;
  return (
    <div style={{ marginBottom: 6 }}>
      <p style={{ fontSize: 14, color: '#3A4254', lineHeight: 1.5, margin: '0 0 10px' }}>
        A 16-player <strong>Compass Draw</strong>: <strong style={{ color: '#B07D00' }}>win</strong> and you advance East toward the championship; <strong style={{ color: '#1B448C' }}>lose</strong> and you slide West (then N/S/NE/NW/SE/SW) — nobody's knocked out, everyone plays 4. Only Round 1 is set; you advance along the lines as you win. Enter your Round 1 result below.
      </p>
      <div style={{ overflowX: 'auto', border: '1px solid #EEF1F6', borderRadius: 10, padding: 8, marginBottom: 12 }} dangerouslySetInnerHTML={{ __html: svg }} />
    </div>
  );
}
