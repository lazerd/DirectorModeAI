'use client';

/**
 * Racquets IRL tournaments on the phone: the player's card ("Your match: Court 3 vs Sam"),
 * score entry, the court board, the round robin grid + standings, the bracket (the desk's
 * own draw sheets), placements, awards, and the host's draw controls. Everything reads
 * state.draw through the pure helpers in lib/play/draw.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Check, Loader2, Play, Square, Trophy } from 'lucide-react';
import { checkedIn, drawAwards, type PlayEvent } from '@/lib/play/core';
import {
  DRAW_FORMAT_NAME, DRAW_KINDS, DRAW_KIND_BLURB, DRAW_KIND_NAME, buildDraw, courtName, drawFormatFor, drawIsDoubles, drawKind, drawPlan, drawProgress, entryOf,
  fillOrder, isBracket, matchLabel, nextFor, parseSets, roundLabel, rrGridFor, scoreWinnerFirst, standingsFor,
  type Draw, type DrawFormat, type DrawMatch,
} from '@/lib/play/draw';
import { drawSheet, hasBackDraw } from '@/lib/play/drawSheet';
import DrawView from '@/components/tournament/DrawView';
import { C } from './shared';
import type { Res } from './EventClient';

type Act = (b: Record<string, unknown>, l?: string) => Promise<Res | undefined>;

const nameOf = (d: Draw, id: string | null | undefined) => entryOf(d, id)?.name ?? 'TBD';
const ago = (iso: string | null | undefined, now: number) => {
  if (!iso) return '';
  const m = Math.max(0, Math.floor((now - Date.parse(iso)) / 60000));
  return m < 1 ? 'just started' : `${m} min`;
};
function useNow(ms = 30000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(id); }, [ms]);
  return now;
}
const myEntries = (d: Draw, me: string | null | undefined) => new Set(d.entries.filter((x) => me && x.rsvpIds.includes(me)).map((x) => x.id));

/* ------------------------------------------------------------------ */
/* Live                                                                 */
/* ------------------------------------------------------------------ */

export function DrawLive({ e, busy, act }: { e: PlayEvent; busy: string; act: Act }) {
  const d = e.state.draw;
  const [tab, setTab] = useState<'courts' | 'grid' | 'matches'>('courts');
  const card = useMemo(() => (d ? nextFor(d, e.me) : null), [d, e.me]);
  // My match just went on a court: buzz the phone.
  const lastKind = useRef<string | null>(null);
  useEffect(() => {
    const k = card?.kind === 'on_court' ? `on:${card.match.key}` : card?.kind ?? null;
    if (k?.startsWith('on:') && lastKind.current && lastKind.current !== k) { try { navigator.vibrate?.([200, 100, 200]); } catch { /* */ } }
    lastKind.current = k;
  }, [card]);
  if (!d) return <p className="mt-4 rounded-2xl bg-white px-4 py-3 text-[15px] shadow-sm">The draw is being made…</p>;
  const pr = drawProgress(d);
  const bracket = isBracket(d.format);
  return (
    <>
      <section className="mt-4 flex items-center justify-between rounded-3xl bg-white p-5 shadow-sm">
        <div><div className="text-[12px] font-semibold uppercase tracking-[1.5px]" style={{ color: C.muted }}>{DRAW_FORMAT_NAME[d.format]}</div>
          <div className="text-[28px] font-semibold leading-tight">{pr.complete ? 'All matches played' : `${pr.done} of ${pr.total} played`}</div></div>
        <div className="text-right text-[13px]" style={{ color: C.muted }}>{pr.onCourt} on court<br />{pr.ready} ready</div>
      </section>
      {e.isHost && <a href={`/p/${e.code}/tv`} target="_blank" rel="noopener" className="mt-2 block text-right text-[13px] font-semibold underline" style={{ color: C.ink }}>Open the TV / projector board ↗</a>}

      {card && card.kind !== 'not_in' && <MyCard d={d} card={card} busy={busy} act={act} />}
      {card?.kind === 'not_in' && e.me && (
        <section className="mt-3 rounded-3xl p-5 shadow-sm" style={{ background: '#e9eae3' }}>
          <div className="text-[17px] font-semibold">You&apos;re not in this draw</div>
          <p className="mt-1 text-[14px]">The draw was made from the players checked in at the start. Enjoy the matches, and ask the host about the next one.</p>
        </section>
      )}

      <div className="mt-4 flex gap-2 rounded-2xl bg-white p-1 text-[14px] font-semibold">
        {(['courts', 'grid', 'matches'] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className="flex-1 rounded-xl py-2" style={tab === t ? { background: C.ink, color: '#fff' } : {}}>{t === 'courts' ? 'Courts' : t === 'grid' ? (bracket ? 'Draw' : 'Standings') : 'All matches'}</button>
        ))}
      </div>
      {tab === 'courts' && <CourtBoard e={e} d={d} busy={busy} act={act} />}
      {tab === 'grid' && (bracket ? <BracketBoard d={d} me={e.me} /> : <><Standings d={d} me={e.me} /><RRGrid d={d} me={e.me} /></>)}
      {tab === 'matches' && <AllMatches e={e} d={d} busy={busy} act={act} />}
    </>
  );
}

function MyCard({ d, card, busy, act }: { d: Draw; card: Exclude<ReturnType<typeof nextFor>, { kind: 'not_in' }>; busy: string; act: Act }) {
  const bracket = isBracket(d.format);
  if (card.kind === 'done') {
    const fin = bracket ? standingsFor(d).find((s) => s.id === card.entry.id) : null;
    return (
      <section className="mt-3 rounded-3xl p-5 shadow-sm" style={{ background: fin?.place === 1 ? C.lime : '#e9eae3' }}>
        <div className="text-[12px] font-semibold uppercase tracking-[1.5px]">{fin?.place === 1 ? 'Champion' : 'Your matches are done'}</div>
        <div className="text-[34px] font-semibold leading-none">{card.wins}–{card.losses}</div>
        <p className="mt-1 text-[14px]">{fin && fin.place !== 1 ? `Your finish: ${fin.label}. ` : ''}{bracket ? 'Follow the rest on the Draw tab.' : 'Check the standings while the rest finish.'}</p>
      </section>
    );
  }
  const stage = bracket ? <div className="text-[12px] font-semibold uppercase tracking-[1px]" style={{ color: C.muted }}>{roundLabel(d, card.match)}</div> : null;
  if (card.kind === 'on_court') return (
    <section className="mt-3 rounded-3xl p-5 shadow-sm" style={{ background: C.lime }}>
      <div className="text-[12px] font-semibold uppercase tracking-[1.5px]">Your match{bracket ? ` · ${roundLabel(d, card.match)}` : ''}</div>
      <div className="text-[44px] font-semibold leading-none">Court {card.courtName}</div>
      <div className="mt-2 text-[17px]"><b>{card.entry.players.length > 1 ? card.entry.name : 'You'}</b> vs {card.opponent}</div>
      <ScoreBox d={d} m={card.match} busy={busy} act={act} host={false} />
    </section>
  );
  if (card.kind === 'up_next') return (
    <section className="mt-3 rounded-3xl p-5 shadow-sm" style={{ background: '#f1ffc8' }}>
      <div className="text-[12px] font-semibold uppercase tracking-[1.5px]">Up next</div>
      {stage}
      <div className="text-[26px] font-semibold leading-tight">vs {card.opponent}</div>
      <p className="mt-1 text-[14px]">{card.ahead === 0 ? 'You get the next free court. Stay close.' : `${card.ahead} match${card.ahead === 1 ? '' : 'es'} ahead of you for a court.`}</p>
    </section>
  );
  return (
    <section className="mt-3 rounded-3xl p-5 shadow-sm" style={{ background: '#e9eae3' }}>
      <div className="text-[12px] font-semibold uppercase tracking-[1.5px]">Next</div>
      {stage}
      <div className="text-[24px] font-semibold leading-tight">vs {card.opponent}</div>
      <p className="mt-1 text-[14px]">Waiting on {card.waitingOn}.</p>
    </section>
  );
}

/** Tap the winner, type the score winner-first. The host also gets W/O, RET and DEF. */
function ScoreBox({ d, m, busy, act, host, onDone }: { d: Draw; m: DrawMatch; busy: string; act: Act; host: boolean; onDone?: () => void }) {
  const [w, setW] = useState<'a' | 'b' | null>(m.status === 'done' ? (m.winner ?? null) : null);
  const [txt, setTxt] = useState('');
  const [msg, setMsg] = useState('');
  const label = `ds${m.key}`;
  const save = async (how?: 'W/O' | 'RET' | 'DEF') => {
    setMsg('');
    if (!w) { setMsg('Tap who won first.'); return; }
    if (!how) { try { parseSets(txt); } catch (x) { setMsg(x instanceof Error ? x.message : 'Check the score'); return; } }
    if (how && !confirm(`${how === 'W/O' ? 'Walkover' : how === 'RET' ? 'Retired' : 'Default'}: ${nameOf(d, w === 'a' ? m.player1_id : m.player3_id)} wins?`)) return;
    const r = await act(how ? { action: 'draw_walkover', key: m.key, winner: w, how, score: how === 'RET' ? txt : undefined } : { action: 'draw_score', key: m.key, winner: w, score: txt }, label);
    if (r) { setTxt(''); onDone?.(); }
  };
  const side = (s: 'a' | 'b') => (
    <button type="button" onClick={() => setW(s)} className="flex-1 rounded-xl px-3 py-2 text-left text-[14px] font-semibold"
      style={w === s ? { background: C.ink, color: '#fff' } : { background: '#ffffffb0', color: C.ink }}>
      {w === s && <Check className="mr-1 inline h-4 w-4" />}{nameOf(d, s === 'a' ? m.player1_id : m.player3_id)}
    </button>
  );
  return (
    <div className="mt-3 grid gap-2">
      <div className="text-[12px] font-semibold uppercase tracking-[1px]" style={{ color: C.ink }}>Who won?</div>
      <div className="flex gap-2">{side('a')}{side('b')}</div>
      <div className="flex gap-2">
        <input value={txt} onChange={(x) => setTxt(x.target.value)} inputMode="text" placeholder="Winner first: 6-4 6-3" aria-label="Score"
          className="min-w-0 flex-1 rounded-xl border bg-white px-3 py-2 text-[16px] outline-none" style={{ borderColor: C.line }} />
        <button type="button" disabled={!!busy} onClick={() => save()} className="flex items-center gap-1 rounded-xl px-4 py-2 text-[15px] font-semibold text-white disabled:opacity-50" style={{ background: C.ink }}>
          {busy === label ? <Loader2 className="h-4 w-4 animate-spin" /> : null}{m.status === 'done' ? 'Fix' : 'Save'}
        </button>
      </div>
      {host && (
        <div className="flex flex-wrap gap-1.5 text-[12px] font-semibold">
          <span className="self-center" style={{ color: C.muted }}>Didn&apos;t finish:</span>
          <button type="button" disabled={!!busy} onClick={() => save('W/O')} className="rounded-lg bg-white px-2.5 py-1">Walkover</button>
          <button type="button" disabled={!!busy} onClick={() => save('RET')} className="rounded-lg bg-white px-2.5 py-1" title="Score so far (optional) in the box, winner first">Retired</button>
          <button type="button" disabled={!!busy} onClick={() => save('DEF')} className="rounded-lg bg-white px-2.5 py-1">Default</button>
        </div>
      )}
      {msg && <p className="text-[13px] text-[#9c3a25]">{msg}</p>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* The court board                                                      */
/* ------------------------------------------------------------------ */

function CourtBoard({ e, d, busy, act }: { e: PlayEvent; d: Draw; busy: string; act: Act }) {
  const now = useNow();
  const [scoring, setScoring] = useState<string | null>(null);
  const onCourt = d.matches.filter((m) => m.status === 'on_court');
  const courts = Array.from({ length: Math.max(d.courts, ...onCourt.map((m) => m.court ?? 0)) }, (_, i) => i + 1);
  const queue = d.matches.filter((m) => m.status === 'ready').sort(fillOrder);
  const busyIds = new Set(onCourt.flatMap((m) => [m.player1_id, m.player3_id]));
  const free = courts.filter((c) => c <= d.courts && !onCourt.some((m) => m.court === c));
  const recent = d.matches.filter((m) => m.status === 'done' && !m.bye).sort((a, b) => Date.parse(b.finishedAt ?? '0') - Date.parse(a.finishedAt ?? '0')).slice(0, 4);
  const mineIds = myEntries(d, e.me);
  const isMine = (m: DrawMatch) => mineIds.has(m.player1_id ?? '-') || mineIds.has(m.player3_id ?? '-');
  const bracket = isBracket(d.format);
  const waitingOnTbd = bracket && !queue.length && d.matches.some((m) => m.status === 'pending');
  return (
    <section className="mt-3 grid gap-3">
      {courts.map((c) => {
        const m = onCourt.find((x) => x.court === c);
        return (
          <div key={c} className="rounded-3xl bg-white p-4 shadow-sm" style={m && isMine(m) ? { outline: `3px solid ${C.lime}` } : undefined}>
            <div className="flex items-center justify-between">
              <div className="text-[18px] font-semibold">Court {courtName(d, c)}</div>
              <span className="rounded-full px-2.5 py-0.5 text-[12px] font-semibold" style={{ background: m ? C.lime : '#eef1e8' }}>{m ? `Playing · ${ago(m.startedAt, now)}` : 'Free'}</span>
            </div>
            {m ? (
              <>
                <div className="mt-1 text-[16px]">{nameOf(d, m.player1_id)} <span style={{ color: C.muted }}>vs</span> {nameOf(d, m.player3_id)}</div>
                {bracket && <div className="text-[12px]" style={{ color: C.muted }}>{roundLabel(d, m)}</div>}
                {e.isHost && (
                  <div className="mt-2 flex flex-wrap gap-1.5 text-[13px] font-semibold">
                    <button onClick={() => setScoring(scoring === m.key ? null : m.key)} className="rounded-lg px-3 py-1.5 text-white" style={{ background: C.ink }}>{scoring === m.key ? 'Close' : 'Score'}</button>
                    <button disabled={!!busy} onClick={() => act({ action: 'draw_court', key: m.key, court: null }, `dc${m.key}`)} className="rounded-lg px-3 py-1.5" style={{ background: '#eef1e8' }}>Take off court</button>
                  </div>
                )}
                {e.isHost && scoring === m.key && <ScoreBox d={d} m={m} busy={busy} act={act} host onDone={() => setScoring(null)} />}
              </>
            ) : <div className="mt-1 text-[14px]" style={{ color: C.muted }}>{queue.length ? 'The next match goes here as soon as its players are free.' : waitingOnTbd ? 'The next round goes here as soon as both sides are known.' : 'Nothing waiting.'}</div>}
          </div>
        );
      })}
      {queue.length > 0 && (
        <div className="rounded-3xl bg-white p-4 shadow-sm">
          <div className="text-[13px] font-semibold uppercase tracking-[1.5px]" style={{ color: C.muted }}>Up next</div>
          {queue.slice(0, e.isHost ? 30 : 8).map((m) => {
            const blocked = [m.player1_id, m.player3_id].filter((id) => busyIds.has(id)).map((id) => nameOf(d, id));
            return (
              <div key={m.key} className="flex flex-wrap items-center justify-between gap-2 border-t py-2 text-[15px]" style={{ borderColor: '#eef1e8', fontWeight: isMine(m) ? 700 : 400 }}>
                <span className="min-w-0">{matchLabel(d, m)}
                  <span className="block text-[12px] font-normal" style={{ color: C.muted }}>{m.held ? 'Held by the host' : blocked.length ? `Waiting on ${blocked.join(' & ')}` : 'Ready'} · {bracket ? roundLabel(d, m) : `R${m.round}`}</span></span>
                {e.isHost && (
                  <span className="flex items-center gap-1.5 text-[12px] font-semibold">
                    {free.length > 0 && !blocked.length && (
                      <select aria-label="Put on court" disabled={!!busy} value="" onChange={(x) => x.target.value && act({ action: 'draw_court', key: m.key, court: Number(x.target.value) }, `dc${m.key}`)} className="rounded-lg bg-[#eef1e8] px-2 py-1">
                        <option value="">Put on…</option>
                        {free.map((c) => <option key={c} value={c}>Court {courtName(d, c)}</option>)}
                      </select>
                    )}
                    {m.held && <button disabled={!!busy} onClick={() => act({ action: 'draw_court', key: m.key, court: 'auto' }, `dc${m.key}`)} className="rounded-lg px-2 py-1" style={{ background: '#eef1e8' }}>Back in line</button>}
                    <button onClick={() => setScoring(scoring === m.key ? null : m.key)} className="rounded-lg px-2 py-1" style={{ background: '#eef1e8' }}>{scoring === m.key ? 'Close' : 'Score / W/O'}</button>
                  </span>
                )}
                {e.isHost && scoring === m.key && <div className="w-full"><ScoreBox d={d} m={m} busy={busy} act={act} host onDone={() => setScoring(null)} /></div>}
              </div>
            );
          })}
        </div>
      )}
      {recent.length > 0 && (
        <div className="rounded-3xl bg-white p-4 shadow-sm">
          <div className="text-[13px] font-semibold uppercase tracking-[1.5px]" style={{ color: C.muted }}>Just finished</div>
          {recent.map((m) => <ResultLine key={m.key} d={d} m={m} />)}
        </div>
      )}
    </section>
  );
}

function ResultLine({ d, m }: { d: Draw; m: DrawMatch }) {
  const w = m.winner === 'a' ? m.player1_id : m.player3_id, l = m.winner === 'a' ? m.player3_id : m.player1_id;
  return (
    <div className="flex items-center justify-between gap-2 border-t py-2 text-[15px]" style={{ borderColor: '#eef1e8' }}>
      <span><b>{nameOf(d, w)}</b> <span style={{ color: C.muted }}>d.</span> {nameOf(d, l)}</span>
      <span className="shrink-0 tabular-nums" style={{ color: C.muted }}>{winnerFirst(m)}</span>
    </div>
  );
}

/** Stored player1-first; read out winner-first ("6-4, 3-6, 10-7"), markers as they are. */
export function winnerFirst(m: DrawMatch): string {
  return m.bye ? 'bye' : scoreWinnerFirst(m);
}

/* ------------------------------------------------------------------ */
/* Standings, grid, bracket, every match                                */
/* ------------------------------------------------------------------ */

export function Standings({ d, me, title = 'Standings' }: { d: Draw; me?: string | null; title?: string }) {
  const st = standingsFor(d);
  const mine = myEntries(d, me);
  const bracket = isBracket(d.format);
  return (
    <section className="mt-3 rounded-3xl bg-white p-4 shadow-sm">
      <div className="mb-2 px-1 text-[16px] font-semibold">{title}</div>
      <table className="w-full text-[15px]">
        <thead><tr className="text-left text-[12px] uppercase" style={{ color: C.muted }}><th className="py-1">#</th><th>{d.matchType === 'doubles' ? 'Pair' : 'Player'}</th>{bracket && <th>Finish</th>}<th className="text-right">W–L</th><th className="text-right">Games</th></tr></thead>
        <tbody>{st.map((s) => (
          <tr key={s.id} className="border-t" style={{ borderColor: '#eef1e8', fontWeight: mine.has(s.id) ? 700 : 400 }}>
            <td className="py-2">{bracket ? s.place : s.played ? s.rank : '–'}</td><td>{s.name}</td>{bracket && <td className="text-[13px]" style={{ color: C.muted }}>{s.label}</td>}<td className="text-right">{s.wins}–{s.losses}</td><td className="text-right" style={{ color: C.muted }}>{s.gamesWon}–{s.gamesLost}</td>
          </tr>
        ))}</tbody>
      </table>
      <p className="mt-2 px-1 text-[12px]" style={{ color: C.muted }}>{bracket ? (drawKind(d.format) === 'compass' ? 'Every place is played for. A range means it is still being decided.' : 'Placed by how far each got in the draw.') : 'Ranked by wins, then game difference, then fewest games lost.'}</p>
    </section>
  );
}

function RRGrid({ d, me }: { d: Draw; me?: string | null }) {
  const g = useMemo(() => rrGridFor(d), [d]);
  const f = g.flights[0];
  if (!f) return null;
  const mine = myEntries(d, me);
  return (
    <section className="mt-3 overflow-x-auto rounded-3xl bg-white p-4 shadow-sm">
      <div className="mb-2 px-1 text-[16px] font-semibold">The grid</div>
      <table className="text-[13px]">
        <thead><tr><th />{f.players.map((p, i) => <th key={p.id} className="px-1.5 py-1 text-center font-semibold" style={{ color: C.muted }} title={p.name}>{i + 1}</th>)}<th className="px-1.5 text-right" style={{ color: C.muted }}>W–L</th></tr></thead>
        <tbody>{f.rows.map((r, i) => (
          <tr key={r.id} className="border-t" style={{ borderColor: '#eef1e8', fontWeight: mine.has(r.id) ? 700 : 400 }}>
            <td className="whitespace-nowrap py-1.5 pr-2"><span className="mr-1" style={{ color: C.muted }}>{i + 1}</span>{r.name}</td>
            {r.cells.map((c, j) => (
              <td key={j} className="whitespace-nowrap px-1.5 text-center tabular-nums" style={c.kind === 'self' ? { background: '#eef1e8' } : c.kind === 'result' ? { color: c.won ? '#2f7a4f' : '#9c3a25' } : { color: '#b9c4b5' }}>
                {c.kind === 'result' ? c.text : c.kind === 'pending' ? '·' : ''}
              </td>
            ))}
            <td className="px-1.5 text-right tabular-nums">{r.wins}–{r.losses}</td>
          </tr>
        ))}</tbody>
      </table>
    </section>
  );
}

/** The bracket as the desk draws it (main + back draw tabs; a compass is one sheet). My lines are marked. */
export function BracketBoard({ d, me, flat = false }: { d: Draw; me?: string | null; flat?: boolean }) {
  const back = hasBackDraw(d);
  const mine = useMemo(() => myEntries(d, me), [d, me]);
  // Open on the half my next match is in.
  const [tab, setTab] = useState<'main' | 'consolation'>(() => {
    const c = nextFor(d, me);
    return back && 'match' in c && c.match.bracket === 'consolation' ? 'consolation' : 'main';
  });
  const sheet = useMemo(() => drawSheet(d, back ? tab : undefined), [d, back, tab]);
  return (
    <section className={`${flat ? '' : 'mt-3 shadow-sm'} overflow-hidden rounded-3xl bg-white p-3`} style={{ color: '#111827' }}>
      {back && (
        <div className="mb-3 flex gap-2 rounded-2xl p-1 text-[14px] font-semibold" style={{ background: '#eef1e8' }}>
          {(['main', 'consolation'] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)} className="flex-1 rounded-xl py-1.5" style={tab === t ? { background: C.ink, color: '#fff' } : { color: C.ink }}>{t === 'main' ? 'Main draw' : 'Back draw'}</button>
          ))}
        </div>
      )}
      <DrawView format={sheet.format} entries={sheet.entries} matches={sheet.matches} highlight={mine} />
      {mine.size > 0 && <p className="mt-2 px-1 text-[12px]" style={{ color: C.muted }}>Your lines are marked in green.</p>}
    </section>
  );
}

function AllMatches({ e, d, busy, act }: { e: PlayEvent; d: Draw; busy: string; act: Act }) {
  const [open, setOpen] = useState<string | null>(null);
  const bracket = isBracket(d.format);
  const real = d.matches.filter((m) => !m.bye);
  // Stages in play order: a bracket's main draw first, then its back draw.
  const stages = [...new Set(real.slice().sort((a, b) => (bracket ? (a.bracket === b.bracket ? 0 : a.bracket === 'main' ? -1 : 1) : 0) || a.round - b.round).map((m) => `${m.bracket}:${m.round}`))];
  const meIds = myEntries(d, e.me);
  const canScore = (m: DrawMatch) => e.isHost || (m.status !== 'done' && (meIds.has(m.player1_id ?? '-') || meIds.has(m.player3_id ?? '-')));
  return (
    <section className="mt-3 grid gap-3">
      {stages.map((st) => {
        const ms = real.filter((m) => `${m.bracket}:${m.round}` === st).sort((a, b) => a.slot - b.slot);
        return (
          <div key={st} className="rounded-3xl bg-white p-4 shadow-sm">
            <div className="text-[13px] font-semibold uppercase tracking-[1.5px]" style={{ color: C.muted }}>{roundLabel(d, ms[0])}</div>
            {ms.map((m) => (
              <div key={m.key} className="border-t py-2 text-[15px]" style={{ borderColor: '#eef1e8', fontWeight: meIds.has(m.player1_id ?? '-') || meIds.has(m.player3_id ?? '-') ? 700 : 400 }}>
                <div className="flex items-center justify-between gap-2">
                  <span className="min-w-0">{m.status === 'done' ? <><b>{nameOf(d, m.winner === 'a' ? m.player1_id : m.player3_id)}</b> d. {nameOf(d, m.winner === 'a' ? m.player3_id : m.player1_id)}</> : matchLabel(d, m)}</span>
                  <span className="flex shrink-0 items-center gap-2 text-[13px] font-normal" style={{ color: C.muted }}>
                    {m.status === 'done' ? winnerFirst(m) : m.status === 'on_court' ? `Court ${courtName(d, m.court ?? 0)}` : m.status === 'ready' ? 'Ready' : 'TBD'}
                    {canScore(m) && m.player1_id && m.player3_id && <button onClick={() => setOpen(open === m.key ? null : m.key)} className="rounded-lg px-2 py-1 font-semibold" style={{ background: '#eef1e8', color: C.ink }}>{open === m.key ? 'Close' : m.status === 'done' ? 'Fix' : 'Score'}</button>}
                  </span>
                </div>
                {open === m.key && <ScoreBox d={d} m={m} busy={busy} act={act} host={e.isHost} onDone={() => setOpen(null)} />}
              </div>
            ))}
          </div>
        );
      })}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Done                                                                 */
/* ------------------------------------------------------------------ */

export function DrawDone({ e, busy, act }: { e: PlayEvent; busy: string; act: Act }) {
  const d = e.state.draw;
  const aw = useMemo(() => (d ? drawAwards(d) : []), [d]);
  if (!d) return <p className="mt-4 text-center text-[15px]" style={{ color: C.muted }}>This one is over.</p>;
  const bracket = isBracket(d.format);
  const champ = aw[0]?.title === 'Champion' ? aw[0] : null;
  return (
    <>
      {aw.length > 0 && (
        <section className="mt-4 overflow-hidden rounded-3xl shadow-sm" style={{ background: C.lime }}>
          {champ && (
            <div className="p-6 text-center">
              <Trophy className="mx-auto h-8 w-8" />
              <div className="mt-2 text-[12px] font-semibold uppercase tracking-[2px]">Champion</div>
              <div className="text-[36px] font-semibold leading-tight tracking-tight">{champ.who}</div>
              <div className="text-[15px]">{champ.why}</div>
            </div>
          )}
          <div className="grid grid-cols-2 gap-px bg-[#103c3222]">
            {aw.filter((a) => a !== champ).map((a, i, all) => (
              <div key={a.title} className={`bg-white/85 p-4 ${all.length % 2 && i === all.length - 1 ? 'col-span-2' : ''}`}>
                <div className="text-[22px]">{a.emoji}</div>
                <div className="text-[12px] font-semibold uppercase tracking-[1px]" style={{ color: C.muted }}>{a.title}</div>
                <div className="text-[16px] font-semibold leading-tight">{a.who}</div>
                <div className="text-[13px]" style={{ color: C.muted }}>{a.why}</div>
              </div>
            ))}
          </div>
        </section>
      )}
      <Standings d={d} me={e.me} title={bracket ? 'Final places' : 'Final standings'} />
      {bracket ? <BracketBoard d={d} me={e.me} /> : <RRGrid d={d} me={e.me} />}
      {e.isHost && <AllMatches e={e} d={d} busy={busy} act={act} />}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Host                                                                 */
/* ------------------------------------------------------------------ */

const PREVIEW_AT = '2000-01-01T00:00:00.000Z';

/**
 * The host's tournament controls (open + live). The check-in list comes in from EventClient
 * (`checkIn`) so it stays one copy; HostPanel keeps courts, court numbers, players and links.
 */
export function DrawHostControls({ e, busy, act, checkIn }: { e: PlayEvent; busy: string; act: Act; checkIn: React.ReactNode }) {
  const fmt: DrawFormat = e.state.draw?.format ?? e.state.drawFormat ?? 'rr-singles';
  const here = checkedIn(e);
  const doubles = drawIsDoubles(fmt);
  const kind = drawKind(fmt);
  const d = e.state.draw;
  const pr = d ? drawProgress(d) : null;
  const hereKey = here.map((r) => `${r.id}:${r.level_num ?? ''}`).join(',');
  // The draw as it would be made right now (pure, the same code the server runs), or why it can't be.
  const preview = useMemo(() => {
    if (e.status !== 'open') return null;
    try {
      return buildDraw(fmt, here.map((r) => ({ id: r.id, name: r.name, level: r.level_num ?? null })), e.courts, { pairs: e.state.drawPairs ?? null, seeds: e.state.drawSeeds ?? null, now: PREVIEW_AT });
    } catch (x) { return x instanceof Error ? x.message : 'Can’t make that draw yet.'; }
  }, [e.status, fmt, hereKey, e.courts, e.state.drawPairs, e.state.drawSeeds]);
  if (e.status === 'open') {
    const n = doubles ? Math.floor(here.length / 2) : here.length;
    const plan = n >= 2 ? drawPlan(fmt, n) : null;
    const planText = plan && 'matches' in plan
      ? `${n} ${doubles ? 'pairs' : 'players'}: ${plan.matches} matches, ${plan.minEach === plan.maxEach ? plan.minEach : `${plan.minEach}–${plan.maxEach}`} each.${kind === 'rr' ? '' : ' Seeded by level.'}`
      : null;
    const setFormat = (f: DrawFormat) => act({ action: 'draw_format', format: f }, 'draw_format');
    return (
      <>
        <div className="rounded-2xl p-3" style={{ background: '#eef1e8' }}>
          <div className="flex items-center justify-between gap-2">
            <div className="text-[14px] font-semibold">Tournament format</div>
            <div className="flex rounded-lg bg-white p-0.5 text-[12px] font-semibold">
              {[false, true].map((dbl) => (
                <button key={String(dbl)} disabled={!!busy} onClick={() => dbl !== doubles && setFormat(drawFormatFor(kind, dbl))} className="rounded-md px-2.5 py-1"
                  style={dbl === doubles ? { background: C.ink, color: '#fff' } : {}}>{dbl ? 'Doubles' : 'Singles'}</button>
              ))}
            </div>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {DRAW_KINDS.map((k) => (
              <button key={k} disabled={!!busy} onClick={() => k !== kind && setFormat(drawFormatFor(k, doubles))} className="rounded-lg px-3 py-1.5 text-[13px] font-semibold"
                style={k === kind ? { background: C.ink, color: '#fff' } : { background: '#fff' }}>{DRAW_KIND_NAME[k]}</button>
            ))}
          </div>
          <p className="mt-2 text-[13px]">{DRAW_KIND_BLURB[kind]}</p>
          <p className="mt-1 text-[12px]" style={{ color: C.muted }}>
            {planText ?? (typeof preview === 'string' && here.length ? preview : 'Seeded by the levels people picked. You can change the seeds before you start.')}
          </p>
        </div>
        {doubles && <PairsEditor e={e} busy={busy} act={act} />}
        {checkIn}
        {preview && typeof preview !== 'string' && <SeedsEditor e={e} d={preview} busy={busy} act={act} />}
        <button onClick={() => act({ action: 'start' })} disabled={!!busy || typeof preview === 'string'}
          className="flex items-center justify-center gap-2 rounded-2xl py-3.5 text-[15px] font-semibold text-white disabled:opacity-50" style={{ background: C.ink }}>
          {busy === 'start' ? <Loader2 className="h-5 w-5 animate-spin" /> : <Play className="h-5 w-5" />}
          {!here.length ? 'Check people in to start' : typeof preview === 'string' ? `${here.length} checked in · not ready yet` : `Make the draw with ${here.length} checked in`}
        </button>
        {here.length > 0 && typeof preview === 'string' && <p className="-mt-1 text-center text-[13px] text-[#9c3a25]">{preview}</p>}
      </>
    );
  }
  return (
    <>
      {pr && <div className="rounded-2xl p-3 text-[14px]" style={{ background: pr.complete ? C.lime : '#eef1e8' }}>
        <b>{pr.complete ? 'Every match is played.' : `${pr.done} of ${pr.total} matches played`}</b>{!pr.complete && ` · ${pr.onCourt} on court · ${pr.ready} ready`}
        <div className="text-[12px]" style={{ color: pr.complete ? C.ink : C.muted }}>Courts fill themselves: each result puts the next ready match on the free court{d && isBracket(d.format) ? ' (a bracket match is ready once both sides are known)' : ''}. Use the court board to score, move or take a match off.</div>
      </div>}
      {d && e.status === 'live' && <LateArrivals e={e} d={d} busy={busy} act={act} />}
      <button onClick={() => { if (pr?.complete || confirm('End the tournament now? Unplayed matches stay unplayed.')) act({ action: 'end' }); }} disabled={!!busy}
        className="flex items-center justify-center gap-2 rounded-2xl py-3.5 text-[15px] font-semibold disabled:opacity-50" style={pr?.complete ? { background: C.ink, color: '#fff' } : { background: '#eef1e8' }}>
        <Square className="h-4 w-4" />End the tournament
      </button>
    </>
  );
}

/** Seeds before the start: the draw's order by level (or the host's), moved with the arrows. */
function SeedsEditor({ e, d, busy, act }: { e: PlayEvent; d: Draw; busy: string; act: Act }) {
  const [open, setOpen] = useState(false);
  const real = d.entries.filter((x) => !x.bye);
  const custom = !!e.state.drawSeeds?.length;
  const byes = drawKind(d.format) === 'compass' ? d.entries.some((x) => x.bye) : drawKind(d.format) !== 'rr' && (real.length & (real.length - 1)) !== 0;
  const move = (i: number, by: number) => {
    const order = real.map((x) => x.rsvpIds[0]);
    const j = i + by;
    if (j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    act({ action: 'draw_seeds', seeds: order }, 'draw_seeds');
  };
  return (
    <div className="rounded-2xl p-3" style={{ background: '#eef1e8' }}>
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-center justify-between text-left">
        <span className="text-[14px] font-semibold">Seeds {custom ? '· set by you' : '· by level'}</span>
        <span className="text-[13px] font-semibold underline">{open ? 'Done' : 'Change'}</span>
      </button>
      {!open && <p className="mt-1 text-[12px]" style={{ color: C.muted }}>{real.slice(0, 4).map((x) => `${x.seed}. ${x.name}`).join(' · ')}{real.length > 4 ? ' …' : ''}</p>}
      {open && (
        <>
          <ol className="mt-2 grid gap-1">
            {real.map((x, i) => (
              <li key={x.id} className="flex items-center gap-2 rounded-xl bg-white px-2 py-1.5 text-[14px]">
                <span className="w-6 text-right font-semibold tabular-nums" style={{ color: C.muted }}>{x.seed}</span>
                <span className="min-w-0 flex-1 truncate">{x.name}{x.level != null ? <span style={{ color: C.muted }}> · {x.level}</span> : null}</span>
                <button aria-label={`Move ${x.name} up`} disabled={!!busy || i === 0} onClick={() => move(i, -1)} className="grid h-7 w-7 place-items-center rounded-lg disabled:opacity-30" style={{ background: '#eef1e8' }}><ArrowUp className="h-4 w-4" /></button>
                <button aria-label={`Move ${x.name} down`} disabled={!!busy || i === real.length - 1} onClick={() => move(i, 1)} className="grid h-7 w-7 place-items-center rounded-lg disabled:opacity-30" style={{ background: '#eef1e8' }}><ArrowDown className="h-4 w-4" /></button>
              </li>
            ))}
          </ol>
          <p className="mt-2 text-[12px]" style={{ color: C.muted }}>{drawKind(d.format) === 'rr' ? 'In a round robin the seeds only set the order of play.' : `Top seeds are spread out so they meet late${byes ? ', and the top seeds get the byes' : ''}.`} Anyone who checks in later goes in by level.</p>
          {custom && <button disabled={!!busy} onClick={() => act({ action: 'draw_seeds', seeds: [] }, 'draw_seeds')} className="mt-2 text-[13px] font-semibold underline">Back to seeding by level</button>}
        </>
      )}
    </div>
  );
}

/** Checked in after the draw was made: a round robin takes them until the first result; a bracket never does. */
function LateArrivals({ e, d, busy, act }: { e: PlayEvent; d: Draw; busy: string; act: Act }) {
  const [pick, setPick] = useState<string | null>(null);
  const inDraw = new Set(d.entries.flatMap((x) => x.rsvpIds));
  const late = e.rsvps.filter((r) => r.status !== 'out' && r.checked_in_at && !inDraw.has(r.id));
  if (!late.length) return null;
  const doubles = d.matchType === 'doubles';
  const open = !isBracket(d.format) && !d.matches.some((m) => m.status === 'done');
  const names = late.map((r) => r.name).join(', ');
  if (!open) return (
    <div className="rounded-2xl p-3 text-[13px]" style={{ background: '#fff7d6' }}>
      <b>{names}</b> checked in after the draw was made. {isBracket(d.format) ? 'A bracket’s lines are set once it’s made, so they can’t join this one.' : 'The draw is already under way (a match is finished), so they can’t join it.'}
      <div className="mt-1" style={{ color: C.muted }}>If someone in the draw has to leave, give their opponents a walkover: Score / W/O on the court board.</div>
    </div>
  );
  const add = (ids: string[]) => act({ action: 'draw_add_entry', ids }, 'draw_add_entry');
  return (
    <div className="rounded-2xl p-3" style={{ background: '#fff7d6' }}>
      <div className="text-[14px] font-semibold">Late arrivals</div>
      <p className="mt-1 text-[12px]" style={{ color: C.muted }}>
        {doubles ? (pick ? `Now tap ${late.find((r) => r.id === pick)?.name}’s partner.` : 'Tap two names to add them as a pair, before the first result is in.') : 'Add them before the first result is in: they go in last, and matches on court stay put.'}
      </p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {late.map((r) => (
          <button key={r.id} disabled={!!busy} className="rounded-full px-3 py-1.5 text-[13px] font-semibold"
            style={pick === r.id ? { background: C.lime, color: C.ink } : { background: '#fff' }}
            onClick={() => {
              if (!doubles) { add([r.id]); return; }
              if (!pick) { setPick(r.id); return; }
              if (pick !== r.id) add([pick, r.id]);
              setPick(null);
            }}>
            {doubles ? r.name : `Add ${r.name}`}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Doubles: the host pairs people up (tap two names). Anyone left unpaired is balanced automatically at the start. */
function PairsEditor({ e, busy, act }: { e: PlayEvent; busy: string; act: Act }) {
  const pairs = e.state.drawPairs ?? [];
  const [pick, setPick] = useState<string | null>(null);
  const list = e.rsvps.filter((r) => r.status !== 'out');
  const name = (id: string) => list.find((r) => r.id === id)?.name ?? '?';
  const paired = new Set(pairs.flat());
  const save = (p: string[][]) => act({ action: 'draw_pairs', pairs: p }, 'draw_pairs');
  const tap = (id: string) => {
    if (!pick) { setPick(id); return; }
    if (pick !== id) save([...pairs, [pick, id]]);
    setPick(null);
  };
  const live = pairs.filter((p) => p.every((id) => list.some((r) => r.id === id)));
  return (
    <div className="rounded-2xl p-3" style={{ background: '#eef1e8' }}>
      <div className="text-[14px] font-semibold">Pairs</div>
      <p className="mt-1 text-[12px]" style={{ color: C.muted }}>{pick ? `Now tap ${name(pick)}’s partner.` : 'Tap two names to pair them. Anyone you don’t pair is balanced automatically (strongest with weakest) when you make the draw.'}</p>
      {live.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {live.map((p) => (
            <span key={p.join('|')} className="inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-[13px] font-semibold text-white" style={{ background: C.ink }}>
              {p.map(name).join(' / ')}
              <button aria-label="Split this pair" disabled={!!busy} onClick={() => save(live.filter((x) => x !== p))} className="ml-1 rounded-full bg-white/20 px-1.5">×</button>
            </span>
          ))}
        </div>
      )}
      <div className="mt-2 flex flex-wrap gap-1.5">
        {list.filter((r) => !paired.has(r.id)).map((r) => (
          <button key={r.id} disabled={!!busy} onClick={() => tap(r.id)} className="rounded-full px-3 py-1.5 text-[13px]"
            style={pick === r.id ? { background: C.lime, color: C.ink } : { background: '#fff' }}>{r.checked_in_at ? '✓ ' : ''}{r.name}</button>
        ))}
      </div>
    </div>
  );
}
