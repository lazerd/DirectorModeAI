'use client';

/**
 * /pulse — the Director Pulse campaign landing page, the other half of the
 * 10/16/26 split test with /mixermode. Outreach letter P links here.
 *
 * Sells one thing: share your numbers anonymously at /benchmarks/pulse and
 * see where you stand. Keep it honest: the pool is small and self-reported,
 * so the preview shows what you'll see (labels), never invented figures, and
 * there are no testimonials, logos or contributor counts here.
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, LayoutGrid, Lock, Zap } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import OtherToolsLine from '@/components/mixer/OtherToolsLine';
import { logLanding } from '@/lib/landing';

const PULSE_HREF = '/benchmarks/pulse';

export default function PulseLandingPage() {
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

  return (
    <div className="min-h-screen bg-[#001820] text-white antialiased" style={{ fontFamily: "'Inter', system-ui, sans-serif" }}>
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
              Open Director Pulse
            </Link>
          </div>
        </div>
      </header>

      <main>
        {/* ===================== HERO ===================== */}
        <section className="relative px-5 sm:px-8 pt-36 sm:pt-44 pb-20 sm:pb-28 overflow-hidden">
          <div aria-hidden className="absolute inset-0 pointer-events-none">
            <div className="absolute -top-40 left-1/2 -translate-x-1/2 w-[46rem] h-[30rem] bg-[#D3FB52]/[0.07] rounded-full blur-[120px]" />
          </div>

          <div className="relative max-w-3xl mx-auto text-center">
            <p className="hm-fade-up text-sm sm:text-base font-medium text-[#D3FB52]">Meet Director Pulse by ClubMode</p>
            <h1
              className="hm-fade-up mt-5 text-[3.1rem] leading-[1.02] sm:text-7xl lg:text-[5.25rem] font-semibold tracking-[-0.035em]"
              style={{ animationDelay: '0.05s' }}
            >
              What they make.
              <br />
              <span className="text-white/45">What they charge.</span>
            </h1>
            <p
              className="hm-fade-up mt-7 text-lg sm:text-xl text-white/65 leading-relaxed max-w-xl mx-auto"
              style={{ animationDelay: '0.1s' }}
            >
              Every director wonders what other pros earn and what they charge for a private.
              Share your numbers anonymously and see how they stack up: pay, private rates,
              what pros keep, and clinic and junior pricing.
            </p>
            <div className="hm-fade-up mt-10 flex flex-col items-center gap-3" style={{ animationDelay: '0.15s' }}>
              <Link
                href={PULSE_HREF}
                onClick={cta}
                className="inline-flex items-center justify-center gap-2 w-full sm:w-auto px-8 h-14 rounded-full bg-[#D3FB52] text-[#002838] font-semibold text-base hover:bg-[#c5f035] transition-colors"
              >
                See how you compare <ArrowRight size={18} />
              </Link>
              <p className="text-sm text-white/45">Anonymous. No account, no name, no club.</p>
            </div>
          </div>

          <div className="hm-fade-up relative max-w-2xl mx-auto mt-16 sm:mt-20" style={{ animationDelay: '0.22s' }}>
            <ResultsPreview />
          </div>
        </section>

        {/* ===================== HOW IT WORKS ===================== */}
        <section className="px-5 sm:px-8 py-20 sm:py-28 border-t border-white/[0.06]">
          <div className="max-w-5xl mx-auto">
            <h2 className="text-3xl sm:text-4xl font-semibold tracking-tight max-w-xl">
              Give your numbers. Get everyone else&rsquo;s.
            </h2>
            <ol className="mt-14 grid gap-10 sm:gap-8 sm:grid-cols-3">
              <Step n="1" title="Share your numbers">
                Total income, salary and bonus, your private rate and what you keep, clinic and
                junior pricing, and your teaching hours.
              </Step>
              <Step n="2" title="Stay anonymous">
                No name and no club are stored. Your email is only for the private link to your
                results, and it&rsquo;s never shown to anyone.
              </Step>
              <Step n="3" title="See where you stand">
                Medians and ranges, rounded, so no one&rsquo;s row can be picked out. Come back
                any time; the numbers update as more pros share.
              </Step>
            </ol>
          </div>
        </section>

        {/* ===================== THE BASELINE ===================== */}
        <section className="px-5 sm:px-8 py-20 sm:py-28 border-t border-white/[0.06]">
          <div className="max-w-5xl mx-auto grid gap-12 md:grid-cols-2 md:gap-16 items-start">
            <h2 className="text-3xl sm:text-4xl font-semibold tracking-tight">What the public filings can&rsquo;t tell you.</h2>
            <ul className="space-y-7">
              <Point title="The starting point">
                Nonprofit clubs report what their top people are paid on the IRS 990. Pulse shows
                that baseline for racquets directors.
              </Point>
              <Point title="What&rsquo;s missing from it">
                The 990 can&rsquo;t show lesson rates, the split you keep, or clinic pay. That&rsquo;s
                the part directors actually ask each other about.
              </Point>
              <Point title="Where Pulse comes in">
                Pros fill in those gaps for each other, anonymously, and everyone who shares sees
                the results.
              </Point>
            </ul>
          </div>
        </section>

        {/* ===================== CLOSING CTA ===================== */}
        <section className="px-5 sm:px-8 py-24 sm:py-32 border-t border-white/[0.06]">
          <div className="max-w-2xl mx-auto text-center">
            <h2 className="text-4xl sm:text-5xl font-semibold tracking-tight">Find out where you stand.</h2>
            <p className="mt-5 text-white/60 text-lg">It takes a few minutes. No account needed.</p>
            <Link
              href={PULSE_HREF}
              onClick={cta}
              className="mt-9 inline-flex items-center justify-center gap-2 w-full sm:w-auto px-8 h-14 rounded-full bg-[#D3FB52] text-[#002838] font-semibold text-base hover:bg-[#c5f035] transition-colors"
            >
              See how you compare <ArrowRight size={18} />
            </Link>
            <OtherToolsLine className="mt-10" product="Director Pulse" />
          </div>
        </section>
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

function Step({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <li>
      <span className="text-sm font-medium text-[#D3FB52]">{n}</span>
      <h3 className="mt-3 text-lg font-semibold">{title}</h3>
      <p className="mt-2 text-white/55 leading-relaxed">{children}</p>
    </li>
  );
}

function Point({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <li className="border-l-2 border-[#D3FB52]/60 pl-5">
      <p className="font-semibold">{title}</p>
      <p className="mt-1 text-white/55 leading-relaxed">{children}</p>
    </li>
  );
}

/** What the results screen covers. Deliberately no figures: it's locked until you share. */
function ResultsPreview() {
  const rows = [
    'Total income, all-in',
    'Private lesson, 60 min',
    'Share of the private fee pros keep',
    'Adult clinic, per player per hour',
    'Junior program, per player per hour',
  ];
  return (
    <div className="rounded-3xl border border-white/10 bg-[#002838]/70 p-5 sm:p-7 shadow-2xl shadow-black/40 text-left">
      <div className="flex items-center justify-between mb-5">
        <span className="text-sm font-semibold">Your results</span>
        <span className="inline-flex items-center gap-1.5 text-xs text-white/50">
          <Lock size={12} /> Add yours to unlock
        </span>
      </div>
      <ul className="space-y-4" aria-hidden>
        {rows.map((r, i) => (
          <li key={r}>
            <div className="flex items-center justify-between text-sm">
              <span className="text-white/80">{r}</span>
              <span className="text-white/30 tabular-nums">You vs. median</span>
            </div>
            <div className="mt-2 h-2 rounded-full bg-white/[0.06] overflow-hidden">
              <div className="h-full rounded-full bg-[#D3FB52]/30 blur-[1px]" style={{ width: `${40 + ((i * 13) % 45)}%` }} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
