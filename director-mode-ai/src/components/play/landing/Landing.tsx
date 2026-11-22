/**
 * Racquets IRL landing page (clubmode.ai/racquetsirl, and / when signed out).
 *
 * Replaced the full-screen, self-running 8-step tour as the front door (11/22/26).
 * The tour is unchanged and still lives at /play/demo; this page links to it as the
 * deeper "watch a whole night" option. To roll back, render <DemoTour /> again in
 * app/racquetsirl/page.tsx and app/(home)/page.tsx.
 *
 * Server component: the hero text, CTAs and copy are in the first HTML response.
 * Only the phones (real app screens) and the step picker hydrate.
 */
import { ArrowRight, Check, ChevronDown, MapPin } from 'lucide-react';
import { PRICING_LINE } from '@/lib/play/pricing';
import { AUDIENCE, BENEFITS, CTA, FINAL, FORMATS, HERO, STAGES, TAGLINE } from './copy';
import { CtaLink, Phone, ProductDemo } from './LandingClient';

const INK = '#103c32', LIME = '#d4ff49', NIGHT = '#07231c', PAPER = '#f4f5ef';

export default function Landing() {
  return (
    <div className="rl min-h-screen" style={{ background: PAPER, color: INK }}>
      <style>{CSS}</style>
      <a href="#main" className="rl-skip">Skip to content</a>

      {/* ---------------- header + hero (night) ---------------- */}
      <div className="rl-dark" style={{ background: NIGHT, color: '#eef3ea' }}>
        <header className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-4 sm:px-8">
          <a href="/racquetsirl" className="rl-focus flex min-w-0 items-center gap-2.5 rounded-lg" aria-label="Racquets IRL home">
            <Logo s={30} />
            <span className="text-[18px] font-semibold tracking-tight">Racquets IRL</span>
          </a>
          <nav aria-label="Main" className="flex items-center gap-1 sm:gap-2">
            <CtaLink href="#how" event="rirl_how" where="nav" className="rl-focus hidden rounded-full px-3 py-2 text-[14px] font-medium text-[#c9d8cc] hover:text-white md:inline-block">How it works</CtaLink>
            <CtaLink href="#formats" event="rirl_nav" where="formats" className="rl-focus hidden rounded-full px-3 py-2 text-[14px] font-medium text-[#c9d8cc] hover:text-white md:inline-block">Formats</CtaLink>
            <CtaLink href={CTA.join.href} event="rirl_join" where="nav" className="rl-focus hidden rounded-full px-3 py-2 text-[14px] font-medium text-[#c9d8cc] hover:text-white sm:inline-block">Find a game</CtaLink>
            <CtaLink href={CTA.primary.href} event="rirl_cta" where="nav" className="rl-focus rl-btn ml-1 inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-4 py-2.5 text-[14px] font-semibold" style={{ background: LIME, color: INK }}>
              {CTA.primary.short}
            </CtaLink>
          </nav>
        </header>

        <section aria-labelledby="hero-title" className="mx-auto grid max-w-6xl items-center gap-12 px-5 pb-16 pt-8 sm:px-8 sm:pt-12 lg:grid-cols-[minmax(0,1fr)_auto] lg:gap-10 lg:pb-24 lg:pt-14">
          <div>
            <p className="text-[12px] font-semibold uppercase tracking-[0.12em] sm:text-[13px] sm:tracking-[0.16em]" style={{ color: LIME }}>{TAGLINE}</p>
            <h1 id="hero-title" className="mt-5 text-[clamp(3rem,10.5vw,5.75rem)] font-semibold leading-[0.95] tracking-[-0.045em]">
              {HERO.title[0]}<br /><span style={{ color: LIME }}>{HERO.title[1]}</span>
            </h1>
            <p className="mt-6 max-w-[34rem] text-[clamp(1.125rem,2.4vw,1.375rem)] leading-[1.45] text-[#c9d8cc]">{HERO.sub}</p>
            <div className="mt-9 flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:gap-5">
              <CtaLink href={CTA.primary.href} event="rirl_cta" where="hero" className="rl-focus rl-btn inline-flex items-center justify-center gap-2 rounded-2xl px-7 py-4 text-[18px] font-semibold shadow-[0_10px_30px_#d4ff4926]" style={{ background: LIME, color: INK }}>
                {CTA.primary.label}<ArrowRight className="h-5 w-5" aria-hidden="true" />
              </CtaLink>
              <CtaLink href={CTA.secondary.href} event="rirl_how" where="hero" className="rl-focus inline-flex items-center justify-center gap-1.5 rounded-2xl px-4 py-3 text-[16px] font-semibold text-white underline-offset-4 hover:underline">
                {CTA.secondary.label}<ChevronDown className="h-4 w-4" aria-hidden="true" />
              </CtaLink>
            </div>
            <ul className="mt-8 flex flex-wrap gap-x-5 gap-y-2 text-[14px] text-[#a9bdb0]">
              {HERO.trust.map((t) => <li key={t} className="flex items-center gap-1.5"><Check className="h-4 w-4 shrink-0" style={{ color: LIME }} aria-hidden="true" />{t}</li>)}
            </ul>
          </div>

          <div className="relative mx-auto lg:mr-4">
            <Phone id="courts" size="[--pw:270] sm:[--pw:300] lg:[--pw:330]" label="A player’s phone during a game: her court, her partner and her opponents for round 1." />
            {/* The organizing half of the story, beside the playing half. */}
            <div aria-hidden="true" className="rl-float absolute -left-8 bottom-14 hidden w-[230px] rounded-2xl p-3 text-[14px] shadow-[0_20px_50px_#0008] sm:block lg:-left-28" style={{ background: '#ffffff', color: '#111b21' }}>
              <div className="text-[12px] font-semibold" style={{ color: '#0b6b5a' }}>Friday Tennis Crew</div>
              <div className="mt-1.5 rounded-xl px-3 py-2" style={{ background: '#d9fdd3' }}>Doubles Friday, who’s in? 🎾<div className="mt-1 truncate text-[12px] font-semibold" style={{ color: INK }}>clubmode.ai/p/fri-doubles</div></div>
              <div className="mt-2 flex items-center gap-2 text-[13px] font-semibold"><span className="grid h-5 w-5 place-items-center rounded-full" style={{ background: LIME, color: INK }}><Check className="h-3 w-3" /></span>8 of 8 in</div>
            </div>
          </div>
        </section>
      </div>

      <main id="main" tabIndex={-1} className="outline-none">
        {/* ---------------- Create it / Fill it / Play it ---------------- */}
        <section id="how" tabIndex={-1} aria-labelledby="how-title" className="scroll-mt-4 outline-none">
          <div className="mx-auto max-w-6xl px-5 py-20 sm:px-8 sm:py-28">
            <Kicker>How it works</Kicker>
            <h2 id="how-title" className="rl-h2 mt-3">Create it. Fill it. Play it.</h2>
            <p className="mt-4 max-w-2xl text-[18px] leading-relaxed" style={{ color: '#4d5f55' }}>The whole thing, from “anyone up for doubles?” to the last point, on the phones you already have.</p>
            <ol className="mt-12 grid gap-5 md:grid-cols-3">
              {STAGES.map((st, i) => (
                <li key={st.key} className="flex flex-col overflow-hidden rounded-[28px] bg-white ring-1 ring-[#103c3214]">
                  <div className="flex h-[200px] items-center justify-center px-6" style={{ background: i === 2 ? INK : '#e9eee3' }} aria-hidden="true">
                    {i === 0 ? <MiniCreate /> : i === 1 ? <MiniFill /> : <MiniPlay />}
                  </div>
                  <div className="flex-1 p-6 sm:p-7">
                    <div className="flex items-center gap-2 text-[13px] font-bold uppercase tracking-[0.14em]" style={{ color: '#3d6b55' }}>
                      <span className="grid h-6 w-6 place-items-center rounded-full text-[12px]" style={{ background: INK, color: LIME }}>{i + 1}</span>{st.label}
                    </div>
                    <h3 className="mt-3 text-[24px] font-semibold leading-tight tracking-[-0.02em]">{st.title}</h3>
                    <p className="mt-2 text-[16px] leading-relaxed" style={{ color: '#4d5f55' }}>{st.body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* ---------------- See it in action ---------------- */}
        <section id="demo" aria-labelledby="demo-title" className="rl-dark" style={{ background: NIGHT, color: '#eef3ea' }}>
          <div className="mx-auto max-w-6xl px-5 py-20 sm:px-8 sm:py-28">
            <Kicker dark>See it in action</Kicker>
            <h2 id="demo-title" className="rl-h2 mt-3">Friday Night Doubles.<br className="hidden sm:block" /> 8 players, 2 courts.</h2>
            <p className="mt-4 max-w-2xl text-[18px] leading-relaxed text-[#c9d8cc]">Real app screens, running a sample game right in your browser. Tap through it.</p>
            <div className="mt-12"><ProductDemo /></div>
            <div className="mt-14 flex flex-col items-start gap-4 border-t border-white/10 pt-10 sm:flex-row sm:items-center sm:justify-between">
              <CtaLink href={CTA.fullDemo.href} event="rirl_full_demo" where="demo" className="rl-focus inline-flex items-center gap-2 rounded-lg text-[16px] font-semibold text-white underline underline-offset-4 decoration-white/40 hover:decoration-white">
                {CTA.fullDemo.label}<ArrowRight className="h-4 w-4" aria-hidden="true" />
              </CtaLink>
              <CtaLink href={CTA.primary.href} event="rirl_cta" where="demo" className="rl-focus rl-btn inline-flex items-center gap-2 rounded-2xl px-6 py-3.5 text-[17px] font-semibold" style={{ background: LIME, color: INK }}>
                {CTA.primary.label}<ArrowRight className="h-5 w-5" aria-hidden="true" />
              </CtaLink>
            </div>
          </div>
        </section>

        {/* ---------------- the two benefits ---------------- */}
        <section aria-labelledby="why-title">
          <div className="mx-auto max-w-6xl px-5 py-20 sm:px-8 sm:py-28">
            <Kicker>Why it’s better</Kicker>
            <h2 id="why-title" className="rl-h2 mt-3">Easier to organize.<br className="hidden sm:block" /> More fun to play.</h2>
            <div className="mt-12 grid gap-5 md:grid-cols-2">
              {[BENEFITS.together, BENEFITS.court].map((b, i) => (
                <div key={b.kicker} className="rounded-[28px] p-7 sm:p-9" style={i ? { background: INK, color: '#eef3ea' } : { background: '#fff', boxShadow: 'inset 0 0 0 1px #103c3214' }}>
                  <div className="text-[13px] font-bold uppercase tracking-[0.14em]" style={{ color: i ? LIME : '#3d6b55' }}>{b.kicker}</div>
                  <h3 className="mt-3 text-[28px] font-semibold leading-tight tracking-[-0.02em]">{b.title}</h3>
                  <ul className="mt-6 grid gap-3.5">
                    {b.points.map((p) => (
                      <li key={p} className="flex gap-3 text-[16px] leading-relaxed">
                        <span className="mt-1 grid h-5 w-5 shrink-0 place-items-center rounded-full" style={i ? { background: LIME, color: INK } : { background: INK, color: LIME }}><Check className="h-3 w-3" aria-hidden="true" /></span>
                        <span style={{ color: i ? '#d5e2d8' : '#2f463b' }}>{p}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ---------------- formats + who it's for ---------------- */}
        <section id="formats" tabIndex={-1} aria-labelledby="formats-title" className="scroll-mt-4 outline-none" style={{ background: '#e9eee3' }}>
          <div className="mx-auto max-w-6xl px-5 py-20 sm:px-8 sm:py-28">
            <Kicker>Formats</Kicker>
            <h2 id="formats-title" className="rl-h2 mt-3">Built for your kind of game.</h2>
            <p className="mt-4 max-w-2xl text-[18px] leading-relaxed" style={{ color: '#4d5f55' }}>{AUDIENCE}</p>
            <ul className="mt-7 flex flex-wrap gap-2" aria-label="Sports">
              {['Tennis', 'Pickleball', 'Padel'].map((x) => <li key={x} className="rounded-full px-4 py-2 text-[15px] font-semibold" style={{ background: INK, color: '#fff' }}>{x}</li>)}
            </ul>
            <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {FORMATS.map((f) => (
                <li key={f.title} className="rounded-3xl bg-white p-6 ring-1 ring-[#103c3214]">
                  <h3 className="text-[19px] font-semibold tracking-[-0.01em]">{f.title}</h3>
                  <p className="mt-2 text-[15px] leading-relaxed" style={{ color: '#4d5f55' }}>{f.sub}</p>
                </li>
              ))}
            </ul>
            <p className="mt-6 text-[15px]" style={{ color: '#4d5f55' }}>Also: mixed doubles, team battles, and singles rotations.</p>

            <div className="mt-12 flex flex-col gap-4 rounded-3xl bg-white p-6 ring-1 ring-[#103c3214] sm:flex-row sm:items-center sm:justify-between sm:p-7">
              <div className="flex items-start gap-4">
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl" style={{ background: '#e9eee3' }}><MapPin className="h-5 w-5" aria-hidden="true" /></span>
                <div>
                  <h3 className="text-[19px] font-semibold">Just want to play?</h3>
                  <p className="mt-1 text-[15px] leading-relaxed" style={{ color: '#4d5f55' }}>See open games near you that need a player, at your level.</p>
                </div>
              </div>
              <CtaLink href={CTA.join.href} event="rirl_join" where="formats" className="rl-focus inline-flex shrink-0 items-center justify-center gap-2 rounded-2xl px-5 py-3 text-[16px] font-semibold ring-2 ring-inset hover:bg-[#103c320a]" style={{ color: INK, ['--tw-ring-color' as string]: INK }}>
                {CTA.join.label}<ArrowRight className="h-4 w-4" aria-hidden="true" />
              </CtaLink>
            </div>
          </div>
        </section>

        {/* ---------------- final CTA ---------------- */}
        <section aria-labelledby="final-title" className="rl-dark" style={{ background: NIGHT, color: '#eef3ea' }}>
          <div className="mx-auto max-w-3xl px-5 py-24 text-center sm:px-8 sm:py-32">
            <Logo s={52} />
            <h2 id="final-title" className="rl-h2 mt-6">{FINAL.title}</h2>
            <p className="mx-auto mt-4 max-w-xl text-[20px] leading-relaxed text-[#c9d8cc]">{FINAL.sub}</p>
            <CtaLink href={CTA.primary.href} event="rirl_cta" where="final" className="rl-focus rl-btn mt-9 inline-flex items-center gap-2 rounded-2xl px-8 py-4 text-[18px] font-semibold" style={{ background: LIME, color: INK }}>
              {CTA.primary.label}<ArrowRight className="h-5 w-5" aria-hidden="true" />
            </CtaLink>
            <p className="mx-auto mt-5 max-w-md text-[14px] leading-relaxed text-[#a9bdb0]">{PRICING_LINE} No login, no app to download.</p>
          </div>
        </section>
      </main>

      <footer style={{ background: NIGHT }} className="rl-dark border-t border-white/10">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-5 py-8 text-[14px] text-[#a9bdb0] sm:flex-row sm:px-8">
          <span className="flex items-center gap-2"><Logo s={20} />{TAGLINE}</span>
          <nav aria-label="Footer" className="flex flex-wrap justify-center gap-x-4 gap-y-1">
            <a href={CTA.fullDemo.href} className="rl-focus inline-block rounded px-1 py-2 hover:text-white">Full demo</a>
            <a href={CTA.join.href} className="rl-focus inline-block rounded px-1 py-2 hover:text-white">Find a game</a>
            <a href={CTA.suite.href} className="rl-focus inline-block rounded px-1 py-2 hover:text-white">{CTA.suite.label}</a>
          </nav>
        </div>
      </footer>
    </div>
  );
}

function Kicker({ children, dark }: { children: React.ReactNode; dark?: boolean }) {
  return <p className="text-[13px] font-bold uppercase tracking-[0.16em]" style={{ color: dark ? LIME : '#3d6b55' }}>{children}</p>;
}

function Logo({ s = 28 }: { s?: number }) {
  return (
    <svg viewBox="0 0 32 32" fill="none" aria-hidden="true" style={{ width: s, height: s }} className="inline-block shrink-0">
      <rect width="32" height="32" rx="11" fill={LIME} />
      <path d="M18 7 10 17h7l-3 8 9-12h-7l2-6Z" stroke={INK} strokeWidth="1.7" strokeLinejoin="round" />
    </svg>
  );
}

/* ---------- the three small pictures: faithful to the real screens, drawn small ---------- */
function MiniCreate() {
  return (
    <div className="w-full max-w-[250px] text-[12px] font-semibold">
      <div className="grid grid-cols-3 gap-1 rounded-xl p-1" style={{ background: '#d9e0d2' }}>
        {['Tennis', 'Pickleball', 'Padel'].map((x, i) => <span key={x} className="rounded-lg py-1.5 text-center" style={i === 1 ? { background: INK, color: '#fff' } : undefined}>{x}</span>)}
      </div>
      <div className="mt-2 grid grid-cols-2 gap-1.5">
        {[['A game', 'Doubles or singles'], ['Social mixer', 'Rotating partners'], ['King of the Court', 'Winners move up'], ['Tournament', 'Round robin & more']].map(([t, d], i) => (
          <span key={t} className="rounded-xl border bg-white px-2.5 py-2 leading-tight" style={i === 1 ? { borderColor: INK, background: '#f4ffd9', boxShadow: `inset 0 0 0 1px ${INK}` } : { borderColor: '#103c3222' }}>
            {t}<span className="block text-[10px] font-normal" style={{ color: '#5d6e64' }}>{d}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function MiniFill() {
  const ppl = ['J', 'P', 'M', 'D', 'M', 'E', 'C'];
  return (
    <div className="w-full max-w-[250px]">
      <div className="ml-auto w-fit max-w-[90%] rounded-2xl rounded-tr-md px-3 py-2 text-[13px] shadow-sm" style={{ background: '#d9fdd3', color: '#111b21' }}>
        Doubles Friday, who’s in? 🎾
        <span className="mt-1 block text-[11px] font-semibold" style={{ color: INK }}>clubmode.ai/p/fri-doubles</span>
      </div>
      <div className="mt-3 rounded-2xl bg-white p-3 shadow-sm">
        <div className="flex items-center justify-between text-[12px] font-semibold"><span>7 of 8 in</span><span style={{ color: '#5d6e64' }}>1 spot left</span></div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full" style={{ background: '#e3e8dd' }}><div className="h-full w-[87.5%] rounded-full" style={{ background: INK }} /></div>
        <div className="mt-2.5 flex -space-x-1.5">
          {ppl.map((p, i) => <span key={i} className="grid h-6 w-6 place-items-center rounded-full text-[10px] font-bold ring-2 ring-white" style={{ background: i % 2 ? '#cfe8d8' : LIME, color: INK }}>{p}</span>)}
          <span className="grid h-6 w-6 place-items-center rounded-full text-[10px] font-bold ring-2 ring-white" style={{ background: '#eef1e8', color: '#5d6e64' }}>+</span>
        </div>
      </div>
    </div>
  );
}

function MiniPlay() {
  const rows = [['Court 1', 'Priya & Dev', 'Marcus & Maya'], ['Court 2', 'Jordan & Elena', 'Chris & Sofia']];
  return (
    <div className="grid w-full max-w-[250px] gap-2">
      {rows.map(([c, a, b], i) => (
        <div key={c} className="rounded-2xl px-3 py-2.5 text-[12px]" style={{ background: i ? '#ffffff14' : '#ffffff', color: i ? '#eef3ea' : INK }}>
          <div className="flex items-center justify-between font-bold uppercase tracking-[0.1em] text-[10px]" style={{ color: i ? '#a9bdb0' : '#3d6b55' }}>{c}<span>Round 1</span></div>
          <div className="mt-1 font-semibold">{a} <span className="font-normal opacity-60">vs</span> {b}</div>
        </div>
      ))}
      <div className="text-center text-[11px] font-semibold" style={{ color: LIME }}>Next round: fresh partners</div>
    </div>
  );
}

const CSS = `
.rl-skip{position:absolute;left:12px;top:-60px;z-index:100;padding:10px 16px;border-radius:12px;background:${LIME};color:${INK};font-weight:600}
.rl-skip:focus{top:12px}
.rl-focus:focus-visible{outline:3px solid ${INK};outline-offset:3px}
.rl-dark .rl-focus:focus-visible{outline-color:${LIME}}
.rl-h2{font-size:clamp(2.25rem,6vw,3.75rem);font-weight:600;line-height:1.02;letter-spacing:-0.035em}
.rl-btn{transition:transform .15s ease,filter .15s ease}
.rl-btn:hover{filter:brightness(1.04);transform:translateY(-1px)}
.rl-btn:active{transform:translateY(0)}
.rl-fade{animation:rlFade .35s ease-out}
@keyframes rlFade{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
.rl-float{animation:rlFloat 6s ease-in-out infinite}
@keyframes rlFloat{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}
.rl-noscroll{scrollbar-width:none}.rl-noscroll::-webkit-scrollbar{display:none}
@media (prefers-reduced-motion: reduce){.rl-fade,.rl-float{animation:none}.rl-btn,.rl-btn:hover{transition:none;transform:none}html{scroll-behavior:auto}}
`;
