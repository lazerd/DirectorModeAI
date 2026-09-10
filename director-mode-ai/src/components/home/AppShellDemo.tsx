'use client';

/**
 * AppShellDemo — the homepage "screenshot" of the real app, running.
 *
 * Borrowed from memorang.com's hero: instead of an abstract illustration, show
 * the actual product shell with every tool down the left rail. Here it is live
 * rather than a PNG — the rail tours the tools on its own, each view animating
 * in, and the AI bar types a command that fits the tool on screen. Hovering
 * pauses the tour; clicking a tool jumps to it.
 *
 * The rail renders from src/config/nav.ts, so a product added there shows up
 * here with no edit (it gets a generic view until someone draws it a bespoke
 * one below). Every person, club and team in these views is invented.
 *
 * It renders at a fixed 1120×640 "screenshot" size and scales down to fit, so
 * a phone sees the whole shell in miniature — the way an image would — instead
 * of a cramped reflow.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Search, Sparkles, Radio, Plus, Check, X as XIcon, Minus, ChevronDown, ArrowUp, ArrowDown } from 'lucide-react';
import { SECTIONS, FOR_YOU, type Tool } from '@/config/nav';

type Group = { label: string; tools: Tool[] };

/** The rail: every product, grouped the way the real sidebar groups them. */
const GROUPS: Group[] = [
  ...SECTIONS.map((s) => ({ label: s.label, tools: s.tools.filter((t) => t.product) })),
  { label: 'For you', tools: FOR_YOU.filter((t) => t.product) },
].filter((g) => g.tools.length > 0);

const ALL_TOOLS = GROUPS.flatMap((g) => g.tools);

/** The self-running tour, in the order you would show a friend. */
const TOUR = [
  'CourtSheet', 'LeagueMode', 'MixerMode', 'LessonMode',
  'TournamentMode', 'PathwayMode', 'StringingMode', 'CaptainMode',
].filter((n) => ALL_TOOLS.some((t) => t.name === n));

const STEP_MS = 5200;
/** After a click, leave the chosen tool on screen this long before touring again. */
const HOLD_MS = 15000;
const W = 1120;
const H = 672;
/**
 * Shown in the fake URL bar. Display text only, never a link — and not APP_HOST,
 * which still reads the legacy host until the NEXT_PUBLIC_APP_URL cutover.
 */
const SHOWN_HOST = 'clubmode.ai';

/* ------------------------------------------------------------------ helpers */

/** Staggered entrance for rows inside a view. Replays whenever the view changes. */
function In({ i, children, className = '' }: { i: number; children: ReactNode; className?: string }) {
  return (
    <div className={`hm-fade-up ${className}`} style={{ animationDelay: `${60 + i * 55}ms` }}>
      {children}
    </div>
  );
}

function Chip({ color, children }: { color: string; children: ReactNode }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-[2px] text-[10px] font-semibold"
      style={{ background: `${color}1f`, color }}
    >
      {children}
    </span>
  );
}

function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-xl border border-white/[0.07] bg-white/[0.03] ${className}`}>{children}</div>;
}

function Label({ children }: { children: ReactNode }) {
  return <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/35">{children}</p>;
}

/** Swaps `before` for `after` once, `ms` after mount. */
function Later({ ms, before, after }: { ms: number; before: ReactNode; after: ReactNode }) {
  const [done, setDone] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setDone(true), ms);
    return () => clearTimeout(t);
  }, [ms]);
  return <>{done ? after : before}</>;
}

function TypedPrompt({ text, animate }: { text: string; animate: boolean }) {
  const [n, setN] = useState(animate ? 0 : text.length);
  useEffect(() => {
    if (!animate) {
      setN(text.length);
      return;
    }
    setN(0);
    const id = setInterval(() => {
      setN((k) => {
        if (k >= text.length) {
          clearInterval(id);
          return k;
        }
        return k + 1;
      });
    }, 26);
    return () => clearInterval(id);
  }, [text, animate]);
  return (
    <span className="text-white/75">
      {text.slice(0, n)}
      <span className="hm-caret" />
    </span>
  );
}

/* -------------------------------------------------------------------- views */

const COURT_ROWS: { c: string; blocks: { s: number; l: number; label: string; tone: string; ai?: boolean }[] }[] = [
  { c: 'Court 1', blocks: [{ s: 0, l: 2, label: 'Cardio Tennis', tone: '#D3FB52' }, { s: 3, l: 1.5, label: 'Private · Coach Ana', tone: '#a78bfa' }] },
  { c: 'Court 2', blocks: [{ s: 0.5, l: 1.5, label: 'Singles · Priya / Tom', tone: '#22d3ee' }, { s: 2.5, l: 2, label: '3.5 Ladies league', tone: '#34d399' }] },
  { c: 'Court 3', blocks: [{ s: 1, l: 3, label: 'JTT 12U · Riverbend vs Northside', tone: '#eab308' }] },
  { c: 'Court 4', blocks: [{ s: 0, l: 1, label: 'Ball machine', tone: '#94a3b8' }, { s: 4, l: 2, label: "Men's drill", tone: '#fb923c' }] },
  { c: 'Court 5', blocks: [{ s: 2, l: 1.5, label: 'Doubles · 4.0', tone: '#22d3ee' }] },
  { c: 'Court 6', blocks: [{ s: 1.5, l: 2, label: 'Red ball clinic', tone: '#f472b6' }] },
  { c: 'Court 7', blocks: [{ s: 0, l: 1.5, label: 'Private · Coach Ben', tone: '#a78bfa' }, { s: 3.5, l: 1.5, label: 'Singles · Wes / Jae', tone: '#22d3ee' }] },
  { c: 'Court 8', blocks: [{ s: 2, l: 1.5, label: '5 PM clinic · booked by AI', tone: '#D3FB52', ai: true }] },
  { c: 'Pickle A', blocks: [{ s: 0, l: 2.5, label: 'Open play', tone: '#2dd4bf' }, { s: 3, l: 2, label: 'Pickleball 101', tone: '#f472b6' }] },
];

function CourtSheetView() {
  const hours = ['3 PM', '4 PM', '5 PM', '6 PM', '7 PM', '8 PM'];
  return (
    <div className="flex h-full flex-col">
      <div className="flex pb-2 pl-[76px] text-[10px] text-white/35">
        {hours.map((h) => <span key={h} className="flex-1">{h}</span>)}
      </div>
      <div className="relative flex-1 space-y-[6px]">
        {COURT_ROWS.map((row, i) => (
          <In key={row.c} i={i} className="flex items-center gap-3">
            <span className="w-16 shrink-0 text-[11px] text-white/45">{row.c}</span>
            <div className="relative h-[38px] flex-1 overflow-hidden rounded-md border border-white/[0.05] bg-white/[0.025]">
              {[1, 2, 3, 4, 5].map((k) => (
                <span key={k} className="absolute inset-y-0 w-px bg-white/[0.04]" style={{ left: `${(k / 6) * 100}%` }} />
              ))}
              {row.blocks.map((b) => (
                <div
                  key={b.label}
                  className={`absolute bottom-[3px] top-[3px] flex items-center gap-1.5 rounded-[5px] border px-2 ${b.ai ? 'hm-fade-up' : ''}`}
                  style={{
                    left: `${(b.s / 6) * 100}%`,
                    width: `calc(${(b.l / 6) * 100}% - 3px)`,
                    background: `${b.tone}24`,
                    borderColor: `${b.tone}66`,
                    boxShadow: b.ai ? '0 0 18px rgba(211,251,82,0.35)' : undefined,
                    animationDelay: b.ai ? '1900ms' : undefined,
                  }}
                >
                  {b.ai && <Sparkles size={11} className="shrink-0 text-[#D3FB52]" />}
                  <span className="truncate text-[10.5px] font-medium text-white/85">{b.label}</span>
                </div>
              ))}
            </div>
          </In>
        ))}
        {/* "now" line */}
        <div className="pointer-events-none absolute bottom-0 top-0 w-px bg-[#D3FB52]/70" style={{ left: `calc(76px + (100% - 76px) * ${1.35 / 6})` }}>
          <span className="hm-pulse-ring absolute -left-[3px] -top-1 h-[7px] w-[7px] rounded-full bg-[#D3FB52]" />
          <span className="absolute -left-[3px] -top-1 h-[7px] w-[7px] rounded-full bg-[#D3FB52]" />
        </div>
      </div>
    </div>
  );
}

function LiveScore() {
  const [s, setS] = useState<[number, number]>([5, 4]);
  useEffect(() => {
    const id = setInterval(() => {
      setS(([a, b]) => (a >= 8 ? [5, 4] : (a + b) % 2 === 0 ? [a + 1, b] : [a, Math.min(b + 1, 7)]));
    }, 1300);
    return () => clearInterval(id);
  }, []);
  return <span className="tabular-nums">{s[0]}–{s[1]}</span>;
}

function LeagueView() {
  const lines = [
    { l: 'Singles 1', a: 'Theo', b: 'Dario', s: '8–2', won: true },
    { l: 'Singles 2', a: 'Ada', b: 'Simone', s: '8–5', won: true },
    { l: 'Singles 3', a: 'Ellis', b: 'Jonah', s: '6–8', won: false },
    { l: 'Doubles 1', a: 'Ines / Otto', b: 'Renn / Sasha', s: '8–6', won: true },
    { l: 'Doubles 2', a: 'Kai / Nora', b: 'Beau / Lena', live: true },
  ];
  const ladder = [
    { n: 'Ada', move: 'up' }, { n: 'Theo', move: 'down' }, { n: 'Ellis', move: '' },
    { n: 'Kai', move: 'up' }, { n: 'Nora', move: '' }, { n: 'Ines', move: 'down' },
  ];
  return (
    <div className="grid h-full grid-cols-[1.55fr_1fr] gap-4">
      <div>
        <In i={0}>
          <Card className="mb-3 flex items-center justify-between px-5 py-4">
            <div>
              <p className="text-[11px] text-white/40">Home · Riverbend</p>
              <p className="text-[15px] font-bold">Riverbend Racquet</p>
            </div>
            <p className="text-[34px] font-bold tabular-nums tracking-tight text-[#D3FB52]">3 <span className="text-white/25">–</span> 1</p>
            <div className="text-right">
              <p className="text-[11px] text-white/40">Away</p>
              <p className="text-[15px] font-bold">Northside TC</p>
            </div>
          </Card>
        </In>
        <div className="space-y-2">
          {lines.map((m, i) => (
            <In key={m.l} i={i + 1}>
              <div className="flex items-center justify-between rounded-lg border border-white/[0.06] bg-white/[0.03] px-4 py-2.5">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="w-16 shrink-0 text-[10.5px] text-white/40">{m.l}</span>
                  <span className="truncate text-[12.5px] text-white/85">
                    <span className={m.won ? 'font-semibold text-white' : ''}>{m.a}</span>
                    <span className="text-white/30"> vs </span>
                    <span className={m.won === false ? 'font-semibold text-white' : ''}>{m.b}</span>
                  </span>
                </div>
                {m.live ? (
                  <span className="flex items-center gap-2 text-[13px] font-bold text-white">
                    <span className="relative flex h-2 w-2">
                      <span className="hm-pulse-ring absolute inline-flex h-full w-full rounded-full bg-red-400" />
                      <span className="relative inline-flex h-2 w-2 rounded-full bg-red-400" />
                    </span>
                    <LiveScore />
                  </span>
                ) : (
                  <span className={`font-mono text-[13px] font-bold ${m.won ? 'text-[#D3FB52]' : 'text-white/40'}`}>{m.s}</span>
                )}
              </div>
            </In>
          ))}
        </div>
      </div>
      <In i={2}>
        <Card className="h-full p-4">
          <Label>Strength ladder · 12U</Label>
          <div className="space-y-1.5">
            {ladder.map((p, i) => (
              <div key={p.n} className="flex items-center gap-2.5 rounded-lg bg-white/[0.03] px-3 py-2">
                <span className="w-4 text-[11px] font-bold text-white/35">{i + 1}</span>
                <span className="flex-1 text-[12.5px] text-white/85">{p.n}</span>
                {p.move === 'up' && <ArrowUp size={13} className="text-[#34d399]" />}
                {p.move === 'down' && <ArrowDown size={13} className="text-[#fb923c]" />}
                {!p.move && <Minus size={13} className="text-white/20" />}
              </div>
            ))}
          </div>
          <p className="mt-3 text-[10.5px] text-white/35">Re-ladders itself as scores come in.</p>
        </Card>
      </In>
    </div>
  );
}

function MixerView() {
  const rows = [
    { n: 'Jordan P.', w: 3, l: 0, g: 24 },
    { n: 'Alex K.', w: 2, l: 1, g: 21 },
    { n: 'Casey L.', w: 2, l: 1, g: 19 },
    { n: 'Sam R.', w: 1, l: 2, g: 16 },
    { n: 'Morgan T.', w: 1, l: 2, g: 14 },
    { n: 'Riley B.', w: 0, l: 3, g: 10 },
  ];
  const courts = [
    { c: 'Court 1', t: 'Jordan / Riley  vs  Alex / Morgan' },
    { c: 'Court 2', t: 'Casey / Dev  vs  Sam / Quinn' },
    { c: 'Court 3', t: 'Pat / Lou  vs  Remy / Skye' },
    { c: 'Court 4', t: 'Ash / Bo  vs  Cam / Drew' },
  ];
  return (
    <div className="grid h-full grid-cols-[1.35fr_1fr] gap-4">
      <In i={0}>
        <Card className="p-4">
          <Label>Standings · after round 2</Label>
          <div className="grid grid-cols-[24px_1fr_52px_1fr] gap-y-2 text-[12px]">
            {rows.map((r, i) => (
              <div key={r.n} className="contents">
                <span className="font-bold text-white/35">{i + 1}</span>
                <span className={i === 0 ? 'font-semibold text-white' : 'text-white/80'}>{r.n}</span>
                <span className="font-mono text-white/55">{r.w}–{r.l}</span>
                <span className="flex items-center gap-2">
                  <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.06]">
                    <span className="block h-full rounded-full bg-[#fb923c] hm-progress" style={{ width: `${(r.g / 24) * 100}%`, animationDuration: '900ms', animationDelay: `${i * 80}ms` }} />
                  </span>
                  <span className="w-5 text-right font-mono text-[11px] text-white/45">{r.g}</span>
                </span>
              </div>
            ))}
          </div>
        </Card>
      </In>
      <div className="space-y-2">
        <In i={1}><Label>Round 3 · on court now</Label></In>
        {courts.map((c, i) => (
          <In key={c.c} i={i + 2}>
            <div className="rounded-lg border border-white/[0.06] bg-white/[0.03] px-3.5 py-2.5">
              <p className="text-[10px] text-white/40">{c.c}</p>
              <p className="whitespace-pre text-[12px] text-white/85">{c.t}</p>
            </div>
          </In>
        ))}
        <In i={6}>
          <div className="flex items-center gap-2 rounded-lg border border-[#fb923c]/30 bg-[#fb923c]/10 px-3.5 py-2.5 text-[11.5px] text-[#fdba74]">
            <Sparkles size={13} /> Partners balanced by rating — no repeats
          </div>
        </In>
      </div>
    </div>
  );
}

function LessonView() {
  const slots = ['3:00', '3:30', '4:00', '4:30', '5:00', '5:30', '6:00'];
  const coaches = [
    { n: 'Coach Ana', booked: { '3:00': 'Priya S.', '3:30': 'Priya S.', '5:00': 'Tom W.' } as Record<string, string> },
    { n: 'Coach Ben', booked: { '4:00': 'Group · 10U', '4:30': 'Group · 10U', '6:00': 'Wes H.' } as Record<string, string> },
    { n: 'Coach Luis', booked: { '3:00': 'Jae K.' } as Record<string, string>, flip: '4:30' },
  ];
  return (
    <div className="grid h-full grid-cols-3 gap-4">
      {coaches.map((c, ci) => (
        <div key={c.n} className="space-y-1.5">
          <In i={ci}>
            <div className="mb-1 flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#34d399]/15 text-[11px] font-bold text-[#34d399]">{c.n.split(' ')[1][0]}</span>
              <span className="text-[13px] font-semibold">{c.n}</span>
            </div>
          </In>
          {slots.map((s, si) => {
            const who = c.booked[s];
            const open = (
              <div className="flex items-center justify-between rounded-lg border border-dashed border-[#34d399]/35 px-3 py-[9px]">
                <span className="text-[11.5px] text-white/60">{s}</span>
                <span className="text-[10.5px] font-semibold text-[#34d399]">Open</span>
              </div>
            );
            const taken = (name: string, fresh = false) => (
              <div
                className={`flex items-center justify-between rounded-lg border px-3 py-[9px] ${fresh ? 'hm-fade-up border-[#D3FB52]/50 bg-[#D3FB52]/10' : 'border-white/[0.06] bg-white/[0.04]'}`}
                style={fresh ? { boxShadow: '0 0 16px rgba(211,251,82,0.25)' } : undefined}
              >
                <span className="text-[11.5px] text-white/60">{s}</span>
                <span className={`text-[10.5px] font-medium ${fresh ? 'text-[#D3FB52]' : 'text-white/75'}`}>{name}</span>
              </div>
            );
            return (
              <In key={s} i={ci + si + 1}>
                {who ? taken(who) : c.flip === s ? <Later ms={2200} before={open} after={taken('Just booked · Dana M.', true)} /> : open}
              </In>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function TournamentView() {
  const col = (label: string, matches: { a: string; b: string; s: string; w: 0 | 1 }[], i: number, gap: string) => (
    <div className="flex flex-col">
      <In i={i}><Label>{label}</Label></In>
      <div className={`flex flex-1 flex-col justify-around ${gap}`}>
        {matches.map((m, k) => (
          <In key={m.a + m.b} i={i + k}>
            <div className="overflow-hidden rounded-lg border border-white/[0.07] bg-white/[0.03] text-[11.5px]">
              {[m.a, m.b].map((p, j) => (
                <div key={p} className={`flex items-center justify-between px-3 py-[6px] ${j === 0 ? 'border-b border-white/[0.05]' : ''}`}>
                  <span className={m.w === j ? 'font-semibold text-white' : 'text-white/45'}>{p}</span>
                  <span className={`font-mono ${m.w === j ? 'text-[#eab308]' : 'text-white/30'}`}>{m.s.split(' ')[j]}</span>
                </div>
              ))}
            </div>
          </In>
        ))}
      </div>
    </div>
  );
  return (
    <div className="grid h-full grid-cols-4 gap-5">
      {col('Quarterfinals', [
        { a: 'M. Alvarez [1]', b: 'D. Chen', s: '6 2', w: 0 },
        { a: 'K. Osei', b: 'P. Laurent [4]', s: '4 6', w: 1 },
        { a: 'R. Silva [3]', b: 'T. Brandt', s: '7 5', w: 0 },
        { a: 'J. Novak', b: 'E. Park [2]', s: '3 6', w: 1 },
      ], 0, 'gap-2')}
      {col('Semifinals', [
        { a: 'M. Alvarez [1]', b: 'P. Laurent [4]', s: '6 4', w: 0 },
        { a: 'R. Silva [3]', b: 'E. Park [2]', s: '5 7', w: 1 },
      ], 4, 'gap-8')}
      {col('Final', [{ a: 'M. Alvarez [1]', b: 'E. Park [2]', s: '7 6', w: 0 }], 6, '')}
      <div className="flex flex-col">
        <In i={7}><Label>Champion</Label></In>
        <div className="flex flex-1 items-center">
          <In i={8} className="w-full">
            <div className="rounded-xl border border-[#eab308]/40 bg-[#eab308]/10 p-4 text-center" style={{ boxShadow: '0 0 30px rgba(234,179,8,0.18)' }}>
              <p className="text-[26px]">🏆</p>
              <p className="mt-1 text-[14px] font-bold">M. Alvarez</p>
              <p className="text-[10.5px] text-white/45">Men's 4.0 · Club Championships</p>
            </div>
          </In>
        </div>
      </div>
    </div>
  );
}

function PathwayView() {
  const levels = [
    { ball: 'Red', color: '#ef4444', kids: [['Mia', 3], ['Leo', 2], ['Zoe', 1]] },
    { ball: 'Orange', color: '#f97316', kids: [['Ava', 4], ['Noah', 2], ['Ivy', 2]] },
    { ball: 'Green', color: '#22c55e', kids: [['Eli', 3], ['Luca', 1]] },
    { ball: 'Yellow', color: '#eab308', kids: [['Maya', 2], ['Owen', 1]] },
  ] as const;
  return (
    <div className="grid h-full grid-cols-4 gap-4">
      {levels.map((lv, li) => (
        <div key={lv.ball} className="flex flex-col">
          <In i={li}>
            <div className="mb-3 flex items-center gap-2.5 rounded-xl border px-3 py-3" style={{ borderColor: `${lv.color}55`, background: `${lv.color}14` }}>
              <span className="h-6 w-6 rounded-full" style={{ background: `radial-gradient(circle at 35% 30%, #fff8, ${lv.color} 45%)` }} />
              <span className="text-[13px] font-bold">{lv.ball} ball</span>
            </div>
          </In>
          <div className="space-y-2">
            {lv.kids.map(([name, stripes], ki) => (
              <In key={name} i={li + ki + 1}>
                <div className="rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-2.5">
                  <p className="text-[12.5px] font-medium text-white/85">{name}</p>
                  <div className="mt-1.5 flex gap-1">
                    {[0, 1, 2, 3].map((k) => (
                      <span key={k} className="h-1.5 flex-1 rounded-full" style={{ background: k < stripes ? lv.color : 'rgba(255,255,255,0.08)' }} />
                    ))}
                  </div>
                  <p className="mt-1 text-[10px] text-white/35">{stripes}/4 stripes</p>
                </div>
              </In>
            ))}
          </div>
          {li === 1 && (
            <In i={6}>
              <div className="mt-2 flex items-center gap-1.5 rounded-lg bg-[#D3FB52]/10 px-3 py-2 text-[10.5px] text-[#D3FB52]">
                <Sparkles size={11} /> Ava is ready for green
              </div>
            </In>
          )}
        </div>
      ))}
    </div>
  );
}

function StringingView() {
  const cols = [
    { h: 'Dropped off', c: '#94a3b8', jobs: [['Chris D.', 'Pure Aero · RPM Blast 52 lb'], ['Hana O.', 'Blade 98 · Hawk Touch 50 lb'], ['Marco V.', 'Speed MP · Poly Tour Pro 53 lb']] },
    { h: 'On the machine', c: '#f472b6', jobs: [['Lena F.', 'Ezone 100 · X-One Biphase 55 lb'], ['Sam R.', 'Pro Staff 97 · ALU Power 50 lb']] },
    { h: 'Ready for pickup', c: '#34d399', jobs: [['Jae K.', 'Clash 100 · NXT 56 lb'], ['Priya S.', 'Pure Drive · Syn Gut 57 lb']] },
  ];
  return (
    <div className="grid h-full grid-cols-3 gap-4">
      {cols.map((col, ci) => (
        <div key={col.h} className="rounded-xl bg-white/[0.02] p-3">
          <In i={ci}>
            <div className="mb-3 flex items-center justify-between">
              <span className="text-[12px] font-semibold" style={{ color: col.c }}>{col.h}</span>
              <span className="rounded-full bg-white/[0.06] px-2 text-[10.5px] text-white/50">{col.jobs.length}</span>
            </div>
          </In>
          <div className="space-y-2">
            {col.jobs.map(([who, what], ji) => (
              <In key={who} i={ci + ji + 1}>
                <div className="rounded-lg border border-white/[0.07] bg-[#001820] px-3 py-2.5">
                  <p className="text-[12.5px] font-medium">{who}</p>
                  <p className="mt-0.5 text-[10.5px] text-white/45">{what}</p>
                  {ci === 2 && <p className="mt-1.5 flex items-center gap-1 text-[10px] text-[#34d399]"><Check size={11} /> Texted — ready at the desk</p>}
                </div>
              </In>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function CaptainView() {
  const dates = ['Sat 9/19', 'Sat 9/26', 'Sun 10/4', 'Sat 10/10'];
  const players: [string, ('y' | 'n' | '?')[]][] = [
    ['Dana M.', ['y', 'y', 'n', 'y']],
    ['Keiko A.', ['y', '?', 'y', 'y']],
    ['Rosa P.', ['n', 'y', 'y', '?']],
    ['Beth L.', ['y', 'y', 'y', 'n']],
    ['Amara N.', ['y', 'n', '?', 'y']],
    ['Jess T.', ['?', 'y', 'y', 'y']],
    ['Nina G.', ['y', 'y', 'n', 'y']],
  ];
  const mark = (v: 'y' | 'n' | '?') =>
    v === 'y' ? <Check size={14} className="text-[#34d399]" /> : v === 'n' ? <XIcon size={14} className="text-[#f87171]" /> : <span className="text-[12px] font-bold text-white/30">?</span>;
  return (
    <div className="grid h-full grid-cols-[1.6fr_1fr] gap-4">
      <In i={0}>
        <Card className="p-4">
          <Label>Availability · 4.0 Women</Label>
          <div className="grid grid-cols-[1.3fr_repeat(4,1fr)] items-center gap-y-2 text-[11.5px]">
            <span />
            {dates.map((d) => <span key={d} className="text-center text-[10px] text-white/40">{d}</span>)}
            {players.map(([n, av]) => (
              <div key={n} className="contents">
                <span className="text-white/80">{n}</span>
                {av.map((v, k) => <span key={k} className="flex justify-center">{mark(v)}</span>)}
              </div>
            ))}
          </div>
        </Card>
      </In>
      <div className="space-y-2">
        <In i={1}><Label>Lineup · vs Lakeside, Sat 9/19</Label></In>
        {[['Line 1', 'Dana / Keiko'], ['Line 2', 'Beth / Amara'], ['Line 3', 'Nina / Jess']].map(([l, p], i) => (
          <In key={l} i={i + 2}>
            <div className="flex items-center justify-between rounded-lg border border-white/[0.06] bg-white/[0.03] px-3.5 py-2.5">
              <span className="text-[10.5px] text-white/40">{l}</span>
              <span className="text-[12px] text-white/85">{p}</span>
              {i < 2 ? <Chip color="#34d399">Confirmed</Chip> : <Later ms={2000} before={<Chip color="#94a3b8">Sent</Chip>} after={<Chip color="#34d399">Confirmed</Chip>} />}
            </div>
          </In>
        ))}
        <In i={5}>
          <p className="px-1 pt-1 text-[10.5px] text-white/35">No group text. Each player confirms from their own link.</p>
        </In>
      </div>
    </div>
  );
}

function CalendarView() {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const score = (m: number, w: number) => ((m * 7 + w * 3) % 10) / 10;
  const events = [
    ['Apr 11', 'Spring Junior Open'], ['May 16', 'Member-Guest'], ['Jul 4', 'Fourth of July Mixer'],
    ['Sep 12', 'Club Championships'], ['Dec 5', 'Holiday Social'],
  ];
  return (
    <div className="grid h-full grid-cols-[1.5fr_1fr] gap-4">
      <In i={0}>
        <Card className="p-4">
          <Label>Every weekend, scored</Label>
          <div className="grid grid-cols-6 gap-3">
            {months.map((m, mi) => (
              <div key={m}>
                <p className="mb-1 text-[10.5px] text-white/45">{m}</p>
                <div className="grid grid-cols-4 gap-1">
                  {[0, 1, 2, 3].map((w) => {
                    const s = score(mi, w);
                    return <span key={w} className="h-5 rounded-[3px]" style={{ background: `rgba(192,132,252,${0.1 + s * 0.75})` }} />;
                  })}
                </div>
              </div>
            ))}
          </div>
        </Card>
      </In>
      <div className="space-y-2">
        <In i={1}><Label>Locked for 2027</Label></In>
        {events.map(([d, e], i) => (
          <In key={e} i={i + 2}>
            <div className="flex items-center gap-3 rounded-lg border border-white/[0.06] bg-white/[0.03] px-3.5 py-2.5">
              <span className="w-12 text-[10.5px] font-semibold text-[#c084fc]">{d}</span>
              <span className="text-[12px] text-white/85">{e}</span>
            </div>
          </In>
        ))}
      </div>
    </div>
  );
}

function SwimView() {
  const fams = [['The Parks', 18], ['The Okafors', 15], ['The Riveras', 12], ['The Lindqvists', 9], ['The Mehtas', 6], ['The Coles', 3]] as const;
  return (
    <div className="grid h-full grid-cols-[1.5fr_1fr] gap-4">
      <In i={0}>
        <Card className="p-4">
          <Label>Volunteer points · goal 20</Label>
          <div className="space-y-3">
            {fams.map(([f, p], i) => (
              <div key={f}>
                <div className="mb-1 flex justify-between text-[12px]"><span className="text-white/85">{f}</span><span className="font-mono text-white/45">{p}</span></div>
                <div className="h-2 overflow-hidden rounded-full bg-white/[0.06]">
                  <div className="hm-progress h-full rounded-full bg-[#38bdf8]" style={{ width: `${(p / 20) * 100}%`, animationDuration: '900ms', animationDelay: `${i * 90}ms` }} />
                </div>
              </div>
            ))}
          </div>
        </Card>
      </In>
      <div className="space-y-2">
        <In i={1}><Label>Open jobs · Saturday meet</Label></In>
        {[['Timer, lane 3', 2], ['Snack bar', 1], ['Setup crew', 3]].map(([j, p], i) => (
          <In key={j} i={i + 2}>
            <div className="flex items-center justify-between rounded-lg border border-white/[0.06] bg-white/[0.03] px-3.5 py-2.5 text-[12px]">
              <span className="text-white/85">{j}</span><Chip color="#38bdf8">{p} pts</Chip>
            </div>
          </In>
        ))}
      </div>
    </div>
  );
}

function VaultView() {
  const rows = [
    ['Priya Shah', '4.0', '6.12', true], ['Tom Walsh', '3.5', '5.04', true], ['Keiko Arai', '4.0', '6.40', true],
    ['Wes Hart', '4.5', '7.31', false], ['Rosa Pinto', '3.5', '4.88', true], ['Jae Kim', '3.0', '4.10', true],
    ['Dev Rao', '4.5', '7.02', false], ['Nina Gold', '4.0', '5.95', true],
  ] as const;
  return (
    <In i={0}>
      <Card className="overflow-hidden">
        <div className="grid grid-cols-[2fr_1fr_1fr_1fr] border-b border-white/[0.06] px-4 py-2.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-white/35">
          <span>Name</span><span>NTRP</span><span>UTR</span><span>Account</span>
        </div>
        {rows.map(([n, r, u, m], i) => (
          <In key={n} i={i + 1}>
            <div className="grid grid-cols-[2fr_1fr_1fr_1fr] items-center border-b border-white/[0.04] px-4 py-[9px] text-[12.5px]">
              <span className="text-white/85">{n}</span>
              <span className="text-white/60">{r}</span>
              <span className="font-mono text-white/60">{u}</span>
              <span>{m ? <Chip color="#2dd4bf">Member</Chip> : <Chip color="#94a3b8">Guest</Chip>}</span>
            </div>
          </In>
        ))}
      </Card>
    </In>
  );
}

function ConnectView() {
  const posts = [
    ['Doubles, 3.5', 'Sat 9 AM · Court 4', '2 spots'], ['Hitting partner, 4.0', 'Tue 6 PM', '1 spot'],
    ['Pickleball open play', 'Sun 10 AM · Pickle A', '5 spots'], ['Singles match, 4.5', 'Wed 7 AM', '1 spot'],
    ['Cardio drop-in', 'Thu 5 PM · Court 1', 'Waitlist'], ['Mixed doubles, 3.5', 'Fri 6 PM', '2 spots'],
  ];
  return (
    <div className="grid grid-cols-3 gap-3">
      {posts.map(([t, w, s], i) => (
        <In key={t} i={i}>
          <Card className="p-4">
            <p className="text-[13px] font-semibold">{t}</p>
            <p className="mt-1 text-[11px] text-white/45">{w}</p>
            <div className="mt-3 flex items-center justify-between">
              <Chip color="#34d399">{s}</Chip>
              <span className="text-[11px] font-semibold text-[#34d399]">I&apos;m in →</span>
            </div>
          </Card>
        </In>
      ))}
    </div>
  );
}

function RecapView() {
  return (
    <div className="grid h-full grid-cols-[1.5fr_1fr] gap-4">
      <In i={0}>
        <Card className="p-5">
          <Label>Lesson recap · Maya R. · 60 min</Label>
          <p className="text-[13px] leading-relaxed text-white/80">
            Worked on getting the racquet back early on the forehand and finishing over the shoulder.
            By the end Maya was holding 8-ball crosscourt rallies. Next week: the same shape off the backhand.
          </p>
          <div className="mt-4 space-y-2">
            {['Early unit turn on the forehand', 'Finish over the shoulder', 'Crosscourt depth past the service line'].map((t, i) => (
              <In key={t} i={i + 1}>
                <p className="flex items-center gap-2 text-[12px] text-white/70"><Check size={13} className="text-[#a78bfa]" /> {t}</p>
              </In>
            ))}
          </div>
        </Card>
      </In>
      <div className="space-y-2">
        <In i={1}><Label>Drills sent home</Label></In>
        {['Shadow swings, 3 × 20', 'Wall rally to 30', 'Crosscourt targets'].map((d, i) => (
          <In key={d} i={i + 2}>
            <div className="rounded-lg border border-white/[0.06] bg-white/[0.03] px-3.5 py-2.5 text-[12px] text-white/85">{d}</div>
          </In>
        ))}
        <In i={5}>
          <div className="flex items-center gap-1.5 rounded-lg bg-[#a78bfa]/10 px-3.5 py-2.5 text-[11px] text-[#c4b5fd]"><Sparkles size={12} /> Emailed to Maya&apos;s family</div>
        </In>
      </div>
    </div>
  );
}

function BenchmarksView() {
  return (
    <div className="grid h-full grid-cols-[1.4fr_1fr] gap-4">
      <In i={0}>
        <Card className="p-5">
          <Label>Your comp score</Label>
          <p className="text-[40px] font-bold leading-none tracking-tight text-[#f59e0b]">62<span className="text-[16px] text-white/40">th percentile</span></p>
          <p className="mt-1 text-[11.5px] text-white/45">Against directors at clubs of a similar size and region</p>
          <div className="relative mt-6 h-3 rounded-full bg-gradient-to-r from-white/[0.06] via-[#f59e0b]/40 to-[#f59e0b]">
            <span className="hm-fade-up absolute -top-1.5 h-6 w-1 rounded-full bg-white" style={{ left: '62%', animationDelay: '500ms' }} />
          </div>
          <div className="mt-1.5 flex justify-between text-[10px] text-white/35"><span>25th</span><span>Median</span><span>75th</span></div>
        </Card>
      </In>
      <div className="space-y-2">
        <In i={1}><Label>Where the gap is</Label></In>
        {[['Base salary', 'At market'], ['Lesson split', 'Below market'], ['Program bonus', 'None on file']].map(([k, v], i) => (
          <In key={k} i={i + 2}>
            <div className="flex items-center justify-between rounded-lg border border-white/[0.06] bg-white/[0.03] px-3.5 py-2.5 text-[12px]">
              <span className="text-white/85">{k}</span>
              <Chip color={i === 0 ? '#34d399' : '#f59e0b'}>{v}</Chip>
            </div>
          </In>
        ))}
      </div>
    </div>
  );
}

function RecruitingView() {
  const jobs = [
    ['Director of Tennis', 'Private club · 14 courts', 'Hiring'], ['Head Pro', 'Swim & tennis · 8 courts', 'Hiring'],
    ['Junior Program Lead', 'Academy · 10 courts', 'Interviewing'], ['Pickleball Director', 'Country club · 12 courts', 'Hiring'],
  ];
  return (
    <div className="grid grid-cols-2 gap-3">
      {jobs.map(([t, w, s], i) => (
        <In key={t} i={i}>
          <Card className="p-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-[13.5px] font-semibold">{t}</p>
                <p className="mt-1 text-[11px] text-white/45">{w}</p>
              </div>
              <Chip color="#2dd4bf">{s}</Chip>
            </div>
            <p className="mt-3 text-[11px] text-white/40">Your profile stays private until you say hello.</p>
          </Card>
        </In>
      ))}
    </div>
  );
}

function GenericView({ tool }: { tool: Tool }) {
  return (
    <div className="space-y-2">
      <In i={0}><p className="max-w-xl text-[13px] text-white/60">{tool.description}</p></In>
      {[0, 1, 2, 3, 4].map((k) => (
        <In key={k} i={k + 1}>
          <div className="h-10 rounded-lg border border-white/[0.06] bg-white/[0.03]" />
        </In>
      ))}
    </div>
  );
}

type View = { path?: string; title: string; sub: string; action: string; prompt: string; Body: () => ReactNode };

const VIEWS: Record<string, View> = {
  CourtSheet: { title: 'Today · Thursday', sub: '11 courts · 38 bookings', action: 'New booking', prompt: 'Book court 8 for a 5pm clinic and text the waitlist', Body: CourtSheetView },
  CalendarMode: { title: '2027 season plan', sub: '52 weekends scored', action: 'Lock season', prompt: 'Find a free May weekend for the member-guest', Body: CalendarView },
  MixerMode: { title: 'Thursday Night Social', sub: 'Round 3 of 4 · 16 players', action: 'Next round', prompt: 'Split into winners and consolation after round 4', Body: MixerView },
  LeagueMode: { title: 'Riverbend vs Northside', sub: 'JTT 12U · two sites · live', action: 'Share scorecard', prompt: 'Text both coaches the final score when doubles 2 ends', Body: LeagueView },
  TournamentMode: { title: 'Club Championships', sub: "Men's 4.0 · single elimination", action: 'Publish draw', prompt: 'Add a consolation draw for first-round losers', Body: TournamentView },
  CaptainMode: { title: '4.0 Women', sub: 'Next: vs Lakeside · Sat 9/19', action: 'Send lineup', prompt: 'Who is free on 10/4 and hasn’t played in two weeks?', Body: CaptainView },
  SwimMode: { title: 'Summer swim team', sub: '42 families · 3 meets left', action: 'Add job', prompt: 'Remind families under 10 points about Saturday', Body: SwimView },
  PlayerVault: { title: 'People', sub: '412 players · 288 members', action: 'Import', prompt: 'Look up UTRs for everyone missing one', Body: VaultView },
  CourtConnect: { title: 'Open games', sub: '6 looking for players', action: 'Post a game', prompt: 'Find a 3.5 fourth for Saturday morning doubles', Body: ConnectView },
  LessonMode: { title: 'Open Lesson Time', sub: 'Today · 3 instructors', action: 'Blast a cancellation', prompt: 'Ben’s 5pm cancelled — offer it to his regulars', Body: LessonView },
  CoachMode: { title: 'Lesson recaps', sub: '9 sent this week', action: 'New recap', prompt: 'Write Maya’s recap from my voice note', Body: RecapView },
  PathwayMode: { title: 'Junior Pathway', sub: '10 kids climbing', action: 'Award stripe', prompt: 'Who is one stripe away from moving up?', Body: PathwayView },
  StringingMode: { title: 'Stringing queue', sub: '7 racquets · 2 ready', action: 'New job', prompt: 'What did Chris string last time, and at what tension?', Body: StringingView },
  Benchmarks: { title: 'Comp Score', sub: 'Built from real 990 filings', action: 'Build my case', prompt: 'What should I ask for in my review?', Body: BenchmarksView },
  Recruiting: { title: 'Clubs hiring', sub: '4 matches for your profile', action: 'Update profile', prompt: 'Show clubs within an hour of me', Body: RecruitingView },
};

/* -------------------------------------------------------------------- shell */

export default function AppShellDemo() {
  const [active, setActive] = useState<string>(TOUR[0] ?? ALL_TOOLS[0].name);
  const [hover, setHover] = useState(false);
  const [hold, setHold] = useState(false);
  const [inView, setInView] = useState(false);
  const [reduce, setReduce] = useState(false);
  const [scale, setScale] = useState(1);
  const outerRef = useRef<HTMLDivElement>(null);
  const tiltRef = useRef<HTMLDivElement>(null);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const running = inView && !hover && !hold && !reduce;

  useEffect(() => {
    setReduce(window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }, []);

  // Only tour while someone can see it.
  useEffect(() => {
    const el = outerRef.current;
    if (!el || !('IntersectionObserver' in window)) return;
    const io = new IntersectionObserver(([e]) => setInView(e.isIntersecting), { threshold: 0.2 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // Fit the fixed-size "screenshot" to its container.
  useEffect(() => {
    const el = outerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setScale(Math.min(1, e.contentRect.width / W)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Tilted back on arrival, settles flat as you scroll to it.
  useEffect(() => {
    const el = tiltRef.current;
    if (!el) return;
    if (reduce) {
      el.style.transform = '';
      return;
    }
    let raf = 0;
    const update = () => {
      raf = 0;
      const r = el.getBoundingClientRect();
      const vh = window.innerHeight;
      const p = Math.min(1, Math.max(0, (r.top - vh * 0.1) / (vh * 0.7)));
      el.style.transform = `perspective(1800px) rotateX(${(p * 14).toFixed(2)}deg) scale(${(1 - p * 0.05).toFixed(3)})`;
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, [reduce]);

  // The tour.
  useEffect(() => {
    if (!running || TOUR.length === 0) return;
    const t = setTimeout(() => {
      setActive((cur) => TOUR[(TOUR.indexOf(cur) + 1) % TOUR.length]);
    }, STEP_MS);
    return () => clearTimeout(t);
  }, [running, active]);

  useEffect(() => () => {
    if (holdTimer.current) clearTimeout(holdTimer.current);
  }, []);

  const pick = (name: string) => {
    setActive(name);
    setHold(true);
    if (holdTimer.current) clearTimeout(holdTimer.current);
    holdTimer.current = setTimeout(() => setHold(false), HOLD_MS);
  };

  const tool = ALL_TOOLS.find((t) => t.name === active) ?? ALL_TOOLS[0];
  const group = GROUPS.find((g) => g.tools.includes(tool));
  const view = VIEWS[tool.name];
  const ToolIcon = tool.icon;
  const path = view?.path ?? tool.href;

  return (
    // aspect-ratio gives the box its final height on first paint (no jump on
    // phones while the scale is measured); max-width centres it on wide screens.
    <div ref={outerRef} className="mx-auto w-full" style={{ maxWidth: W, aspectRatio: `${W} / ${H}` }}>
      <div ref={tiltRef} className="origin-top will-change-transform" style={{ transformStyle: 'preserve-3d' }}>
        <div
          style={{ width: W, height: H, transform: `scale(${scale})`, transformOrigin: 'top left', fontFamily: "'Inter', system-ui, sans-serif" }}
          onPointerEnter={(e) => e.pointerType === 'mouse' && setHover(true)}
          onPointerLeave={(e) => e.pointerType === 'mouse' && setHover(false)}
          className="relative flex flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#001016] text-white shadow-2xl shadow-black/60"
        >
          {/* window chrome */}
          <div className="flex h-9 shrink-0 items-center gap-2 border-b border-white/[0.06] bg-[#0a1822] px-4">
            <div className="flex gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-red-400/70" />
              <span className="h-2.5 w-2.5 rounded-full bg-yellow-400/70" />
              <span className="h-2.5 w-2.5 rounded-full bg-green-400/70" />
            </div>
            <div className="flex flex-1 justify-center">
              <span className="rounded-md bg-white/5 px-3 py-[3px] text-[11px] text-white/40">{SHOWN_HOST}{path}</span>
            </div>
            <span className="flex items-center gap-1 text-[10px] font-semibold text-[#D3FB52]">
              <Radio size={11} /> LIVE
            </span>
          </div>

          <div className="flex min-h-0 flex-1">
            {/* rail — every product, from src/config/nav.ts */}
            <aside className="flex w-[232px] shrink-0 flex-col border-r border-white/[0.07] bg-[#001016]">
              <div className="flex h-11 shrink-0 items-center gap-2 border-b border-white/[0.07] px-3.5">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#D3FB52]">
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="#002838" aria-hidden><path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" /></svg>
                </span>
                <span className="text-[14px] font-bold tracking-tight">ClubMode<span className="text-[#D3FB52]"> AI</span></span>
              </div>
              <nav className="flex-1 overflow-hidden px-2 pb-2">
                {GROUPS.map((g) => (
                  <div key={g.label}>
                    <p className="px-2 pb-1 pt-2.5 text-[9.5px] font-semibold uppercase tracking-[0.14em] text-white/30">{g.label}</p>
                    {g.tools.map((t) => {
                      const on = t.name === tool.name;
                      const Icon = t.icon;
                      return (
                        <button
                          key={t.name}
                          type="button"
                          onClick={() => pick(t.name)}
                          className={`relative flex h-[26px] w-full items-center gap-2 overflow-hidden rounded-md px-2 text-left transition-colors ${on ? 'bg-white/[0.07]' : 'hover:bg-white/[0.04]'}`}
                        >
                          {on && <span className="absolute bottom-1 left-0 top-1 w-[3px] rounded-full bg-[#D3FB52]" />}
                          <Icon size={14} style={{ color: on ? t.color : undefined }} className={on ? 'shrink-0' : 'shrink-0 text-white/40'} />
                          <span className={`truncate text-[12.5px] ${on ? 'font-semibold text-white' : 'text-white/60'}`}>{t.name}</span>
                          {on && running && (
                            <span
                              key={`${t.name}-bar`}
                              className="hm-progress absolute bottom-0 left-2 right-2 h-[2px] rounded-full"
                              style={{ background: t.color, animationDuration: `${STEP_MS}ms` }}
                            />
                          )}
                        </button>
                      );
                    })}
                  </div>
                ))}
              </nav>
            </aside>

            {/* main */}
            <div className="flex min-w-0 flex-1 flex-col bg-gradient-to-br from-[#001a24] to-[#001016]">
              <div className="flex h-[52px] shrink-0 items-center justify-between border-b border-white/[0.06] px-5">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg" style={{ background: `${tool.color}22` }}>
                    <ToolIcon size={16} style={{ color: tool.color }} />
                  </span>
                  <div className="min-w-0">
                    <p className="text-[10.5px] text-white/40">
                      {group?.label} <span className="text-white/20">/</span> {tool.name}
                    </p>
                    <p className="truncate text-[14px] font-semibold leading-tight">
                      {view?.title ?? tool.name}
                      {view && <span className="ml-2 text-[11.5px] font-normal text-white/40">{view.sub}</span>}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[11px] text-white/35">
                    <Search size={12} /> Search <span className="rounded bg-white/10 px-1 text-[9.5px]">⌘K</span>
                  </span>
                  <span className="flex items-center gap-1 rounded-lg border border-white/10 px-2.5 py-1.5 text-[11px] text-white/60">
                    Riverbend <ChevronDown size={12} />
                  </span>
                  <span className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11.5px] font-semibold text-[#002838]" style={{ background: tool.color }}>
                    <Plus size={13} /> {view?.action ?? 'Open'}
                  </span>
                </div>
              </div>

              <div key={tool.name} className="min-h-0 flex-1 overflow-hidden p-5">
                {view ? <view.Body /> : <GenericView tool={tool} />}
              </div>

              {/* the AI bar, typing a command that fits the tool on screen */}
              <div className="shrink-0 px-5 pb-4">
                <div className="flex items-center gap-2.5 rounded-xl border border-white/10 bg-white/[0.05] px-3.5 py-2.5">
                  <Sparkles size={15} className="shrink-0 text-[#D3FB52]" />
                  <span className="min-w-0 flex-1 truncate text-[12.5px]">
                    <TypedPrompt key={tool.name} text={view?.prompt ?? `Ask anything about ${tool.name}`} animate={!reduce} />
                  </span>
                  <span className="rounded-md bg-[#D3FB52] px-2 py-0.5 text-[10.5px] font-bold text-[#002838]">Ask ClubMode</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
