'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import PanScroll from '@/components/tournament/PanScroll';

export type MatchT = { token: string; a: string; b: string; score: string; winner_side: 'a' | 'b' | null; status: string; label?: string };
export type StandingT = { name: string; w: number; l: number; gf: number; ga: number };
export type GroupT = { title: string; matches: MatchT[]; standings: StandingT[] | null; subtitle?: string; complete?: boolean; isPlayoff?: boolean };
export type PodiumT = { place: number; name: string; wl: string; pct: string };
export type ChampionT = {
  crownTitle: string;
  name: string;
  runnerUp: string | null;
  recordLine: string | null;
  clincher: string | null;
  road: { opponent: string; score: string; won: boolean }[];
  podium: PodiumT[];
};
export type Division = { id: string; name: string; num: string; color: string; accent: string; type: 'compass' | 'group'; groups: GroupT[]; playoffGroups?: GroupT[]; champions?: ChampionT[]; compassR1?: [string, string][]; compassStages?: Record<string, MatchT[]> };

const FONT = "https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600;700&family=Barlow+Condensed:wght@600;700;800;900&family=Barlow+Semi+Condensed:wght@600;700&display=swap";

// Scores are stored player1-first (side a's games first). For display we show
// them WINNER-first so they read naturally next to "winner def. loser" — i.e.
// flip each set when side B won.
function winnerFirstScore(score: string, winner: 'a' | 'b' | null): string {
  if (!score || winner !== 'b') return score;
  return score
    .split(',')
    .map((s) => {
      const m = s.trim().match(/^(\d+)\s*-\s*(\d+)(.*)$/);
      return m ? `${m[2]}-${m[1]}${m[3] ?? ''}` : s.trim();
    })
    .join(', ');
}

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

        <div style={{ textAlign: 'center', color: '#475569', fontSize: 13, marginTop: 30 }}>Sleepy Hollow Swim &amp; Tennis Club · Summer Flex League · June 22 – Aug 30</div>
      </div>
    </main>
  );
}

/** "Championship · Flight A" -> "Championship"; single-tier titles have no tier. */
const tierOf = (title: string) => (title.includes('·') ? title.split('·')[0].trim() : null);

function DivisionCard({ d }: { d: Division }) {
  // A division whose flights carry tier prefixes ("Championship · …",
  // "Challenger · …") is really two tournaments sharing one page section.
  // Render each tier as its own clearly-banded sub-tournament, with that
  // tier's finals bracket pinned at the top of its band.
  const tiers = [...new Set(d.groups.map((g) => tierOf(g.title)).filter((t): t is string => !!t))];
  const multiTier = tiers.length > 1;

  return (
    <section id={d.id} style={{ background: '#fff', border: '1px solid #DCE1EA', borderRadius: 18, boxShadow: '0 8px 24px rgba(16,38,80,.09)', overflow: 'hidden', marginTop: 22, scrollMarginTop: 12 }}>
      <div style={{ position: 'relative', overflow: 'hidden', background: d.color, padding: '20px 26px', color: '#fff' }}>
        <span style={{ position: 'absolute', right: 18, top: -20, fontFamily: "'Barlow Condensed'", fontWeight: 900, fontSize: 120, lineHeight: 1, color: 'rgba(255,255,255,.12)' }}>{d.num}</span>
        <h2 style={{ position: 'relative', fontFamily: "'Barlow Condensed'", fontWeight: 900, textTransform: 'uppercase', fontSize: 32, margin: 0 }}>{d.name}</h2>
        {multiTier && (
          <div style={{ position: 'relative', fontFamily: "'Barlow Semi Condensed'", fontWeight: 700, fontSize: 12.5, letterSpacing: '.14em', textTransform: 'uppercase', color: 'rgba(255,255,255,.85)', marginTop: 5 }}>
            Two separate tournaments: {tiers.join(' + ')}
          </div>
        )}
      </div>
      <div style={{ padding: '20px 22px 24px' }}>
        {(d.champions || []).map((c) => <ChampionBanner key={c.crownTitle} c={c} color={d.color} accent={d.accent} />)}
        {d.type === 'compass' && <CompassDraw stages={d.compassStages || {}} r1={d.compassR1} />}
        {!multiTier && (d.playoffGroups || []).map((g) => <Group key={g.title} g={g} accent={d.accent} />)}
        {!multiTier && d.groups.map((g) => <Group key={g.title} g={g} accent={d.accent} />)}
        {multiTier && tiers.map((tier) => (
          <TierSection
            key={tier}
            tier={tier}
            accent={d.accent}
            color={d.color}
            playoffs={(d.playoffGroups || []).filter((g) => g.title.startsWith(tier))}
            groups={d.groups.filter((g) => tierOf(g.title) === tier)}
          />
        ))}
      </div>
    </section>
  );
}

/**
 * One tier (Championship / Challenger) rendered as its own tournament: a
 * full-width band header, that tier's FINALS bracket first (the moment it
 * exists), then its feeder flights with the tier prefix trimmed off.
 */
function TierSection({ tier, accent, color, playoffs, groups }: { tier: string; accent: string; color: string; playoffs: GroupT[]; groups: GroupT[] }) {
  const isChampionship = /championship/i.test(tier);
  const band = isChampionship ? color : '#5B6472';
  return (
    <div style={{ marginTop: 26, border: `2px solid ${band}`, borderRadius: 16, overflow: 'hidden' }}>
      <div style={{ background: band, color: '#fff', padding: '12px 18px', display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontFamily: "'Barlow Condensed'", fontWeight: 900, textTransform: 'uppercase', fontSize: 24, lineHeight: 1 }}>{tier} Tournament</span>
        <span style={{ fontFamily: "'Barlow Semi Condensed'", fontWeight: 700, fontSize: 11.5, letterSpacing: '.13em', textTransform: 'uppercase', color: 'rgba(255,255,255,.8)' }}>
          {playoffs.length ? 'Finals below — winners of each flight meet here' : 'Flight winners will meet in the finals'}
        </span>
      </div>
      <div style={{ padding: '4px 16px 16px' }}>
        {playoffs.map((g) => <Group key={g.title} g={{ ...g, title: 'Finals' }} accent={accent} />)}
        {groups.map((g) => <Group key={g.title} g={{ ...g, title: g.title.split('·')[1]?.trim() || g.title }} accent={accent} />)}
      </div>
    </div>
  );
}

function Group({ g, accent }: { g: GroupT; accent: string }) {
  const playoff = !!g.isPlayoff;
  return (
    <div style={playoff
      ? { marginTop: 16, marginBottom: 6, border: '2px solid #E8B923', background: 'linear-gradient(180deg,#FFFBEF 0%,#FFFFFF 62%)', borderRadius: 14, padding: '14px 16px 10px', boxShadow: '0 4px 14px rgba(176,125,0,.14)' }
      : { marginTop: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: g.subtitle ? 4 : 8, flexWrap: 'wrap' }}>
        {playoff
          ? <span style={{ fontSize: 15 }}>🏆</span>
          : <span style={{ width: 11, height: 11, borderRadius: '50%', background: accent }} />}
        <span style={{ fontFamily: "'Barlow Condensed'", fontWeight: 800, fontSize: playoff ? 22 : 19, textTransform: 'uppercase', color: '#111726' }}>{g.title}</span>
        {playoff && <span style={{ background: '#B07D00', color: '#fff', borderRadius: 999, padding: '2px 9px', fontFamily: "'Barlow Semi Condensed'", fontWeight: 700, fontSize: 10.5, letterSpacing: '.12em', textTransform: 'uppercase' }}>Finals</span>}
        {!playoff && g.complete && <span style={{ background: '#DCFCE7', color: '#15803d', border: '1px solid #A7F3D0', borderRadius: 999, padding: '1px 8px', fontFamily: "'Barlow Semi Condensed'", fontWeight: 700, fontSize: 10.5, letterSpacing: '.1em', textTransform: 'uppercase' }}>Complete</span>}
      </div>
      {g.subtitle && <div style={{ fontSize: 13, color: '#475569', marginBottom: 10 }}>{g.subtitle}</div>}
      {g.standings && g.standings.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13.5, marginBottom: 12 }}>
          <thead>
            <tr style={{ textAlign: 'left', color: '#475569', textTransform: 'uppercase', fontFamily: "'Barlow Semi Condensed'", fontSize: 11, letterSpacing: '.06em' }}>
              <th style={{ padding: '4px 8px 4px 0', width: 26 }}>#</th><th style={{ padding: '4px 8px' }}>Player</th>
              <th style={{ padding: '4px 8px', textAlign: 'center' }}>W-L</th><th style={{ padding: '4px 8px', textAlign: 'center' }}>Games&nbsp;Won</th><th style={{ padding: '4px 8px', textAlign: 'center' }}>Games&nbsp;Lost</th><th style={{ padding: '4px 8px', textAlign: 'center' }}>Games&nbsp;%</th>
            </tr>
          </thead>
          <tbody>
            {g.standings.map((s, i) => (
              <tr key={s.name} style={{ borderTop: '1px solid #EEF1F6' }}>
                <td style={{ padding: '6px 8px 6px 0', color: '#475569', fontWeight: 700 }}>{i + 1}</td>
                <td style={{ padding: '6px 8px', color: '#1B2536', fontWeight: 500 }}>{s.name}</td>
                <td style={{ padding: '6px 8px', textAlign: 'center', fontWeight: 700, color: '#1B2536' }}>{s.w}-{s.l}</td>
                <td style={{ padding: '6px 8px', textAlign: 'center', color: '#475569' }}>{s.gf}</td>
                <td style={{ padding: '6px 8px', textAlign: 'center', color: '#475569' }}>{s.ga}</td>
                <td style={{ padding: '6px 8px', textAlign: 'center', color: '#475569', fontWeight: 600 }}>{s.gf + s.ga ? Math.round((s.gf / (s.gf + s.ga)) * 100) + '%' : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {g.matches.map((m, i) => (
        <div key={m.token || i}>
          {m.label && (
            <div style={{ fontFamily: "'Barlow Semi Condensed'", fontWeight: 700, fontSize: 11, letterSpacing: '.11em', textTransform: 'uppercase', color: i === 0 ? '#B07D00' : '#64748b', margin: '10px 0 5px' }}>{m.label}</div>
          )}
          <MatchRow m={m} />
        </div>
      ))}
    </div>
  );
}

// ---- CHAMPION BANNER -------------------------------------------------------
// Auto-appears the moment a division is decided: a single-flight round robin
// finishing, or a placement playoff final being scored. Everything below is
// derived from results — nothing here is hand-entered.

const MEDAL = ['🥇', '🥈', '🥉'];

function ChampionBanner({ c, color, accent }: { c: ChampionT; color: string; accent: string }) {
  const names = c.name.split(' / ');
  return (
    <div style={{ position: 'relative', overflow: 'hidden', borderRadius: 18, marginBottom: 20, background: `linear-gradient(150deg, ${color} 0%, #0B1428 78%)`, boxShadow: '0 18px 44px rgba(11,20,40,.34)', border: '1px solid rgba(255,255,255,.10)' }}>
      {/* stadium-light glow + confetti flecks, pure CSS so it costs nothing */}
      <div style={{ position: 'absolute', width: 420, height: 420, borderRadius: '50%', background: 'radial-gradient(circle, #FFD24F 0%, rgba(255,210,79,0) 68%)', opacity: 0.34, right: -150, top: -210, pointerEvents: 'none' }} />
      <div style={{ position: 'absolute', width: 260, height: 260, borderRadius: '50%', background: `radial-gradient(circle, ${accent} 0%, rgba(0,0,0,0) 70%)`, opacity: 0.3, left: -110, bottom: -140, pointerEvents: 'none' }} />
      {[
        { l: '8%', t: '16%', c: '#FFD24F', s: 7 }, { l: '22%', t: '68%', c: '#7CE7C0', s: 5 },
        { l: '46%', t: '9%', c: '#FF8A5B', s: 6 }, { l: '63%', t: '78%', c: '#FFD24F', s: 5 },
        { l: '81%', t: '28%', c: '#8FC7FF', s: 6 }, { l: '92%', t: '62%', c: '#FF8A5B', s: 5 },
      ].map((f, i) => (
        <span key={i} aria-hidden style={{ position: 'absolute', left: f.l, top: f.t, width: f.s, height: f.s, background: f.c, opacity: 0.5, borderRadius: 2, transform: `rotate(${i * 37}deg)`, pointerEvents: 'none' }} />
      ))}

      <div style={{ position: 'relative', padding: '26px 26px 22px', color: '#fff' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 14 }}>
          <span style={{ height: 2, width: 26, background: '#FFD24F', borderRadius: 2 }} />
          <span style={{ fontFamily: "'Barlow Semi Condensed'", fontWeight: 700, fontSize: 11.5, letterSpacing: '.24em', textTransform: 'uppercase', color: '#FFD24F' }}>{c.crownTitle}</span>
          <span style={{ height: 2, flex: 1, background: 'rgba(255,210,79,.28)', borderRadius: 2 }} />
          <span style={{ fontFamily: "'Barlow Semi Condensed'", fontWeight: 700, fontSize: 10.5, letterSpacing: '.16em', textTransform: 'uppercase', color: 'rgba(255,255,255,.6)' }}>Final</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
          <div style={{ flexShrink: 0, width: 84, height: 84, borderRadius: '50%', display: 'grid', placeItems: 'center', fontSize: 42, background: 'radial-gradient(circle at 34% 28%, #FFE9A8 0%, #FFC72C 46%, #C98A00 100%)', boxShadow: '0 10px 26px rgba(255,199,44,.42), inset 0 -3px 10px rgba(0,0,0,.22)' }}>🏆</div>
          <div style={{ flex: '1 1 260px', minWidth: 0 }}>
            {names.map((n, i) => (
              <div key={n} style={{ fontFamily: "'Barlow Condensed'", fontWeight: 900, textTransform: 'uppercase', letterSpacing: '.005em', fontSize: names.length > 1 ? 40 : 48, lineHeight: 0.98, textShadow: '0 3px 18px rgba(0,0,0,.4)' }}>
                {n}
                {i < names.length - 1 && <span style={{ color: '#FFD24F', margin: '0 2px 0 8px', fontSize: 26, verticalAlign: 'middle' }}>&amp;</span>}
              </div>
            ))}
            {c.recordLine && (
              <div style={{ marginTop: 9, display: 'inline-block', background: 'rgba(255,255,255,.13)', border: '1px solid rgba(255,255,255,.24)', borderRadius: 999, padding: '5px 14px', fontFamily: "'Barlow Semi Condensed'", fontWeight: 700, fontSize: 13.5, letterSpacing: '.03em' }}>
                {c.recordLine}
              </div>
            )}
            {c.clincher && <div style={{ marginTop: 8, fontSize: 14, color: 'rgba(255,255,255,.86)' }}>{c.clincher}</div>}
            {c.runnerUp && (
              <div style={{ marginTop: 8, fontSize: 13.5, color: 'rgba(255,255,255,.72)' }}>
                <span style={{ fontFamily: "'Barlow Semi Condensed'", fontWeight: 700, letterSpacing: '.14em', textTransform: 'uppercase', fontSize: 10.5, color: '#FFD24F', marginRight: 7 }}>Runner-up</span>
                {c.runnerUp}
              </div>
            )}
          </div>
        </div>

        {c.road.length > 0 && (
          <div style={{ marginTop: 20, background: 'rgba(0,0,0,.24)', border: '1px solid rgba(255,255,255,.10)', borderRadius: 12, padding: '13px 15px' }}>
            <div style={{ fontFamily: "'Barlow Semi Condensed'", fontWeight: 700, fontSize: 10.5, letterSpacing: '.18em', textTransform: 'uppercase', color: '#FFD24F', marginBottom: 9 }}>Road to the title</div>
            {c.road.map((r, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '5px 0', borderTop: i ? '1px solid rgba(255,255,255,.08)' : 'none' }}>
                <span style={{ width: 20, height: 20, borderRadius: '50%', display: 'grid', placeItems: 'center', flexShrink: 0, fontSize: 11, fontWeight: 800, background: r.won ? '#16a34a' : 'rgba(255,255,255,.16)', color: '#fff' }}>{r.won ? 'W' : 'L'}</span>
                <span style={{ flex: 1, fontSize: 14, color: 'rgba(255,255,255,.9)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.opponent}</span>
                <span style={{ fontFamily: "'Barlow Semi Condensed'", fontWeight: 700, fontSize: 14, color: '#fff', whiteSpace: 'nowrap' }}>{r.score}</span>
              </div>
            ))}
          </div>
        )}

        {c.podium.length > 0 && (
          <div style={{ marginTop: 14 }}>
            <div style={{ fontFamily: "'Barlow Semi Condensed'", fontWeight: 700, fontSize: 10.5, letterSpacing: '.18em', textTransform: 'uppercase', color: 'rgba(255,255,255,.62)', marginBottom: 8 }}>Final standings</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {c.podium.map((p) => (
                <div key={p.place} style={{ flex: '1 1 170px', display: 'flex', alignItems: 'center', gap: 9, background: p.place === 1 ? 'rgba(255,199,44,.18)' : 'rgba(255,255,255,.07)', border: p.place === 1 ? '1px solid rgba(255,210,79,.5)' : '1px solid rgba(255,255,255,.10)', borderRadius: 10, padding: '8px 11px' }}>
                  <span style={{ fontSize: 16, width: 20, textAlign: 'center', flexShrink: 0 }}>{MEDAL[p.place - 1] || <span style={{ fontFamily: "'Barlow Condensed'", fontWeight: 800, fontSize: 15, color: 'rgba(255,255,255,.55)' }}>{p.place}</span>}</span>
                  <span style={{ flex: 1, fontSize: 13.5, fontWeight: p.place === 1 ? 700 : 500, color: '#fff', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
                  <span style={{ fontFamily: "'Barlow Semi Condensed'", fontWeight: 700, fontSize: 12.5, color: 'rgba(255,255,255,.72)', whiteSpace: 'nowrap' }}>{p.wl}{p.pct ? ` · ${p.pct}` : ''}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function MatchRow({ m }: { m: MatchT }) {
  const router = useRouter();
  const [winner, setWinner] = useState<'a' | 'b' | ''>(m.winner_side || '');
  // Edit form is entered winner-first (matching how it's displayed + saved), so
  // prefill the stored player1-first score flipped back to winner-first.
  const [score, setScore] = useState(winnerFirstScore(m.score || '', m.winner_side));
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
      <div style={{ border: '1px dashed #DCE1EA', borderRadius: 10, padding: '10px 13px', marginBottom: 8, color: '#475569', fontSize: 14 }}>
        {m.a} <span style={{ color: '#64748b' }}>vs</span> {m.b} &mdash; <em>awaiting earlier-round results</em>
      </div>
    );
  }

  if (done && !editing) {
    // Always name the WINNER first ("winner def. loser") — previously it printed
    // "{m.a} def. {m.b}" regardless of who won, so a side-B win read backwards.
    const winnerName = m.winner_side === 'b' ? m.b : m.a;
    const loserName = m.winner_side === 'b' ? m.a : m.b;
    return (
      <div style={{ border: '1px solid #E5E7EB', borderRadius: 10, padding: '9px 13px', marginBottom: 8, background: '#f6fefb', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 14.5 }}>
          <span style={{ fontWeight: 700, color: '#15803d' }}>{winnerName}</span>
          <span style={{ color: '#475569' }}> def. </span>
          <span style={{ fontWeight: 500, color: '#1B2536' }}>{loserName}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontWeight: 700, color: '#0f172a' }}>{winnerFirstScore(m.score, m.winner_side)}</span>
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
      <div style={{ display: 'flex', gap: 7, marginBottom: 8, alignItems: 'center' }}>{btn('a', m.a)}<span style={{ color: '#475569', fontWeight: 700, fontSize: 11 }}>vs</span>{btn('b', m.b)}</div>
      <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', alignItems: 'center' }}>
        <input value={score} onChange={(e) => setScore(e.target.value)} placeholder="6-4, 3-6, 10-7" style={{ flex: '2 1 150px', padding: '9px 11px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 14.5, color: '#111827', background: '#fff' }} />
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" style={{ flex: '1 1 100px', padding: '9px 11px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 14.5, color: '#111827', background: '#fff' }} />
        <button type="button" onClick={submit} disabled={busy || !m.token} style={{ padding: '9px 18px', borderRadius: 8, border: 'none', background: '#1d4ed8', color: '#fff', fontWeight: 700, fontSize: 14.5, cursor: 'pointer' }}>{busy ? 'Saving…' : 'Submit'}</button>
      </div>
      {err && <div style={{ color: '#dc2626', fontSize: 13, marginTop: 7 }}>{err}</div>}
    </div>
  );
}

// Live, data-driven compass draw. Each "direction" is a left→right column
// flow of match cards that fills in as winners advance East (main bracket)
// and losers slide into the West / North / South / corner consolations. The
// stage keys (`main:1`, `consolation:1`, …) match the bracket:round wiring set
// up by the build-compass script and the auto-advance score API, so the visual
// reflects exactly what's in the database — no hardcoded round-1-only snapshot.
type DirCol = { label: string; stage: string };
type Dir = { key: string; title: string; sub: string; tint: string; cols: DirCol[] };
const COMPASS_DIRECTIONS: Dir[] = [
  { key: 'east', title: 'East — Championship', sub: 'Win and keep advancing', tint: '#B07D00', cols: [
    { label: 'Round 1', stage: 'main:1' }, { label: 'Round 2', stage: 'main:2' },
    { label: 'Semifinals', stage: 'main:3' }, { label: 'Final', stage: 'main:4' },
  ] },
  { key: 'west', title: 'West — Consolation', sub: 'Lost Round 1', tint: '#1B448C', cols: [
    { label: 'Round 1', stage: 'consolation:1' }, { label: 'Round 2', stage: 'consolation:2' },
    { label: 'Final', stage: 'consolation:3' },
  ] },
  { key: 'north', title: 'North', sub: 'Won R1, lost East R2', tint: '#0C7B8C', cols: [
    { label: 'Round 1', stage: 'consolation:4' }, { label: 'Final', stage: 'consolation:5' },
  ] },
  { key: 'south', title: 'South', sub: 'Lost R1 and West R1', tint: '#7A5BA8', cols: [
    { label: 'Round 1', stage: 'consolation:6' }, { label: 'Final', stage: 'consolation:7' },
  ] },
  { key: 'corners', title: 'Placement finals', sub: 'Final placement matches', tint: '#6F7B90', cols: [
    { label: 'NE', stage: 'consolation:8' }, { label: 'SW', stage: 'consolation:9' },
    { label: 'NW', stage: 'consolation:10' }, { label: 'SE', stage: 'consolation:11' },
  ] },
];

function DrawCard({ m }: { m: MatchT }) {
  const aWon = m.winner_side === 'a', bWon = m.winner_side === 'b';
  const row = (name: string, won: boolean) => {
    const tbd = name === 'TBD' || !name;
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px', background: won ? '#EAF7EE' : 'transparent' }}>
        <span style={{ fontSize: 12.5, fontWeight: won ? 700 : 500, color: tbd ? '#64748b' : (won ? '#15803d' : '#1B2536'), fontStyle: tbd ? 'italic' : 'normal', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name || 'TBD'}</span>
        {won && <span style={{ marginLeft: 'auto', color: '#16a34a', fontSize: 11, fontWeight: 800 }}>✓</span>}
      </div>
    );
  };
  return (
    <div style={{ width: 150, border: '1px solid #DCE1EA', borderRadius: 8, overflow: 'hidden', background: '#fff' }}>
      {row(m.a, aWon)}
      <div style={{ borderTop: '1px solid #EEF1F6' }} />
      {row(m.b, bWon)}
      {m.score && <div style={{ padding: '2px 8px', fontSize: 11, fontWeight: 700, color: '#0f172a', background: '#F8FAFC', borderTop: '1px solid #EEF1F6' }}>{winnerFirstScore(m.score, m.winner_side)}</div>}
    </div>
  );
}

function DirectionRow({ dir, stages }: { dir: Dir; stages: Record<string, MatchT[]> }) {
  const cols = dir.cols.filter((c) => (stages[c.stage] || []).length > 0);
  if (cols.length === 0) return null;
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
        <span style={{ width: 10, height: 10, borderRadius: '50%', background: dir.tint }} />
        <span style={{ fontFamily: "'Barlow Condensed'", fontWeight: 800, fontSize: 18, textTransform: 'uppercase', color: '#111726' }}>{dir.title}</span>
        <span style={{ fontSize: 12, color: '#475569' }}>{dir.sub}</span>
      </div>
      <PanScroll maxHeightClass="max-h-none">
        <div style={{ display: 'flex', gap: 28, paddingBottom: 6, alignItems: 'stretch', minWidth: 'max-content' }}>
        {cols.map((c) => (
          <div key={c.stage} style={{ display: 'flex', flexDirection: 'column', minWidth: 150 }}>
            <div style={{ fontFamily: "'Barlow Semi Condensed'", fontWeight: 700, fontSize: 10.5, letterSpacing: '.08em', textTransform: 'uppercase', color: '#475569', marginBottom: 6, textAlign: 'center' }}>{c.label}</div>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'space-around', gap: 8 }}>
              {(stages[c.stage] || []).map((m, i) => <DrawCard key={m.token || i} m={m} />)}
            </div>
          </div>
        ))}
        </div>
      </PanScroll>
    </div>
  );
}

function CompassDraw({ stages, r1 }: { stages: Record<string, MatchT[]>; r1?: [string, string][] }) {
  // Fallback: if the structured stage data is missing (older event), seed the
  // East Round 1 column from the static config so the draw still renders.
  const safeStages: Record<string, MatchT[]> =
    Object.keys(stages).length > 0
      ? stages
      : { 'main:1': (r1 || []).map(([a, b], i) => ({ token: '', a, b, score: '', winner_side: null, status: 'pending' })) };
  return (
    <div style={{ marginBottom: 6 }}>
      <p style={{ fontSize: 14, color: '#3A4254', lineHeight: 1.5, margin: '0 0 12px' }}>
        A 16-player <strong>Compass Draw</strong>: <strong style={{ color: '#B07D00' }}>win</strong> and you advance East toward the championship; <strong style={{ color: '#1B448C' }}>lose</strong> and you slide West (then North / South / corners) — nobody&apos;s knocked out, everyone plays on. The draw below fills in live as results are reported.
      </p>
      <div style={{ border: '1px solid #EEF1F6', borderRadius: 10, padding: '14px 12px', marginBottom: 12, background: '#FBFCFE' }}>
        {COMPASS_DIRECTIONS.map((dir) => <DirectionRow key={dir.key} dir={dir} stages={safeStages} />)}
      </div>
    </div>
  );
}
