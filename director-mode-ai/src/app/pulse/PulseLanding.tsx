'use client';

/**
 * The /pulse landing page body. Every number arrives in `stats`, computed on
 * the server from public IRS 990 rows (see page.tsx); this file only shows
 * them. The locked cards are labels with blurred placeholder bars, never
 * figures: Pulse answers are only shown to people who have shared theirs.
 */
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  BadgeDollarSign,
  EyeOff,
  LayoutGrid,
  Lock,
  MapPin,
  ShieldCheck,
  Sigma,
  Zap,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import OtherToolsLine from '@/components/mixer/OtherToolsLine';
import { logLanding } from '@/lib/landing';

const PULSE_HREF = '/benchmarks/pulse';
const LIME = '#D3FB52';

export type LandingStats = {
  n: number;
  clubs: number;
  states: number;
  yearFrom: number;
  yearTo: number;
  median: number;
  p25: number;
  p75: number;
  p90: number;
  over300: number;
  over400: number;
  bins: { label: string; count: number }[];
  regions: { name: string; n: number; median: number }[];
};

const usd = (n: number) => `$${Math.round(n / 1000).toLocaleString()}K`;

/** True once the element has scrolled into view (and stays true). */
function useInView<T extends Element>(threshold = 0.3) {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return;
    if (typeof IntersectionObserver === 'undefined') return setSeen(true);
    const io = new IntersectionObserver(([e]) => e.isIntersecting && setSeen(true), { threshold });
    io.observe(el);
    return () => io.disconnect();
  }, [seen, threshold]);
  return [ref, seen] as const;
}

/**
 * Counts up to `to` once `run` flips true. Respects reduced motion. Renders
 * the real figure until then, so the server HTML (and link previews) never
 * shows $0K.
 */
function CountUp({ to, run, format = (n: number) => Math.round(n).toLocaleString() }: { to: number; run: boolean; format?: (n: number) => string }) {
  const [v, setV] = useState(to);
  useEffect(() => {
    if (!run) return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return setV(to);
    const start = performance.now();
    const dur = 1400;
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / dur);
      setV(to * (1 - Math.pow(1 - p, 4)));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [run, to]);
  return <>{format(v)}</>;
}

export default function PulseLanding({ stats }: { stats: LandingStats }) {
  const [user, setUser] = useState<{ email?: string } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    logLanding('pulse', 'view');
  }, []);

  useEffect(() => {
    createClient()
      .auth.getUser()
      .then(({ data: { user } }) => setUser(user))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  const cta = () => logLanding('pulse', 'cta');
  const source = `IRS Form 990 filings · ${stats.n} racquets pros · ${stats.clubs} clubs · ${stats.states} states · ${stats.yearFrom}–${stats.yearTo}`;

  return (
    <div className="min-h-screen bg-[#00141b] text-white antialiased overflow-x-hidden" style={{ fontFamily: "'Inter', system-ui, sans-serif" }}>
      <style>{`
        @keyframes pl-marquee { from { transform: translateX(0) } to { transform: translateX(-50%) } }
        @keyframes pl-ping { 0% { transform: scale(1); opacity: .7 } 100% { transform: scale(2.4); opacity: 0 } }
        @keyframes pl-float { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-6px) } }
        .pl-marquee { animation: pl-marquee 38s linear infinite; }
        .pl-ping { animation: pl-ping 1.8s cubic-bezier(0,0,.2,1) infinite; }
        .pl-float { animation: pl-float 5s ease-in-out infinite; }
        .pl-grid { background-image: linear-gradient(rgba(255,255,255,.035) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.035) 1px, transparent 1px); background-size: 56px 56px; }
        @media (prefers-reduced-motion: reduce) { .pl-marquee, .pl-ping, .pl-float { animation: none } }
      `}</style>

      {/* ===================== HEADER ===================== */}
      <header className="absolute top-0 inset-x-0 z-20">
        <div className="max-w-6xl mx-auto px-5 sm:px-8 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5">
            <span className="w-8 h-8 bg-[#D3FB52] rounded-lg flex items-center justify-center">
              <Zap className="text-[#002838]" size={16} />
            </span>
            <span className="font-semibold tracking-tight">
              ClubMode<span className="text-[#D3FB52]"> AI</span>
            </span>
          </Link>
          <div className="flex items-center gap-1.5 sm:gap-3 text-sm">
            {loading ? (
              <span className="w-16 h-5 rounded bg-white/10 animate-pulse" />
            ) : user ? (
              <Link href="/tools" className="inline-flex items-center gap-1.5 px-3 py-2 text-white/75 hover:text-white">
                <LayoutGrid size={15} /> Your tools
              </Link>
            ) : (
              <Link href="/login" className="px-3 py-2 text-white/75 hover:text-white">Sign in</Link>
            )}
            <Link
              href={PULSE_HREF}
              onClick={cta}
              className="hidden sm:inline-flex px-4 py-2 rounded-full bg-white text-[#001820] font-medium hover:bg-white/90 transition-colors"
            >
              Get my number
            </Link>
          </div>
        </div>
      </header>

      <main>
        <Hero stats={stats} onCta={cta} />
        <Ticker stats={stats} />
        <Spread stats={stats} source={source} />
        <Regions stats={stats} />
        <Locked onCta={cta} />
        <Privacy />
        <Closer stats={stats} onCta={cta} />
      </main>

      {/* ===================== FOOTER ===================== */}
      <footer className="px-5 sm:px-8 py-10 border-t border-white/[0.06]">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-white/40">
          <span>&copy; {new Date().getFullYear()} ClubMode AI</span>
          <nav className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
            <a href="mailto:hello@clubmode.ai" className="hover:text-white/70">hello@clubmode.ai</a>
            <Link href="/terms" className="hover:text-white/70">Terms</Link>
            <Link href="/privacy" className="hover:text-white/70">Privacy</Link>
            <Link href={user ? '/tools' : '/login'} className="hover:text-white/70">{user ? 'Your tools' : 'Sign in'}</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}

function CtaButton({ onCta, children, className = '' }: { onCta: () => void; children: React.ReactNode; className?: string }) {
  return (
    <Link
      href={PULSE_HREF}
      onClick={onCta}
      className={`group relative inline-flex items-center justify-center gap-2 w-full sm:w-auto px-8 h-14 rounded-full bg-[#D3FB52] text-[#002838] font-semibold text-base shadow-[0_0_40px_-6px_rgba(211,251,82,0.55)] hover:shadow-[0_0_60px_-4px_rgba(211,251,82,0.75)] hover:bg-[#c5f035] transition-all ${className}`}
    >
      {children}
      <ArrowRight size={18} className="transition-transform group-hover:translate-x-1" />
    </Link>
  );
}

/* ============================== HERO ============================== */

function Hero({ stats, onCta }: { stats: LandingStats; onCta: () => void }) {
  const [ref, seen] = useInView<HTMLDivElement>(0.2);
  return (
    <section className="relative px-5 sm:px-8 pt-32 sm:pt-40 pb-16 sm:pb-24">
      <div aria-hidden className="absolute inset-0 pointer-events-none">
        <div className="absolute inset-0 pl-grid [mask-image:radial-gradient(ellipse_at_top,black_30%,transparent_75%)]" />
        <div className="absolute -top-48 left-1/2 -translate-x-1/2 w-[60rem] h-[36rem] bg-[#D3FB52]/[0.09] rounded-full blur-[140px]" />
        <div className="absolute top-80 -right-40 w-[30rem] h-[30rem] bg-cyan-400/[0.06] rounded-full blur-[120px]" />
      </div>

      <div className="relative max-w-6xl mx-auto grid gap-14 lg:grid-cols-[1.05fr_1fr] lg:gap-12 items-center">
        <div className="text-center lg:text-left">
          <p className="hm-fade-up inline-flex items-center gap-2 rounded-full border border-[#D3FB52]/30 bg-[#D3FB52]/[0.07] px-3.5 py-1.5 text-xs sm:text-sm font-medium text-[#D3FB52]">
            <span className="relative flex h-2 w-2">
              <span className="pl-ping absolute inline-flex h-full w-full rounded-full bg-[#D3FB52]" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-[#D3FB52]" />
            </span>
            Director Pulse · pay data for tennis pros
          </p>
          <h1
            className="hm-fade-up mt-6 text-[3.4rem] leading-[0.98] sm:text-7xl lg:text-[5.6rem] font-bold tracking-[-0.045em]"
            style={{ animationDelay: '0.05s' }}
          >
            Know your
            <br />
            <span className="bg-gradient-to-r from-[#D3FB52] via-[#e9ff9c] to-[#7ef0c8] bg-clip-text text-transparent">number.</span>
          </h1>
          <p
            className="hm-fade-up mt-7 text-lg sm:text-xl text-white/65 leading-relaxed max-w-xl mx-auto lg:mx-0"
            style={{ animationDelay: '0.1s' }}
          >
            We pulled the pay of <span className="text-white font-semibold">{stats.n} racquets pros</span> off
            public IRS filings. Add yours, anonymously, and see exactly where you land, including the
            stuff the IRS never shows: private rates, your split, clinic pay.
          </p>
          <div className="hm-fade-up mt-10 flex flex-col sm:flex-row items-center lg:items-start gap-4 sm:gap-5" style={{ animationDelay: '0.15s' }}>
            <CtaButton onCta={onCta}>See where I stand</CtaButton>
            <p className="text-sm text-white/45 sm:pt-4">No account. No name. No club.</p>
          </div>
        </div>

        {/* The headline card: real 990 median, animated. */}
        <div ref={ref} className="hm-fade-up relative" style={{ animationDelay: '0.22s' }}>
          <div className="pl-float relative rounded-[28px] border border-white/10 bg-gradient-to-b from-[#06303f]/90 to-[#021c25]/90 p-6 sm:p-8 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.7)] backdrop-blur">
            <div className="flex items-center justify-between text-xs text-white/50">
              <span className="uppercase tracking-[0.18em]">Median racquets pro · total pay</span>
              <span className="inline-flex items-center gap-1"><ShieldCheck size={13} className="text-[#D3FB52]" /> IRS 990</span>
            </div>
            <p className="mt-4 text-6xl sm:text-7xl font-bold tracking-[-0.04em] tabular-nums text-[#D3FB52]">
              <CountUp to={stats.median} run={seen} format={(n) => `$${Math.round(n / 1000)}K`} />
            </p>
            <div className="mt-6 grid grid-cols-3 gap-3">
              <MiniStat label="Middle half" value={`${usd(stats.p25)}–${usd(stats.p75)}`} />
              <MiniStat label="Top 10%" value={`${usd(stats.p90)}+`} />
              <MiniStat label="Over $300K" value={`${stats.over300} pros`} />
            </div>
            <div className="mt-6 rounded-2xl border border-dashed border-[#D3FB52]/40 bg-[#D3FB52]/[0.05] px-4 py-3.5 flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold">And you?</p>
                <p className="text-xs text-white/50">Your rank unlocks when you share.</p>
              </div>
              <span className="relative flex h-10 w-10 items-center justify-center rounded-full bg-[#D3FB52] text-[#002838] font-bold text-lg">
                <span className="pl-ping absolute inset-0 rounded-full bg-[#D3FB52]/60" />
                <span className="relative">?</span>
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-white/[0.04] border border-white/[0.06] px-3 py-2.5">
      <p className="text-[10px] sm:text-[11px] uppercase tracking-wider text-white/40">{label}</p>
      <p className="mt-1 text-sm sm:text-base font-semibold tabular-nums">{value}</p>
    </div>
  );
}

/* ============================= TICKER ============================= */

function Ticker({ stats }: { stats: LandingStats }) {
  const top = [...stats.regions].sort((a, b) => b.median - a.median)[0];
  const items = [
    `Median racquets pro: ${usd(stats.median)}`,
    `Top 10% clear ${usd(stats.p90)}`,
    `${stats.over300} pros over $300K`,
    `${stats.over400} pros over $400K`,
    top ? `${top.name} median: ${usd(top.median)}` : null,
    `${stats.clubs} clubs · ${stats.states} states`,
    'Private rates · splits · clinic pay: Pulse only',
  ].filter(Boolean) as string[];
  const row = [...items, ...items];
  return (
    <div className="relative border-y border-white/[0.07] bg-[#D3FB52] text-[#002838] overflow-hidden py-3.5" aria-label={items.join('. ')}>
      <div className="pl-marquee flex w-max gap-10 whitespace-nowrap font-semibold text-sm sm:text-base" aria-hidden>
        {row.map((t, i) => (
          <span key={i} className="inline-flex items-center gap-10">
            {t}
            <span className="h-1.5 w-1.5 rounded-full bg-[#002838]/40" />
          </span>
        ))}
      </div>
    </div>
  );
}

/* ============================= SPREAD ============================= */

function Spread({ stats, source }: { stats: LandingStats; source: string }) {
  const [ref, seen] = useInView<HTMLDivElement>(0.3);
  const max = Math.max(...stats.bins.map((b) => b.count));
  return (
    <section className="px-5 sm:px-8 py-20 sm:py-28">
      <div className="max-w-6xl mx-auto grid gap-12 lg:grid-cols-[0.9fr_1.1fr] lg:gap-16 items-center">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#D3FB52]">The spread</p>
          <h2 className="mt-4 text-4xl sm:text-5xl font-bold tracking-[-0.03em] leading-[1.05]">
            Same job title.
            <br />
            <span className="text-white/45">Wildly different paychecks.</span>
          </h2>
          <p className="mt-6 text-lg text-white/60 leading-relaxed">
            The middle half of racquets pros on the 990 earn {usd(stats.p25)} to {usd(stats.p75)}.
            The top tenth clear {usd(stats.p90)}. That gap is real money, and most pros have no idea
            which side of it they&rsquo;re on.
          </p>
        </div>

        <div ref={ref} className="rounded-3xl border border-white/10 bg-[#021f29]/80 p-5 sm:p-8">
          <div className="flex items-end gap-2 sm:gap-3 h-64">
            {stats.bins.map((b, i) => {
              const h = (b.count / max) * 100;
              const hot = i >= 4;
              return (
                <div key={b.label} className="flex-1 flex flex-col items-center justify-end h-full">
                  <span
                    className="text-xs sm:text-sm font-semibold tabular-nums mb-2 transition-opacity duration-700"
                    style={{ opacity: seen ? 1 : 0, transitionDelay: `${300 + i * 90}ms` }}
                  >
                    {b.count}
                  </span>
                  <div
                    className="w-full rounded-t-lg transition-[height] duration-1000 ease-[cubic-bezier(0.16,1,0.3,1)]"
                    style={{
                      height: seen ? `${h}%` : '0%',
                      transitionDelay: `${i * 90}ms`,
                      background: hot
                        ? `linear-gradient(to top, ${LIME}, #efffb8)`
                        : 'linear-gradient(to top, rgba(211,251,82,0.18), rgba(211,251,82,0.38))',
                    }}
                  />
                </div>
              );
            })}
          </div>
          <div className="mt-3 flex gap-2 sm:gap-3">
            {stats.bins.map((b) => (
              <span key={b.label} className="flex-1 text-center text-[10px] sm:text-xs text-white/50 leading-tight">
                {b.label}
              </span>
            ))}
          </div>
          <p className="mt-6 text-[11px] text-white/35 leading-relaxed">
            {source}. Total reported pay. Clubs list only their top earners, so this leans toward
            directors at bigger clubs.
          </p>
        </div>
      </div>
    </section>
  );
}

/* ============================= REGIONS ============================ */

function Regions({ stats }: { stats: LandingStats }) {
  const [ref, seen] = useInView<HTMLDivElement>(0.3);
  if (!stats.regions.length) return null;
  const max = Math.max(...stats.regions.map((r) => r.median));
  return (
    <section className="px-5 sm:px-8 py-20 sm:py-28 border-t border-white/[0.06]">
      <div className="max-w-6xl mx-auto">
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
          <h2 className="text-4xl sm:text-5xl font-bold tracking-[-0.03em] leading-[1.05]">
            Where you teach
            <br />
            <span className="text-white/45">changes the math.</span>
          </h2>
          <p className="text-white/50 max-w-sm">Median total pay by region, from the same filings.</p>
        </div>
        <div ref={ref} className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {stats.regions.map((r, i) => (
            <div
              key={r.name}
              className="group relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.05] to-transparent p-6 hover:border-[#D3FB52]/40 transition-colors"
            >
              <div className="flex items-center gap-2 text-sm text-white/55">
                <MapPin size={14} className="text-[#D3FB52]" /> {r.name}
              </div>
              <p className="mt-4 text-4xl font-bold tracking-tight tabular-nums">
                <CountUp to={r.median} run={seen} format={(n) => `$${Math.round(n / 1000)}K`} />
              </p>
              <div className="mt-5 h-1.5 rounded-full bg-white/[0.07] overflow-hidden">
                <div
                  className="h-full rounded-full bg-[#D3FB52] transition-[width] duration-1000 ease-out"
                  style={{ width: seen ? `${(r.median / max) * 100}%` : '0%', transitionDelay: `${i * 120}ms` }}
                />
              </div>
              <p className="mt-3 text-xs text-white/40">{r.n} pros</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ============================= LOCKED ============================= */

function Locked({ onCta }: { onCta: () => void }) {
  const cards = [
    { title: 'Private lesson rate', sub: 'What pros charge for 60 minutes' },
    { title: 'The split you keep', sub: 'Your share of every private' },
    { title: 'Clinic pay', sub: 'Percent, hourly, or baked into salary' },
    { title: 'Junior pricing', sub: 'Per player, per hour' },
    { title: 'Salary vs. bonus', sub: 'How the package is built' },
    { title: 'Benefits', sub: 'Health, retirement match, stringing' },
  ];
  return (
    <section className="relative px-5 sm:px-8 py-20 sm:py-28 border-t border-white/[0.06] overflow-hidden">
      <div aria-hidden className="absolute -bottom-40 left-1/2 -translate-x-1/2 w-[50rem] h-[24rem] bg-[#D3FB52]/[0.06] rounded-full blur-[120px]" />
      <div className="relative max-w-6xl mx-auto">
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#D3FB52]">What the 990 can&rsquo;t see</p>
        <h2 className="mt-4 text-4xl sm:text-5xl font-bold tracking-[-0.03em] leading-[1.05] max-w-3xl">
          The IRS stops at salary.
          <br />
          <span className="text-white/45">Pulse is the rest of the deal.</span>
        </h2>
        <p className="mt-6 text-lg text-white/60 max-w-2xl leading-relaxed">
          The stuff pros actually ask each other about at tournaments. It comes from pros, for pros,
          and you only see it once you&rsquo;ve added yours.
        </p>

        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {cards.map((c, i) => (
            <div key={c.title} className="relative rounded-2xl border border-white/10 bg-[#021f29]/80 p-6 overflow-hidden">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-semibold">{c.title}</p>
                  <p className="mt-1 text-sm text-white/45">{c.sub}</p>
                </div>
                <span className="shrink-0 inline-flex h-8 w-8 items-center justify-center rounded-full bg-white/[0.06] border border-white/10">
                  <Lock size={14} className="text-[#D3FB52]" />
                </span>
              </div>
              <div className="mt-6 space-y-2.5 select-none" aria-hidden>
                <div className="h-7 rounded-md bg-gradient-to-r from-[#D3FB52]/40 to-[#D3FB52]/10 blur-[6px]" style={{ width: `${55 + ((i * 17) % 35)}%` }} />
                <div className="h-2 rounded-full bg-white/10 blur-[2px]" style={{ width: `${70 + ((i * 11) % 25)}%` }} />
              </div>
            </div>
          ))}
        </div>

        <div className="mt-12 flex justify-center">
          <CtaButton onCta={onCta}>Unlock it with my numbers</CtaButton>
        </div>
      </div>
    </section>
  );
}

/* ============================= PRIVACY ============================ */

function Privacy() {
  const items = [
    { icon: EyeOff, title: 'No name. No club.', body: 'Neither is ever asked for or stored. There is nothing to tie a row back to you.' },
    { icon: Sigma, title: 'Rounded, not raw', body: 'You see medians and ranges, rounded. Never anyone’s row, and nothing ties a number to a person.' },
    { icon: BadgeDollarSign, title: 'Free. Nothing to buy.', body: 'Your email only gets you a private link back to your results. Nobody else ever sees it.' },
  ];
  return (
    <section className="px-5 sm:px-8 py-20 sm:py-28 border-t border-white/[0.06]">
      <div className="max-w-6xl mx-auto">
        <h2 className="text-4xl sm:text-5xl font-bold tracking-[-0.03em] leading-[1.05] max-w-2xl">
          Your boss will never
          <br />
          <span className="text-white/45">see your answers.</span>
        </h2>
        <div className="mt-12 grid gap-4 md:grid-cols-3">
          {items.map(({ icon: Icon, title, body }) => (
            <div key={title} className="rounded-2xl border border-white/10 p-6 bg-white/[0.02]">
              <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-[#D3FB52]/10 border border-[#D3FB52]/25">
                <Icon size={20} className="text-[#D3FB52]" />
              </span>
              <p className="mt-5 text-lg font-semibold">{title}</p>
              <p className="mt-2 text-white/55 leading-relaxed">{body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ============================== CLOSER ============================ */

function Closer({ stats, onCta }: { stats: LandingStats; onCta: () => void }) {
  return (
    <section className="relative px-5 sm:px-8 py-24 sm:py-36 border-t border-white/[0.06] overflow-hidden">
      <div aria-hidden className="absolute inset-0 pointer-events-none">
        <div className="absolute inset-0 pl-grid [mask-image:radial-gradient(ellipse_at_center,black_20%,transparent_70%)]" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[44rem] h-[26rem] bg-[#D3FB52]/[0.1] rounded-full blur-[130px]" />
      </div>
      <div className="relative max-w-3xl mx-auto text-center">
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#D3FB52]">Contract up soon?</p>
        <h2 className="mt-5 text-5xl sm:text-7xl font-bold tracking-[-0.045em] leading-[0.98]">
          Stop guessing.
          <br />
          <span className="text-white/45">Walk in with numbers.</span>
        </h2>
        <p className="mt-7 text-lg text-white/60 max-w-xl mx-auto">
          {stats.n} pros&rsquo; pay is already on the board from public filings. A few minutes of yours
          and you&rsquo;ll know where you stand before your next review.
        </p>
        <div className="mt-10 flex flex-col items-center gap-3">
          <CtaButton onCta={onCta}>Get my number</CtaButton>
          <p className="text-sm text-white/40">Anonymous · No account · Free</p>
        </div>
        <OtherToolsLine className="mt-14" product="Director Pulse" />
      </div>
    </section>
  );
}
