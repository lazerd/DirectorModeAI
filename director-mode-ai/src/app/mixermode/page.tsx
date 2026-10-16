'use client';

/**
 * /mixermode — the campaign landing page. Email outreach links here, not to /.
 *
 * It sells one thing: a free MixerMode mixer at /try, no account. The full
 * platform homepage at / stays as it was for existing users; the only bridge
 * to it is the one-line "other tools" link below the closing CTA.
 *
 * Keep it honest: no testimonials, logos, usage numbers or performance claims.
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, LayoutGrid, Zap } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import OtherToolsLine from '@/components/mixer/OtherToolsLine';

const TRY_HREF = '/try';

export default function MixerModeLandingPage() {
  const [user, setUser] = useState<{ email?: string } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // .catch + .finally so an expired session can't leave the header stuck
    // on the loading skeleton with no Sign in link.
    createClient()
      .auth.getUser()
      .then(({ data: { user } }) => setUser(user))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

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
              <Link href="/login" className="px-3 py-2 text-white/75 hover:text-white">
                Sign in
              </Link>
            )}
            <Link
              href={TRY_HREF}
              className="hidden sm:inline-flex px-4 py-2 rounded-full bg-white text-[#001820] font-medium hover:bg-white/90 transition-colors"
            >
              Try MixerMode
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
            <p className="hm-fade-up text-sm sm:text-base font-medium text-[#D3FB52]">
              Meet MixerMode by ClubMode
            </p>
            <h1
              className="hm-fade-up mt-5 text-[3.25rem] leading-[1.02] sm:text-7xl lg:text-[5.5rem] font-semibold tracking-[-0.035em]"
              style={{ animationDelay: '0.05s' }}
            >
              More play.
              <br />
              <span className="text-white/45">Less planning.</span>
            </h1>
            <p
              className="hm-fade-up mt-7 text-lg sm:text-xl text-white/65 leading-relaxed max-w-xl mx-auto"
              style={{ animationDelay: '0.1s' }}
            >
              Turn a list of players into your club&rsquo;s next great mixer. Organize doubles,
              mixed doubles or singles rounds that rotate partners and share sit-outs fairly,
              so you can spend the evening on court instead of on a clipboard.
            </p>
            <div className="hm-fade-up mt-10 flex flex-col items-center gap-3" style={{ animationDelay: '0.15s' }}>
              <Link
                href={TRY_HREF}
                className="inline-flex items-center justify-center gap-2 w-full sm:w-auto px-8 h-14 rounded-full bg-[#D3FB52] text-[#002838] font-semibold text-base hover:bg-[#c5f035] transition-colors"
              >
                Start a free mixer <ArrowRight size={18} />
              </Link>
              <p className="text-sm text-white/45">Free. No account, no email, no card.</p>
            </div>
          </div>

          {/* A picture of the thing itself: what round 1 looks like. */}
          <div className="hm-fade-up relative max-w-3xl mx-auto mt-16 sm:mt-20" style={{ animationDelay: '0.22s' }}>
            <RoundPreview />
          </div>
        </section>

        {/* ===================== HOW IT WORKS ===================== */}
        <section className="px-5 sm:px-8 py-20 sm:py-28 border-t border-white/[0.06]">
          <div className="max-w-5xl mx-auto">
            <h2 className="text-3xl sm:text-4xl font-semibold tracking-tight max-w-xl">
              Your next club event, set up before the first ball is hit.
            </h2>
            <ol className="mt-14 grid gap-10 sm:gap-8 sm:grid-cols-3">
              <Step n="1" title="Add your players">
                Type names or paste the sign-up list you already have. Mark men and women for a
                mixed doubles night.
              </Step>
              <Step n="2" title="Set your courts">
                Tell MixerMode how many courts you have. If there are more players than spots,
                sit-outs are shared around.
              </Step>
              <Step n="3" title="Play the rounds">
                Each new round mixes up partners and opponents. Enter games if you like and the
                standings keep themselves.
              </Step>
            </ol>
          </div>
        </section>

        {/* ===================== DURING THE EVENT ===================== */}
        <section className="px-5 sm:px-8 py-20 sm:py-28 border-t border-white/[0.06]">
          <div className="max-w-5xl mx-auto grid gap-12 md:grid-cols-2 md:gap-16 items-start">
            <h2 className="text-3xl sm:text-4xl font-semibold tracking-tight">
              Built for how mixers actually go.
            </h2>
            <ul className="space-y-7">
              <Point title="Someone shows up late">Add them between rounds. They&rsquo;re in the next one.</Point>
              <Point title="Someone leaves early">Mark them out. Their results stay; the next round works around them.</Point>
              <Point title="A court frees up or closes">Change the court count and the next round fits it.</Point>
              <Point title="You need it on paper">Print any round for the board by the courts.</Point>
            </ul>
          </div>
        </section>

        {/* ===================== CLOSING CTA ===================== */}
        <section className="px-5 sm:px-8 py-24 sm:py-32 border-t border-white/[0.06]">
          <div className="max-w-2xl mx-auto text-center">
            <h2 className="text-4xl sm:text-5xl font-semibold tracking-tight">Run your next mixer free.</h2>
            <p className="mt-5 text-white/60 text-lg">
              Open it on your phone at the club. Nothing to install and nothing to sign up for.
            </p>
            <Link
              href={TRY_HREF}
              className="mt-9 inline-flex items-center justify-center gap-2 w-full sm:w-auto px-8 h-14 rounded-full bg-[#D3FB52] text-[#002838] font-semibold text-base hover:bg-[#c5f035] transition-colors"
            >
              Start a free mixer <ArrowRight size={18} />
            </Link>
            <OtherToolsLine className="mt-10" />
          </div>
        </section>
      </main>

      {/* ===================== FOOTER ===================== */}
      <footer className="px-5 sm:px-8 py-10 border-t border-white/[0.06]">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-white/40">
          <span>&copy; {new Date().getFullYear()} ClubMode AI</span>
          {/* Terms and Privacy must stay linked from the homepage — payment
              processors reviewing the site look for them here. */}
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

/** Static illustration of a round on the /try page. Names are placeholders. */
function RoundPreview() {
  const courts = [
    { a: ['Maya R.', 'Chris L.'], b: ['Priya S.', 'Tom W.'] },
    { a: ['Jen K.', 'Sam O.'], b: ['Alex P.', 'Dana M.'] },
  ];
  return (
    <div className="rounded-3xl border border-white/10 bg-[#002838]/70 p-4 sm:p-6 shadow-2xl shadow-black/40">
      <div className="flex items-center justify-between px-1 mb-4">
        <span className="text-sm font-semibold">Round 2 <span className="text-white/40 font-normal">of 2</span></span>
        <span className="text-xs text-white/40">Doubles · 2 courts · 9 players</span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2" aria-hidden>
        {courts.map((c, i) => (
          <div key={i} className="rounded-2xl bg-[#001820] border border-white/[0.07] p-4 text-left">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-[#D3FB52]/90 mb-3">Court {i + 1}</p>
            <PreviewTeam names={c.a} />
            <p className="my-2 text-[10px] uppercase tracking-widest text-white/30">vs</p>
            <PreviewTeam names={c.b} />
          </div>
        ))}
      </div>
      <p className="mt-4 px-1 text-sm text-white/50 text-left">
        <span className="text-white/35">Sitting out:</span> Leo B.
      </p>
    </div>
  );
}

function PreviewTeam({ names }: { names: string[] }) {
  return (
    <div className="flex items-center gap-3">
      <p className="flex-1 font-medium leading-snug">
        {names.map((n) => <span key={n} className="block">{n}</span>)}
      </p>
      <span className="w-12 h-10 rounded-lg bg-white/[0.06] border border-white/10" />
    </div>
  );
}
