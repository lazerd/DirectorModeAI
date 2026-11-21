'use client';

import type { GuestFormat } from '@/lib/mixer/guestMixer';
import { courtPlan, type PlayFormat } from '@/lib/play/core';
import { DRAW_KIND_BLURB, DRAW_KIND_NAME, drawFormatFor, drawIsDoubles, drawKind, drawPlan, type DrawFormat, type DrawKind } from '@/lib/play/draw';
import s from './EventPicker.module.css';

/**
 * Pick the event. Optimize Courts is the hero (Darrin's #1 MixerMode event); every tile
 * shows live court math for the host's own numbers so the choice is concrete.
 */
type Dot = { x: number; y: number; c: 'a' | 'b' | 's' | 'w' };
const COL = { a: '#d4ff49', b: '#7fe0b4', s: '#ffffff', w: '#ff9fc4' };

function Court({ dots, crown, arrow, dim }: { dots: Dot[]; crown?: boolean; arrow?: 'up' | 'down'; dim?: boolean }) {
  return (
    <svg viewBox="0 0 54 92" className={s.court} aria-hidden="true" style={{ opacity: dim ? 0.35 : 1 }}>
      <rect x="1" y="1" width="52" height="90" rx="5" fill="#1f6b52" stroke="#ffffff40" />
      <path d="M8 4v84M46 4v84M8 24h38M8 68h38M27 24v44" stroke="#ffffff38" strokeWidth="1" fill="none" />
      <path d="M2 46h50" stroke="#ffffffb0" strokeWidth="1.6" />
      {dots.map((d, i) => (
        <circle key={i} className={`${s.dot} ${i % 2 ? s.float2 : s.float}`} cx={d.x} cy={d.y} r="5.2" fill={COL[d.c]} stroke="#0b2a22" strokeWidth="1.2" />
      ))}
      {crown && <text x="27" y="15" textAnchor="middle" fontSize="11">👑</text>}
      {arrow && <text x="46" y={arrow === 'up' ? 14 : 86} textAnchor="middle" fontSize="10" fill="#d4ff49" fontWeight="900">{arrow === 'up' ? '↑' : '↓'}</text>}
    </svg>
  );
}
const D: Dot[] = [{ x: 17, y: 31, c: 'a' }, { x: 37, y: 31, c: 'a' }, { x: 17, y: 61, c: 'b' }, { x: 37, y: 61, c: 'b' }];
const S: Dot[] = [{ x: 27, y: 31, c: 's' }, { x: 27, y: 61, c: 's' }];
const M: Dot[] = [{ x: 17, y: 31, c: 'a' }, { x: 37, y: 31, c: 'w' }, { x: 17, y: 61, c: 'a' }, { x: 37, y: 61, c: 'w' }];

function planLine(f: GuestFormat, spots: number | null, courts: number) {
  if (spots == null) { // no cap: say what a round holds; everyone who checks in rotates through
    const cap = courtPlan(f, courts * 4, courts);
    const hold = f === 'singles' ? courts * 2 : f === 'team-battle' ? cap.doubles * 4 + cap.singles * 2 : courts * 4;
    return { text: `${courts} court${courts === 1 ? '' : 's'}: up to ${hold} play each round · anyone extra rotates in`, warn: false };
  }
  const p = courtPlan(f, spots, courts);
  const parts = [p.doubles && `${p.doubles} doubles`, p.singles && `${p.singles} singles`].filter(Boolean).join(' + ') || 'not enough players yet';
  const used = p.doubles + p.singles;
  const sit = p.sit > 0 ? `${p.sit} rotate${p.sit === 1 ? 's' : ''} out` : 'nobody sits';
  const idle = courts - used > 0 ? ` · ${courts - used} court${courts - used === 1 ? '' : 's'} idle` : '';
  return { text: `${spots} players on ${courts} court${courts === 1 ? '' : 's'}: ${parts} · ${sit}${idle}`, warn: courts - used > 0 || p.sit > 2 };
}

const T: Dot[] = [{ x: 17, y: 31, c: 'a' }, { x: 37, y: 31, c: 'a' }, { x: 17, y: 61, c: 'w' }, { x: 37, y: 61, c: 'w' }];
const TS: Dot[] = [{ x: 27, y: 31, c: 'a' }, { x: 27, y: 61, c: 'w' }];
const SMALL: { f: GuestFormat; title: string; blurb: string; art: React.ReactNode; wide?: boolean }[] = [
  {
    f: 'team-battle', wide: true, title: 'Team Battle', blurb: 'Two teams, lines matched by strength like team tennis. Every court counts for the team.',
    art: <><Court dots={T} /><Court dots={T} /><Court dots={TS} /><span style={{ color: '#d4ff49', fontWeight: 800, fontSize: 22, marginLeft: 8, whiteSpace: 'nowrap' }}>5 <span style={{ color: '#9fb3a6' }}>–</span> <span style={{ color: '#ff9fc4' }}>3</span></span></>,
  },
  {
    f: 'king-of-court', title: 'King of the Court', blurb: 'Winners move up, losers move down. Hold court 1.',
    art: <><Court dots={D} crown arrow="up" /><Court dots={D} arrow="down" dim /></>,
  },
  { f: 'doubles', title: 'Rotating Doubles', blurb: 'New partner every round, all doubles.', art: <><Court dots={D} /><Court dots={[D[2], D[1], D[0], D[3]]} dim /></> },
  { f: 'mixed-doubles', title: 'Mixed Doubles', blurb: 'One man, one woman per team. Partners rotate.', art: <><Court dots={M} /><Court dots={[M[2], M[3], M[0], M[1]]} dim /></> },
  { f: 'singles', title: 'Singles', blurb: 'One-on-one, new opponent each round.', art: <><Court dots={S} /><Court dots={S} dim /></> },
];

/** "8 players: 28 matches, 7 each" for this draw with the host's numbers. */
function drawLine(df: DrawFormat, spots: number | null, courts: number) {
  const doubles = drawIsDoubles(df);
  const k = drawKind(df);
  if (spots == null) return `${courts} court${courts === 1 ? '' : 's'} · ${k === 'rr' ? 'everyone plays everyone once' : k === 'quads' ? 'each flight on its own two courts' : k === 'rr-pools' ? 'pools, then playoffs for every place' : 'courts fill as matches are set'}`;
  const n = doubles ? Math.floor(spots / 2) : spots;
  const plan = drawPlan(df, n);
  if ('problem' in plan) return plan.problem.replace(/ \(.*\)\.?/, '.').replace(/\.$/, '');
  if (k === 'quads') return `${n} players: ${plan.groups} flight${plan.groups === 1 ? '' : 's'}, 4 matches each${plan.alternates ? `, ${plan.alternates} alternate${plan.alternates === 1 ? '' : 's'}` : ''}`;
  if (k === 'rr-pools') return `${n} ${doubles ? 'pairs' : 'players'}: ${plan.groups} pools + playoffs, ${plan.minEach === plan.maxEach ? plan.minEach : `${plan.minEach}–${plan.maxEach}`} matches each`;
  return `${n} ${doubles ? 'pairs' : 'players'}: ${plan.matches} matches, ${plan.minEach === plan.maxEach ? plan.minEach : `${plan.minEach}–${plan.maxEach}`} each`;
}

/** A little draw sheet: two rounds of lines feeding a final (a compass fans both ways). */
function Sheet({ compass, back }: { compass?: boolean; back?: boolean }) {
  const line = '#ffffffb0', dim = '#ffffff55';
  return (
    <svg viewBox="0 0 92 68" className={s.court} style={{ width: 92 }} aria-hidden="true">
      {compass ? (
        <g fill="none" strokeWidth="1.4">
          <path d="M34 14h24M34 26h24M34 42h24M34 54h24" stroke={line} />
          <path d="M58 14v12M58 20h14M58 42v12M58 48h14M72 20v28M72 34h16" stroke="#d4ff49" />
          <path d="M34 14v12M34 20H20M34 42v12M34 48H20M20 20v28M20 34H4" stroke={dim} />
        </g>
      ) : (
        <g fill="none" strokeWidth="1.4">
          <path d="M6 8h26M6 20h26M6 38h26M6 50h26" stroke={line} />
          <path d="M32 8v12M32 14h26M32 38v12M32 44h26M58 14v30M58 29h28" stroke="#d4ff49" />
          {back && <path d="M6 60h26M32 60v6M6 66h26" stroke={dim} />}
        </g>
      )}
    </svg>
  );
}

/** Quads: four little flights of four. Pools: two groups feeding a playoff line. */
function Groups({ pools }: { pools?: boolean }) {
  const line = '#ffffffb0';
  return (
    <svg viewBox="0 0 92 68" className={s.court} style={{ width: 92 }} aria-hidden="true">
      {pools ? (
        <g fill="none" strokeWidth="1.4">
          <rect x="4" y="6" width="34" height="24" rx="4" stroke={line} /><rect x="4" y="38" width="34" height="24" rx="4" stroke={line} />
          <path d="M38 18h16M38 50h16M54 18v32M54 34h30" stroke="#d4ff49" />
        </g>
      ) : (
        <g>
          {[[6, 6], [50, 6], [6, 38], [50, 38]].map(([x, y], i) => (
            <g key={i}>
              <rect x={x} y={y} width="36" height="24" rx="4" fill="none" stroke={i === 0 ? '#d4ff49' : line} strokeWidth="1.4" />
              {[0, 1, 2, 3].map((j) => <circle key={j} cx={x + 7 + j * 7.3} cy={y + 12} r="2.6" fill={i === 0 ? '#d4ff49' : line} />)}
            </g>
          ))}
        </g>
      )}
    </svg>
  );
}

/* Tournament tiles: one per draw kind; singles or doubles is a switch above them. */
const TOURNEY: { k: DrawKind; art: React.ReactNode }[] = [
  { k: 'rr', art: <><Court dots={S} /><Court dots={S} dim /></> },
  { k: 'single-elim', art: <Sheet /> },
  { k: 'fmlc', art: <Sheet back /> },
  { k: 'ffic', art: <Sheet back /> },
  { k: 'compass', art: <Sheet compass /> },
  { k: 'quads', art: <Groups /> },
  { k: 'rr-pools', art: <Groups pools /> },
];

export default function EventPicker({ value, drawFormat, spots, courts, onChange }: { value: PlayFormat; drawFormat?: DrawFormat | null; spots: number | null; courts: number; onChange: (f: PlayFormat, df?: DrawFormat) => void }) {
  const df: DrawFormat = drawFormat ?? 'rr-singles';
  const hero = planLine('maximize-courts', spots, courts);
  const heroPlan = courtPlan('maximize-courts', spots ?? courts * 4, courts);
  const heroCourts = heroPlan.doubles + heroPlan.singles
    ? [...Array(heroPlan.doubles).fill('d'), ...Array(heroPlan.singles).fill('s')].slice(0, 4)
    : ['d', 'd', 's'];
  return (
    <section className={s.wrap} aria-label="Choose the event">
      <div className={s.eyebrow}><b>Choose the event</b><span>Live math for your numbers</span></div>

      <button type="button" role="radio" aria-checked={value === 'maximize-courts'} onClick={() => onChange('maximize-courts')} className={`${s.tile} ${value === 'maximize-courts' ? s.on : ''}`}>
        <span className={s.check}>✓</span>
        <div className={s.hero}>
          <div style={{ position: 'relative', zIndex: 1 }}>
            <span className={s.badge}>⚡ Most played</span>
            <div className={s.heroTitle}>Optimize Courts</div>
            <div className={s.blurb}>Every court full, every round. Doubles wherever four fit, singles with the rest, and the fewest possible sit-outs.</div>
            <div className={s.chips}><span>Auto singles + doubles</span><span>Partners rotate</span><span>Fair sit-outs</span></div>
          </div>
          <div className={s.art}>
            {heroCourts.map((k, i) => <Court key={i} dots={k === 'd' ? D : S} />)}
          </div>
        </div>
        <div className={`${s.math} ${hero.warn ? s.warn : ''}`} style={{ padding: '0 20px 18px', marginTop: 0 }}><i />{hero.text}</div>
      </button>

      <div className={s.grid} role="radiogroup" aria-label="Other events">
        {SMALL.map((t) => {
          const m = planLine(t.f, spots, courts);
          return (
            <button key={t.f} type="button" role="radio" aria-checked={value === t.f} onClick={() => onChange(t.f)} className={`${s.tile} ${s.small} ${value === t.f ? s.on : ''}`} style={t.wide ? { gridColumn: '1 / -1', minHeight: 0 } : undefined}>
              <span className={s.check}>✓</span>
              <div className={s.art}>{t.art}</div>
              <div className={s.smallTitle} style={{ position: 'relative', zIndex: 1 }}>{t.title}</div>
              <div className={s.smallBlurb} style={{ position: 'relative', zIndex: 1 }}>{t.blurb}</div>
              <div className={`${s.math} ${m.warn ? s.warn : ''}`} style={{ fontSize: 11 }}><i />{m.text.replace(/^\d+ players on \d+ courts?: /, '').replace(/^\d+ courts?: /, '')}</div>
            </button>
          );
        })}
      </div>

      <div className={s.eyebrow} style={{ marginTop: 18 }}><b>Tournament</b><span>A real draw · courts fill themselves</span></div>
      <div role="radiogroup" aria-label="Singles or doubles" style={{ display: 'inline-flex', gap: 4, padding: 3, borderRadius: 10, background: '#103c32' }}>
        {[false, true].map((dbl) => {
          // Quads is singles + doubles by design: the switch only remembers the choice for the others.
          const on = drawIsDoubles(df) === dbl && drawKind(df) !== 'quads';
          return (
            <button key={String(dbl)} type="button" role="radio" aria-checked={on} onClick={() => onChange('tournament', drawFormatFor(drawKind(df), dbl))}
              style={{ padding: '5px 12px', borderRadius: 8, fontSize: 12, fontWeight: 700, background: on ? '#d4ff49' : 'transparent', color: on ? '#103c32' : '#e3ecdf' }}>
              {dbl ? 'Doubles' : 'Singles'}
            </button>
          );
        })}
      </div>
      <div className={s.grid} role="radiogroup" aria-label="Tournament formats">
        {TOURNEY.map((t) => {
          const f = drawFormatFor(t.k, drawIsDoubles(df));
          const on = value === 'tournament' && drawKind(df) === t.k;
          return (
            <button key={t.k} type="button" role="radio" aria-checked={on} onClick={() => onChange('tournament', f)} className={`${s.tile} ${s.small} ${on ? s.on : ''}`}>
              <span className={s.check}>✓</span>
              <div className={s.art}>{t.art}</div>
              <div className={s.smallTitle} style={{ position: 'relative', zIndex: 1 }}>{DRAW_KIND_NAME[t.k]}</div>
              <div className={s.smallBlurb} style={{ position: 'relative', zIndex: 1 }}>{t.k === 'rr' && drawIsDoubles(f) ? 'Fixed pairs, every pair plays every pair once.' : DRAW_KIND_BLURB[t.k]}</div>
              <div className={s.math} style={{ fontSize: 11 }}><i />{drawLine(f, spots, courts)}</div>
            </button>
          );
        })}
      </div>
    </section>
  );
}
