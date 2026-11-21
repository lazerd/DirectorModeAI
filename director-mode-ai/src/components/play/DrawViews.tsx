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
  fillOrder, isBracket, isGrouped, matchEntries, matchLabel, nextFor, parseSets, roundLabel, rrGridFor, scoreWinnerFirst, sideName, stageKey, stageOrder, standingsFor,
  type Draw, type DrawFormat, type DrawMatch,
} from '@/lib/play/draw';
import { DEFAULT_QUADS_SCORING, QUADS_SCORING, autoPools, groupTables, playoffMatches, poolChoices, quadsScoringName, scoreHint } from '@/lib/play/drawGroups';
import type { RRFlight } from '@/lib/roundRobinGrid';
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
const hasMine = (mine: Set<string>, m: DrawMatch) => matchEntries(m).some((id) => mine.has(id));
/** What the Draw tab is called: the bracket, the flights (quads), the pools. */
const drawTabName = (d: Draw) => (drawKind(d.format) === 'quads' ? 'Flights' : drawKind(d.format) === 'rr-pools' ? 'Pools' : 'Draw');

/* ------------------------------------------------------------------ */
/* Live                                                                 */
/* ------------------------------------------------------------------ */

export function DrawLive({ e, busy, act, hostSlot }: { e: PlayEvent; busy: string; act: Act; hostSlot?: React.ReactNode }) {
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
      {/* The player's match first and biggest; the draw's progress is one slim line under it. */}
      {card && card.kind !== 'not_in' && <MyCard d={d} card={card} busy={busy} act={act} />}
      {card?.kind === 'not_in' && e.me && (
        <section className="mt-4 rounded-3xl p-5 shadow-sm" style={{ background: '#e9eae3' }}>
          <div className="text-[17px] font-semibold">You&apos;re not in this draw</div>
          <p className="mt-1 text-[14px]">The draw was made from the players checked in at the start. Enjoy the matches, and ask the host about the next one.</p>
        </section>
      )}
      <section className="mt-3 flex items-center justify-between gap-3 rounded-2xl bg-white px-4 py-3 shadow-sm">
        <div className="min-w-0"><div className="truncate text-[11px] font-semibold uppercase tracking-[1.5px]" style={{ color: C.muted }}>{DRAW_FORMAT_NAME[d.format]}</div>
          <div className="text-[18px] font-semibold leading-tight">{pr.complete ? 'All matches played' : `${pr.done} of ${pr.total} played`}</div></div>
        <div className="shrink-0 text-right text-[13px]" style={{ color: C.muted }}>{pr.onCourt} on court · {pr.ready} ready</div>
      </section>
      {hostSlot}

      <div role="tablist" aria-label="Draw views" className="mt-4 flex gap-2 rounded-2xl bg-white p-1 text-[14px] font-semibold">
        {(['courts', 'grid', 'matches'] as const).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className="flex-1 rounded-xl py-2" style={tab === t ? { background: C.ink, color: '#fff' } : {}}>{t === 'courts' ? 'Courts' : t === 'grid' ? (bracket ? drawTabName(d) : 'Standings') : 'All matches'}</button>
        ))}
      </div>
      {tab === 'courts' && <CourtBoard e={e} d={d} busy={busy} act={act} />}
      {tab === 'grid' && (bracket ? <>{isGrouped(d.format) && <Standings d={d} me={e.me} title="Places so far" />}<BracketBoard d={d} me={e.me} /></> : <><Standings d={d} me={e.me} /><RRGrid d={d} me={e.me} /></>)}
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
  if (card.kind === 'alternate') return (
    <section className="mt-3 rounded-3xl p-5 shadow-sm" style={{ background: '#fff7d6' }}>
      <div className="text-[12px] font-semibold uppercase tracking-[1.5px]">You&apos;re the alternate{card.of > 1 ? ` · ${card.position} of ${card.of}` : ''}</div>
      <div className="text-[24px] font-semibold leading-tight">Not in a flight this time</div>
      <p className="mt-1 text-[14px]">Quads plays in flights of exactly four, and {card.of === 1 ? 'one player was' : `${card.of} players were`} left over when the draw was made. Stay close: if someone in a flight has to leave, the host can bring you in. Otherwise, you&apos;re first in line for the next one.</p>
    </section>
  );
  if (card.kind === 'between') return (
    <section className="mt-3 rounded-3xl p-5 shadow-sm" style={{ background: '#e9eae3' }}>
      <div className="text-[12px] font-semibold uppercase tracking-[1.5px]">Next · {card.stage}</div>
      <div className="text-[34px] font-semibold leading-none">{card.wins}–{card.losses}<span className="ml-2 text-[15px] font-normal" style={{ color: C.muted }}>so far</span></div>
      <p className="mt-1 text-[14px]">Waiting on {card.waitingOn}.</p>
    </section>
  );
  const stage = bracket ? <div className="text-[12px] font-semibold uppercase tracking-[1px]" style={{ color: C.muted }}>{roundLabel(d, card.match)}</div> : null;
  const you = card.partner ? `You & ${card.partner}` : card.entry.players.length > 1 ? card.entry.name : 'You';
  if (card.kind === 'on_court') return (
    <section className="mt-3 rounded-3xl p-5 shadow-sm" style={{ background: C.lime }}>
      <div className="text-[12px] font-semibold uppercase tracking-[1.5px]">Your match{bracket ? ` · ${roundLabel(d, card.match)}` : ''}</div>
      <div className="text-[44px] font-semibold leading-none">Court {card.courtName}</div>
      <div className="mt-2 text-[17px]"><b>{you}</b> vs {card.opponent}</div>
      <ScoreBox d={d} m={card.match} busy={busy} act={act} host={false} />
    </section>
  );
  if (card.kind === 'up_next') return (
    <section className="mt-3 rounded-3xl p-5 shadow-sm" style={{ background: '#f1ffc8' }}>
      <div className="text-[12px] font-semibold uppercase tracking-[1.5px]">Up next{card.courts ? ` · ${card.courts}` : ''}</div>
      {stage}
      <div className="text-[26px] font-semibold leading-tight">{card.partner ? `With ${card.partner}, ` : ''}vs {card.opponent}</div>
      <p className="mt-1 text-[14px]">{card.ahead === 0 ? `You get the next free court${card.courts ? ` (${card.courts.replace(/^Courts? /, '')})` : ''}. Stay close.` : `${card.ahead} match${card.ahead === 1 ? '' : 'es'} ahead of you for a court.`}</p>
    </section>
  );
  return (
    <section className="mt-3 rounded-3xl p-5 shadow-sm" style={{ background: '#e9eae3' }}>
      <div className="text-[12px] font-semibold uppercase tracking-[1.5px]">Next</div>
      {stage}
      <div className="text-[24px] font-semibold leading-tight">{card.partner ? `With ${card.partner}, ` : ''}vs {card.opponent}</div>
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
    if (how && !confirm(`${how === 'W/O' ? 'Walkover' : how === 'RET' ? 'Retired' : 'Default'}: ${sideName(d, m, w)} wins?`)) return;
    const r = await act(how ? { action: 'draw_walkover', key: m.key, winner: w, how, score: how === 'RET' ? txt : undefined } : { action: 'draw_score', key: m.key, winner: w, score: txt }, label);
    if (r) { setTxt(''); onDone?.(); }
  };
  const side = (s: 'a' | 'b') => (
    <button type="button" onClick={() => setW(s)} className="flex-1 rounded-xl px-3 py-2 text-left text-[14px] font-semibold"
      style={w === s ? { background: C.ink, color: '#fff' } : { background: '#ffffffb0', color: C.ink }}>
      {w === s && <Check className="mr-1 inline h-4 w-4" />}{sideName(d, m, s)}
    </button>
  );
  return (
    <div className="mt-3 grid gap-2">
      <div className="text-[12px] font-semibold uppercase tracking-[1px]" style={{ color: C.ink }}>Who won?</div>
      <div className="flex gap-2">{side('a')}{side('b')}</div>
      <div className="flex gap-2">
        <input value={txt} onChange={(x) => setTxt(x.target.value)} inputMode="text" placeholder={drawKind(d.format) === 'quads' ? scoreHint(d.scoring) : 'Winner first: 6-4 6-3'} aria-label="Score"
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
  const busyIds = new Set(onCourt.flatMap(matchEntries));
  const free = courts.filter((c) => c <= d.courts && !onCourt.some((m) => m.court === c));
  const recent = d.matches.filter((m) => m.status === 'done' && !m.bye).sort((a, b) => Date.parse(b.finishedAt ?? '0') - Date.parse(a.finishedAt ?? '0')).slice(0, 4);
  const mineIds = myEntries(d, e.me);
  const isMine = (m: DrawMatch) => hasMine(mineIds, m);
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
                <div className="mt-1 text-[16px]">{sideName(d, m, 'a')} <span style={{ color: C.muted }}>vs</span> {sideName(d, m, 'b')}</div>
                {bracket && <div className="text-[12px]" style={{ color: C.muted }}>{roundLabel(d, m)}</div>}
                {e.isHost && (
                  <div className="mt-2 flex flex-wrap gap-1.5 text-[13px] font-semibold">
                    <button onClick={() => setScoring(scoring === m.key ? null : m.key)} className="rounded-lg px-3 py-1.5 text-white" style={{ background: C.ink }}>{scoring === m.key ? 'Close' : 'Score'}</button>
                    <button disabled={!!busy} onClick={() => act({ action: 'draw_court', key: m.key, court: null }, `dc${m.key}`)} className="rounded-lg px-3 py-1.5" style={{ background: '#eef1e8' }}>Take off court</button>
                  </div>
                )}
                {e.isHost && scoring === m.key && <ScoreBox d={d} m={m} busy={busy} act={act} host onDone={() => setScoring(null)} />}
              </>
            ) : <div className="mt-1 text-[14px]" style={{ color: C.muted }}>{drawKind(d.format) === 'quads' && courtFlights(d, c) ? `${courtFlights(d, c)}’s court: its next match goes here as soon as its players are free.` : queue.length ? 'The next match goes here as soon as its players are free.' : waitingOnTbd ? 'The next round goes here as soon as both sides are known.' : 'Nothing waiting.'}</div>}
          </div>
        );
      })}
      {queue.length > 0 && (
        <div className="rounded-3xl bg-white p-4 shadow-sm">
          <div className="text-[13px] font-semibold uppercase tracking-[1.5px]" style={{ color: C.muted }}>Up next</div>
          {queue.slice(0, e.isHost ? 30 : 8).map((m) => {
            const blocked = matchEntries(m).filter((id) => busyIds.has(id)).map((id) => nameOf(d, id));
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

/** Quads: which flight(s) a court belongs to ("Flight A"), for an empty court's line. */
function courtFlights(d: Draw, c: number): string | null {
  const names = groupTables(d, String).filter((t) => (t.courts ?? '').replace(/^Courts? /, '').split(' & ').includes(String(c))).map((t) => t.group.name);
  return names.length ? names.join(' / ') : null;
}

function ResultLine({ d, m }: { d: Draw; m: DrawMatch }) {
  const w = m.winner === 'b' ? 'b' : 'a';
  return (
    <div className="flex items-center justify-between gap-2 border-t py-2 text-[15px]" style={{ borderColor: '#eef1e8' }}>
      <span><b>{sideName(d, m, w)}</b> <span style={{ color: C.muted }}>d.</span> {sideName(d, m, w === 'a' ? 'b' : 'a')}</span>
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
      <p className="mt-2 px-1 text-[12px]" style={{ color: C.muted }}>{drawKind(d.format) === 'quads' ? 'Each flight places 1st to 4th on games won over all four rounds (doubles games count for both partners), then match wins, head-to-head, games lost. Flight A takes places 1–4, Flight B 5–8, and so on.' : drawKind(d.format) === 'rr-pools' ? 'Pool places first (wins, game difference, fewest games lost); once every pool is done, the placement playoffs decide the final places.' : bracket ? (drawKind(d.format) === 'compass' ? 'Every place is played for. A range means it is still being decided.' : 'Placed by how far each got in the draw.') : 'Ranked by wins, then game difference, then fewest games lost.'}</p>
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
      <GridTable f={f} mine={mine} />
    </section>
  );
}

/** The crosstab: each player a row and a column, the result in every cell. */
function GridTable({ f, mine }: { f: RRFlight; mine: Set<string> }) {
  return (
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
  );
}

/**
 * Quads flights / pools: one card per group (its table, its grid, a flight's doubles), then
 * the pools' placement playoffs. Phone, TV and the done page all show this.
 */
export function GroupTables({ d, me, flat = false }: { d: Draw; me?: string | null; flat?: boolean }) {
  const tables = useMemo(() => groupTables(d, (n) => courtName(d, n)), [d]);
  const mine = useMemo(() => myEntries(d, me), [d, me]);
  const po = playoffMatches(d);
  const quads = drawKind(d.format) === 'quads';
  return (
    <section className={`${flat ? '' : 'mt-3'} grid gap-3 ${flat ? 'md:grid-cols-2 xl:grid-cols-3' : ''}`} style={{ color: '#111827' }}>
      {tables.map((t) => (
        <div key={t.group.id} className={`overflow-x-auto rounded-3xl bg-white p-4 ${flat ? '' : 'shadow-sm'}`} style={t.rows.some((r) => mine.has(r.id)) ? { outline: `3px solid ${C.lime}` } : undefined}>
          <div className="flex flex-wrap items-baseline justify-between gap-x-2 px-1">
            <div className="text-[17px] font-semibold">{t.group.name}{t.group.tier ? <span className="ml-1.5 text-[12px] font-semibold uppercase tracking-[1px]" style={{ color: C.muted }}>{t.group.tier}</span> : null}</div>
            {t.courts && <div className="text-[13px] font-semibold" style={{ color: C.muted }}>{t.courts}</div>}
          </div>
          <table className="mt-1 w-full text-[14px]">
            <thead><tr className="text-left text-[11px] uppercase" style={{ color: C.muted }}><th className="py-1">#</th><th>{d.matchType === 'doubles' ? 'Pair' : 'Player'}</th><th className="text-right">W–L</th><th className="text-right">Games</th></tr></thead>
            <tbody>{t.rows.map((r) => (
              <tr key={r.id} className="border-t" style={{ borderColor: '#eef1e8', fontWeight: mine.has(r.id) ? 700 : 400 }}>
                <td className="py-1.5">{r.wins + r.losses ? r.rank : '–'}</td>
                <td>{r.name}{r.label ? <span className="ml-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ background: C.lime }}>🏆 {r.label}</span> : null}</td>
                <td className="text-right tabular-nums">{r.wins}–{r.losses}</td>
                <td className="text-right tabular-nums" style={{ color: C.muted }}>{r.gamesWon}–{r.gamesLost}</td>
              </tr>
            ))}</tbody>
          </table>
          {t.grid && <div className="mt-2 overflow-x-auto"><GridTable f={t.grid} mine={mine} /></div>}
          {quads && (
            <div className="mt-2 rounded-2xl px-3 py-2 text-[13px]" style={{ background: '#eef1e8' }}>
              <span className="font-semibold">Round 4 doubles: </span>
              {t.doubles ? (t.doubles.status === 'done'
                ? <><b>{sideName(d, t.doubles, t.doubles.winner === 'b' ? 'b' : 'a')}</b> d. {sideName(d, t.doubles, t.doubles.winner === 'b' ? 'a' : 'b')} <span className="tabular-nums" style={{ color: C.muted }}>{winnerFirst(t.doubles)}</span></>
                : <>{matchLabel(d, t.doubles)}<span style={{ color: C.muted }}>{t.doubles.status === 'on_court' ? ` · Court ${courtName(d, t.doubles.court ?? 0)}` : ' · next'}</span></>)
                : <span style={{ color: C.muted }}>1st + 4th vs 2nd + 3rd, paired once the six singles are in.</span>}
            </div>
          )}
        </div>
      ))}
      {drawKind(d.format) === 'rr-pools' && (
        <div className={`rounded-3xl bg-white p-4 ${flat ? '' : 'shadow-sm'}`}>
          <div className="px-1 text-[17px] font-semibold">Placement playoffs</div>
          {po.length ? po.map((m) => (
            <div key={m.key} className="border-t py-2 text-[14px]" style={{ borderColor: '#eef1e8', fontWeight: hasMine(mine, m) ? 700 : 400 }}>
              <div className="text-[12px] font-semibold uppercase tracking-[1px]" style={{ color: C.muted }}>{roundLabel(d, m)}</div>
              {m.status === 'done'
                ? <div><b>{sideName(d, m, m.winner === 'b' ? 'b' : 'a')}</b> d. {sideName(d, m, m.winner === 'b' ? 'a' : 'b')} <span className="tabular-nums" style={{ color: C.muted }}>{winnerFirst(m)}</span></div>
                : <div>{matchLabel(d, m)}{m.status === 'on_court' ? <span style={{ color: C.muted }}> · Court {courtName(d, m.court ?? 0)}</span> : null}</div>}
            </div>
          )) : <p className="mt-1 px-1 text-[13px]" style={{ color: C.muted }}>Set when every pool match is done: the pool winners play for 1st, the runners-up for the next places, and so on down.</p>}
        </div>
      )}
    </section>
  );
}

/** The bracket as the desk draws it (main + back draw tabs; a compass is one sheet). My lines are marked. */
export function BracketBoard({ d, me, flat = false }: { d: Draw; me?: string | null; flat?: boolean }) {
  if (isGrouped(d.format)) return <GroupTables d={d} me={me} flat={flat} />;
  return <BracketSheet d={d} me={me} flat={flat} />;
}

function BracketSheet({ d, me, flat }: { d: Draw; me?: string | null; flat: boolean }) {
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
  const stages = [...new Set(real.slice().sort((a, b) => stageOrder(d, a) - stageOrder(d, b)).map(stageKey))];
  const meIds = myEntries(d, e.me);
  const canScore = (m: DrawMatch) => e.isHost || (m.status !== 'done' && hasMine(meIds, m));
  return (
    <section className="mt-3 grid gap-3">
      {stages.map((st) => {
        const ms = real.filter((m) => stageKey(m) === st).sort((a, b) => a.slot - b.slot);
        return (
          <div key={st} className="rounded-3xl bg-white p-4 shadow-sm">
            <div className="text-[13px] font-semibold uppercase tracking-[1.5px]" style={{ color: C.muted }}>{roundLabel(d, ms[0])}</div>
            {ms.map((m) => (
              <div key={m.key} className="border-t py-2 text-[15px]" style={{ borderColor: '#eef1e8', fontWeight: hasMine(meIds, m) ? 700 : 400 }}>
                <div className="flex items-center justify-between gap-2">
                  <span className="min-w-0">{m.status === 'done' ? <><b>{sideName(d, m, m.winner === 'b' ? 'b' : 'a')}</b> d. {sideName(d, m, m.winner === 'b' ? 'a' : 'b')}</> : matchLabel(d, m)}</span>
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
  const [fmtOpen, setFmtOpen] = useState(false); // the format picker folds to one row
  // The draw as it would be made right now (pure, the same code the server runs), or why it can't be.
  const preview = useMemo(() => {
    if (e.status !== 'open') return null;
    try {
      return buildDraw(fmt, here.map((r) => ({ id: r.id, name: r.name, level: r.level_num ?? null })), e.courts, { pairs: e.state.drawPairs ?? null, seeds: e.state.drawSeeds ?? null, pools: e.state.drawPools ?? null, scoring: e.state.drawScoring ?? null, now: PREVIEW_AT });
    } catch (x) { return x instanceof Error ? x.message : 'Can’t make that draw yet.'; }
  }, [e.status, fmt, hereKey, e.courts, e.state.drawPairs, e.state.drawSeeds, e.state.drawPools, e.state.drawScoring]);
  if (e.status === 'open') {
    const n = doubles ? Math.floor(here.length / 2) : here.length;
    const plan = n >= 2 ? drawPlan(fmt, n, { pools: e.state.drawPools ?? null }) : null;
    const unit = doubles ? 'pairs' : 'players';
    const each = plan && 'matches' in plan ? (plan.minEach === plan.maxEach ? `${plan.minEach}` : `${plan.minEach}–${plan.maxEach}`) : '';
    const altNames = preview && typeof preview !== 'string' ? (preview.alternates ?? []).map((x) => x.name).join(', ') : '';
    const planText = plan && 'matches' in plan
      ? kind === 'quads'
        ? `${n} players: ${plan.groups} flight${plan.groups === 1 ? '' : 's'} of 4, ${plan.matches} matches, 4 each.${plan.alternates ? ` ${plan.alternates} left over (${altNames || 'the lowest seeds'}): MixerMode waitlists them as alternates. Check in ${4 - plan.alternates} more for another flight.` : ''}`
        : kind === 'rr-pools'
          ? `${n} ${unit}: ${plan.groups} pools, then placement playoffs. ${plan.matches} matches, ${each} each.`
          : `${n} ${unit}: ${plan.matches} matches, ${each} each.${kind === 'rr' ? '' : ' Seeded by level.'}`
      : null;
    const setOptions = (o: Record<string, unknown>) => act({ action: 'draw_options', ...o }, 'draw_options');
    const poolOpts = n >= 6 ? poolChoices(n) : [2, 3, 4];
    const setFormat = (f: DrawFormat) => act({ action: 'draw_format', format: f }, 'draw_format');
    const planLine = planText ?? (typeof preview === 'string' && here.length ? preview : 'Seeded by the levels people picked. You can change the seeds before you start.');
    return (
      <>
        {!fmtOpen ? (
          <button type="button" aria-expanded={false} onClick={() => setFmtOpen(true)} className="flex items-center justify-between gap-3 rounded-2xl p-3 text-left" style={{ background: '#eef1e8' }}>
            <span className="min-w-0">
              <span className="block text-[14px] font-semibold">{DRAW_KIND_NAME[kind]}{kind !== 'quads' ? ` · ${doubles ? 'Doubles' : 'Singles'}` : ''}</span>
              <span className="block text-[12px]" style={{ color: C.muted }}>{planLine}</span>
            </span>
            <span className="shrink-0 text-[13px] font-semibold underline">Change</span>
          </button>
        ) : (
        <div className="rounded-2xl p-3" style={{ background: '#eef1e8' }}>
          <div className="flex items-center justify-between gap-2">
            <div className="text-[14px] font-semibold">Tournament format <button type="button" onClick={() => setFmtOpen(false)} className="ml-1 text-[13px] underline">Done</button></div>
            {kind !== 'quads' && <div className="flex rounded-lg bg-white p-0.5 text-[12px] font-semibold">
              {[false, true].map((dbl) => (
                <button key={String(dbl)} disabled={!!busy} onClick={() => dbl !== doubles && setFormat(drawFormatFor(kind, dbl))} className="rounded-md px-2.5 py-1"
                  style={dbl === doubles ? { background: C.ink, color: '#fff' } : {}}>{dbl ? 'Doubles' : 'Singles'}</button>
              ))}
            </div>}
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {DRAW_KINDS.map((k) => (
              <button key={k} disabled={!!busy} onClick={() => k !== kind && setFormat(drawFormatFor(k, doubles))} className="rounded-lg px-3 py-1.5 text-[13px] font-semibold"
                style={k === kind ? { background: C.ink, color: '#fff' } : { background: '#fff' }}>{DRAW_KIND_NAME[k]}</button>
            ))}
          </div>
          <p className="mt-2 text-[13px]">{DRAW_KIND_BLURB[kind]}</p>
          {kind === 'quads' && (
            <label className="mt-2 flex items-center gap-2 text-[13px] font-semibold">Scoring
              <select disabled={!!busy} value={e.state.drawScoring ?? DEFAULT_QUADS_SCORING} onChange={(x) => setOptions({ scoring: x.target.value })} className="min-w-0 flex-1 rounded-lg bg-white px-2 py-1.5 font-normal">
                {QUADS_SCORING.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
              </select>
            </label>
          )}
          {kind === 'rr-pools' && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[13px] font-semibold">
              <span>Pools</span>
              {([null, ...poolOpts] as (number | null)[]).map((k) => {
                const on = (e.state.drawPools ?? null) === k;
                return <button key={k ?? 'auto'} disabled={!!busy} onClick={() => !on && setOptions({ pools: k })} className="rounded-lg px-2.5 py-1" style={on ? { background: C.ink, color: '#fff' } : { background: '#fff' }}>{k ?? `Auto${n >= 6 ? ` (${autoPools(n)})` : ''}`}</button>;
              })}
            </div>
          )}
          <p className="mt-1 text-[12px]" style={{ color: C.muted }}>{planLine}</p>
        </div>
        )}
        {doubles && <PairsEditor e={e} busy={busy} act={act} />}
        {checkIn}
        {preview && typeof preview !== 'string' && <SeedsEditor e={e} d={preview} busy={busy} act={act} />}
        <button onClick={() => act({ action: 'start' })} disabled={!!busy || typeof preview === 'string'}
          className="flex h-14 items-center justify-center gap-2 rounded-2xl text-[17px] font-semibold disabled:opacity-50" style={{ background: C.lime, color: C.ink }}>
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
        <div className="text-[12px]" style={{ color: pr.complete ? C.ink : C.muted }}>{d && drawKind(d.format) === 'quads' ? `Each flight stays on its own courts; its doubles goes on as soon as its six singles are in. Scoring: ${quadsScoringName(d.scoring)}.` : d && drawKind(d.format) === 'rr-pools' ? 'Courts fill themselves; the placement playoffs go in as soon as every pool match is done.' : `Courts fill themselves: each result puts the next ready match on the free court${d && isBracket(d.format) ? ' (a bracket match is ready once both sides are known)' : ''}.`} Use the court board to score, move or take a match off.</div>
      </div>}
      {d?.alternates?.length ? (
        <div className="rounded-2xl p-3 text-[13px]" style={{ background: '#fff7d6' }}>
          <b>Alternates: {d.alternates.map((x) => x.name).join(', ')}.</b> Quads flights are exactly four, so {d.alternates.length === 1 ? 'they wait' : 'they wait'} (MixerMode waitlists the lowest seeds). If a flight player has to leave, give their opponents walkovers on Score / W/O, or start a fresh draw.
        </div>
      ) : null}
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
  // Quads: the alternates are seeds too (the lowest ones): moving one up puts them in a flight.
  const real = [...d.entries.filter((x) => !x.bye), ...(d.alternates ?? [])];
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
          <p className="mt-2 text-[12px]" style={{ color: C.muted }}>{drawKind(d.format) === 'quads' ? `Seeds 1–4 are Flight A, 5–8 Flight B, and so on${d.alternates?.length ? '; the last ones are the alternates' : ''}.` : drawKind(d.format) === 'rr-pools' ? 'Seeds are snaked into the pools (1, 2, 3 / 6, 5, 4 ...), so every pool gets a top seed.' : drawKind(d.format) === 'rr' ? 'In a round robin the seeds only set the order of play.' : `Top seeds are spread out so they meet late${byes ? ', and the top seeds get the byes' : ''}.`} Anyone who checks in later goes in by level.</p>
          {custom && <button disabled={!!busy} onClick={() => act({ action: 'draw_seeds', seeds: [] }, 'draw_seeds')} className="mt-2 text-[13px] font-semibold underline">Back to seeding by level</button>}
        </>
      )}
    </div>
  );
}

/** Checked in after the draw was made: a round robin takes them until the first result; a bracket never does. */
function LateArrivals({ e, d, busy, act }: { e: PlayEvent; d: Draw; busy: string; act: Act }) {
  const [pick, setPick] = useState<string | null>(null);
  const inDraw = new Set([...d.entries, ...(d.alternates ?? [])].flatMap((x) => x.rsvpIds));
  const late = e.rsvps.filter((r) => r.status !== 'out' && r.checked_in_at && !inDraw.has(r.id));
  if (!late.length) return null;
  const doubles = d.matchType === 'doubles';
  const open = !isBracket(d.format) && !d.matches.some((m) => m.status === 'done');
  const names = late.map((r) => r.name).join(', ');
  if (!open) return (
    <div className="rounded-2xl p-3 text-[13px]" style={{ background: '#fff7d6' }}>
      <b>{names}</b> checked in after the draw was made. {drawKind(d.format) === 'quads' ? 'The flights are set once the draw is made, so they can’t join this one.' : drawKind(d.format) === 'rr-pools' ? 'The pools are set once the draw is made, so they can’t join this one.' : isBracket(d.format) ? 'A bracket’s lines are set once it’s made, so they can’t join this one.' : 'The draw is already under way (a match is finished), so they can’t join it.'}
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
