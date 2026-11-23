/**
 * Racquets IRL landing page: the front door at signed-out clubmode.ai/, /racquetsirl and /play
 * (adopted 11/23/26; previewed at /racquetsirl/new, which now redirects). The old
 * self-running tour is still at /play/demo.
 *
 * Five beats, alternating night / day: hero → Create it, Fill it, Play it (one real game you
 * tap through) → the two benefits → formats → the ask.
 *
 * Server component: the hero text, CTAs and copy are in the first HTML response.
 * Only the phones (real app screens) and the stage switch hydrate.
 */
import { ArrowRight, MapPin } from 'lucide-react';
import { PRICING_LINE } from '@/lib/play/pricing';
import { AUDIENCE, BENEFITS, CTA, FINAL, FORMATS, FORMATS_ALSO, HERO, TAGLINE } from './copy';
import { CtaLink, Phone, Story } from './LandingClient';

const INK = '#103c32', LIME = '#d4ff49', NIGHT = '#07231c', PAPER = '#f4f5ef';
const SOFT = '#4d5f55'; // body text on paper, 6.4:1

export default function Landing() {
  return (
    <div className="rl min-h-screen" style={{ background: PAPER, color: INK }}>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <a href="#main" className="rl-skip">Skip to content</a>

      {/* ---------------- header + hero (night) ---------------- */}
      <div className="rl-dark overflow-hidden" style={{ background: NIGHT, color: '#eef3ea' }}>
        <header className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-4 sm:px-8">
          <a href="/racquetsirl" className="rl-focus flex min-w-0 items-center gap-2.5 rounded-lg" aria-label="Racquets IRL home">
            <Logo s={30} />
            <span className="text-[18px] font-semibold tracking-tight">Racquets IRL</span>
          </a>
          <nav aria-label="Main" className="flex items-center gap-1 sm:gap-2">
            <CtaLink href="#how" event="rirl_how" where="nav" className="rl-focus rl-navlink hidden md:inline-block">How it works</CtaLink>
            <CtaLink href="#formats" event="rirl_nav" where="formats" className="rl-focus rl-navlink hidden md:inline-block">Formats</CtaLink>
            <CtaLink href={CTA.join.href} event="rirl_join" where="nav" className="rl-focus rl-navlink hidden sm:inline-block">Find a game</CtaLink>
            <CtaLink href={CTA.primary.href} event="rirl_cta" where="nav" className="rl-focus rl-btn ml-1 inline-flex items-center whitespace-nowrap rounded-full px-4 py-2.5 text-[14px] font-semibold" style={{ background: LIME, color: INK }}>
              {CTA.primary.short}
            </CtaLink>
          </nav>
        </header>

        <section aria-labelledby="hero-title" className="mx-auto grid max-w-6xl items-center gap-10 px-5 pt-6 sm:px-8 sm:pt-10 lg:grid-cols-[minmax(0,1fr)_auto] lg:gap-8 lg:pb-20 lg:pt-12">
          <div className="text-center lg:text-left">
            <p className="text-[15px] font-medium tracking-[0.02em] text-[#a9bdb0]">{HERO.sports}</p>
            <h1 id="hero-title" className="mt-4 text-[clamp(3.1rem,12vw,6rem)] font-semibold leading-[0.93] tracking-[-0.05em]">
              {HERO.title[0]}<br /><span style={{ color: LIME }}>{HERO.title[1]}</span>
            </h1>
            <p className="mx-auto mt-6 max-w-[30rem] text-[clamp(1.125rem,2.3vw,1.3rem)] leading-[1.5] text-[#c9d8cc] lg:mx-0">{HERO.sub}</p>
            <div className="mt-8 flex flex-col items-center gap-2 sm:flex-row sm:justify-center sm:gap-4 lg:justify-start">
              <CtaLink href={CTA.primary.href} event="rirl_cta" where="hero" className="rl-focus rl-btn inline-flex w-full items-center justify-center gap-2 rounded-2xl px-7 py-4 text-[18px] font-semibold sm:w-auto" style={{ background: LIME, color: INK }}>
                {CTA.primary.label}<ArrowRight className="h-5 w-5" aria-hidden="true" />
              </CtaLink>
              <CtaLink href={CTA.secondary.href} event="rirl_how" where="hero" className="rl-focus inline-flex min-h-[48px] items-center justify-center rounded-2xl px-4 text-[16px] font-semibold text-white underline decoration-white/30 underline-offset-[6px] hover:decoration-white">
                {CTA.secondary.label}
              </CtaLink>
            </div>
            <p className="mt-5 text-[14px] text-[#a9bdb0]">{HERO.trust}</p>
          </div>

          {/* The playing half (a player's phone mid-game) with the organizing half (the group chat) tucked beside it. */}
          <div className="relative mx-auto w-fit lg:mr-6">
            <Phone id="courts" fade={NIGHT} size="[--pw:276] [--pr:0.6] sm:[--pw:300] sm:[--pr:0.62] lg:[--pw:330] lg:[--pr:0.9]"
              label="A player’s phone mid-game: her court for round 1, her partner and her opponents." />
            <div aria-hidden="true" className="rl-float absolute hidden w-[196px] sm:block rounded-2xl p-3 text-[13px] shadow-[0_24px_50px_#000a] sm:-left-28 sm:bottom-4 sm:w-[220px] lg:-left-40 lg:bottom-10" style={{ background: '#fff', color: '#111b21' }}>
              <div className="text-[11px] font-semibold" style={{ color: '#0b6b5a' }}>Friday Tennis Crew</div>
              <div className="mt-1.5 rounded-xl rounded-tr-sm px-2.5 py-2 leading-snug" style={{ background: '#d9fdd3' }}>Doubles Friday, who’s in? 🎾</div>
              <div className="mt-2 flex items-center justify-between text-[12px] font-semibold">
                <span className="flex -space-x-1.5">{['J', 'P', 'M', 'D', 'M'].map((x, i) => <span key={i} className="grid h-5 w-5 place-items-center rounded-full text-[9px] font-bold ring-2 ring-white" style={{ background: i % 2 ? '#cfe8d8' : LIME, color: INK }}>{x}</span>)}</span>
                <span>8 of 8 in</span>
              </div>
            </div>
          </div>
        </section>
      </div>

      <main id="main" tabIndex={-1} className="outline-none">
        {/* ---------------- Create it / Fill it / Play it (day) ---------------- */}
        <section id="how" tabIndex={-1} aria-labelledby="how-title" className="scroll-mt-2 outline-none">
          <div className="mx-auto max-w-6xl px-5 py-16 sm:px-8 sm:py-24 lg:py-20">
            <div className="text-center lg:text-left">
              <h2 id="how-title" className="rl-h2">Create it. Fill it. Play it.</h2>
              <p className="mx-auto mt-4 max-w-xl text-[17px] leading-relaxed lg:mx-0" style={{ color: SOFT }}>
                One real game, start to finish: Friday Night Doubles, 8 players, 2 courts. Tap through it.
              </p>
            </div>
            <div className="mt-10 lg:mt-8"><Story /></div>
            <div className="mt-12 flex flex-col items-center gap-3 sm:flex-row sm:justify-center sm:gap-6 lg:mt-16">
              <CtaLink href={CTA.primary.href} event="rirl_cta" where="story" className="rl-focus rl-btn inline-flex w-full items-center justify-center gap-2 rounded-2xl px-7 py-4 text-[17px] font-semibold sm:w-auto" style={{ background: INK, color: '#fff' }}>
                {CTA.primary.label}<ArrowRight className="h-5 w-5" aria-hidden="true" />
              </CtaLink>
              <CtaLink href={CTA.fullDemo.href} event="rirl_full_demo" where="story" className="rl-focus inline-flex min-h-[48px] items-center gap-1.5 rounded-xl px-3 text-[16px] font-semibold underline decoration-[#103c3240] underline-offset-[6px] hover:decoration-[#103c32]">
                {CTA.fullDemo.label}
              </CtaLink>
            </div>
          </div>
        </section>

        {/* ---------------- the two benefits (night) ---------------- */}
        <section aria-label="Why it’s better" className="rl-dark" style={{ background: NIGHT, color: '#eef3ea' }}>
          <div className="mx-auto grid max-w-6xl gap-14 px-5 py-16 sm:px-8 sm:py-24 md:grid-cols-2 md:gap-0 lg:py-28">
            {[BENEFITS.together, BENEFITS.court].map((b, i) => (
              <div key={b.title} className={i ? 'md:border-l md:border-white/10 md:pl-12 lg:pl-16' : 'md:pr-12 lg:pr-16'}>
                <h2 className="rl-h2" style={i ? { color: LIME } : undefined}>{b.title}</h2>
                <ul className="mt-8 divide-y divide-white/10 border-y border-white/10">
                  {b.points.map(([lead, rest]) => (
                    <li key={lead} className="py-4 text-[17px] leading-snug">
                      <b className="font-semibold text-white">{lead}</b> <span className="text-[#a9bdb0]">{rest}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>

        {/* ---------------- formats (day) ---------------- */}
        <section id="formats" tabIndex={-1} aria-labelledby="formats-title" className="scroll-mt-2 outline-none">
          <div className="mx-auto max-w-6xl px-5 py-16 sm:px-8 sm:py-24 lg:py-28">
            <h2 id="formats-title" className="rl-h2">Built for your kind of game.</h2>
            <p className="mt-4 max-w-2xl text-[17px] leading-relaxed" style={{ color: SOFT }}>{AUDIENCE}</p>
            <ul className="mt-10 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
              {FORMATS.map((f) => (
                <li key={f.key} className="rounded-3xl bg-white p-4 ring-1 ring-[#103c3214] sm:p-6">
                  <FormatArt k={f.key} />
                  <h3 className="mt-4 text-[17px] font-semibold leading-tight tracking-[-0.01em] sm:text-[19px]">{f.title}</h3>
                  <p className="mt-1.5 text-[14px] leading-snug sm:text-[15px]" style={{ color: SOFT }}>{f.sub}</p>
                </li>
              ))}
            </ul>
            <p className="mt-5 text-[15px]" style={{ color: SOFT }}>{FORMATS_ALSO}</p>
            <p className="mt-10 flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-[#103c3214] pt-8 text-[17px]">
              <MapPin className="h-5 w-5 shrink-0" aria-hidden="true" />
              <span className="font-semibold">Just want to play?</span>
              <CtaLink href={CTA.join.href} event="rirl_join" where="formats" className="rl-focus inline-flex min-h-[44px] items-center gap-1 rounded-lg font-semibold underline decoration-[#103c3240] underline-offset-[6px] hover:decoration-[#103c32]">
                {CTA.join.label}<ArrowRight className="h-4 w-4" aria-hidden="true" />
              </CtaLink>
            </p>
          </div>
        </section>

        {/* ---------------- the ask (night) ---------------- */}
        <section aria-labelledby="final-title" className="rl-dark" style={{ background: NIGHT, color: '#eef3ea' }}>
          <div className="mx-auto max-w-3xl px-5 py-20 text-center sm:px-8 sm:py-28">
            <p className="text-[15px] font-semibold" style={{ color: LIME }}>{TAGLINE}</p>
            <h2 id="final-title" className="rl-h2 mx-auto mt-4 max-w-[14ch]">{FINAL.title}</h2>
            <p className="mx-auto mt-4 max-w-xl text-[19px] leading-relaxed text-[#c9d8cc]">{FINAL.sub}</p>
            <CtaLink href={CTA.primary.href} event="rirl_cta" where="final" className="rl-focus rl-btn mt-9 inline-flex w-full items-center justify-center gap-2 rounded-2xl px-8 py-4 text-[18px] font-semibold sm:w-auto" style={{ background: LIME, color: INK }}>
              {CTA.primary.label}<ArrowRight className="h-5 w-5" aria-hidden="true" />
            </CtaLink>
            <p className="mx-auto mt-5 max-w-sm text-[14px] leading-relaxed text-[#a9bdb0]">{PRICING_LINE}</p>
          </div>
        </section>
      </main>

      <footer style={{ background: NIGHT }} className="rl-dark border-t border-white/10">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-5 py-6 text-[14px] text-[#a9bdb0] sm:flex-row sm:px-8">
          <span className="flex items-center gap-2"><Logo s={20} />Racquets IRL</span>
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

function Logo({ s = 28 }: { s?: number }) {
  return (
    <svg viewBox="0 0 32 32" fill="none" aria-hidden="true" style={{ width: s, height: s }} className="inline-block shrink-0">
      <rect width="32" height="32" rx="11" fill={LIME} />
      <path d="M18 7 10 17h7l-3 8 9-12h-7l2-6Z" stroke={INK} strokeWidth="1.7" strokeLinejoin="round" />
    </svg>
  );
}

/* ---------- format pictures: the court diagrams from the app's format chooser, drawn flat ---------- */
type Dot = [number, number, string];
const A = LIME, B = '#7fe0b4', W = '#ffffff';
function Court({ x, dots, crown, dim }: { x: number; dots: Dot[]; crown?: boolean; dim?: boolean }) {
  return (
    <g transform={`translate(${x} 0)`} opacity={dim ? 0.45 : 1}>
      <rect x="0.5" y="0.5" width="47" height="27" rx="4" fill="#1f6b52" />
      <path d="M4 3.5h40M4 24.5h40M12 3.5v21M36 3.5v21M12 14h24" stroke="#ffffff45" strokeWidth="0.8" fill="none" />
      <path d="M24 1.5v25" stroke="#ffffffcc" strokeWidth="1.4" />
      {dots.map(([cx, cy, c], i) => <circle key={i} cx={cx} cy={cy} r="3.4" fill={c} stroke="#0b2a22" strokeWidth="0.9" />)}
      {crown && <path d="M17 -2 18.5 -9 21.5 -5 24 -10.5 26.5 -5 29.5 -9 31 -2Z" fill={LIME} stroke={INK} strokeWidth="1" strokeLinejoin="round" />}
    </g>
  );
}
const DBL: Dot[] = [[14, 9, A], [14, 19, A], [34, 9, B], [34, 19, B]];
function FormatArt({ k }: { k: string }) {
  return (
    <svg viewBox="0 -12 102 40" className="h-11 w-auto sm:h-12" aria-hidden="true">
      {k === 'doubles' && <Court x={0} dots={DBL} />}
      {k === 'mixer' && <><Court x={0} dots={[[14, 9, A], [14, 19, B], [34, 9, W], [34, 19, A]]} /><Court x={54} dots={[[14, 9, B], [14, 19, W], [34, 9, A], [34, 19, B]]} /></>}
      {k === 'kotc' && <><Court x={0} dots={DBL} crown /><Court x={54} dots={DBL} dim /></>}
      {k === 'tournament' && (
        <g stroke={INK} strokeWidth="1.6" fill="none" strokeLinecap="round">
          <path d="M2 2h16v10H2M2 22h16v10M18 7h14v20H18M32 17h16" transform="translate(0 -6)" />
          <path d="M54 2h16v10H54M54 22h16v10M70 7h14v20H70M84 17h10" transform="translate(0 -6)" opacity=".35" />
          <circle cx="48" cy="11" r="3" fill={LIME} stroke={INK} strokeWidth="1.2" />
        </g>
      )}
    </svg>
  );
}

const CSS = `
.rl-skip{position:absolute;left:12px;top:-60px;z-index:100;padding:10px 16px;border-radius:12px;background:${LIME};color:${INK};font-weight:600}
.rl-skip:focus{top:12px}
.rl-focus:focus-visible{outline:3px solid ${INK};outline-offset:3px}
.rl-dark .rl-focus:focus-visible{outline-color:${LIME}}
.rl-navlink{border-radius:999px;padding:8px 12px;font-size:14px;font-weight:500;color:#c9d8cc}
.rl-navlink:hover{color:#fff}
.rl-h2{font-size:clamp(2.25rem,7vw,3.6rem);font-weight:600;line-height:1.02;letter-spacing:-0.04em}
.rl-btn{transition:transform .15s ease,filter .15s ease}
.rl-btn:hover{filter:brightness(1.05);transform:translateY(-1px)}
.rl-btn:active{transform:none}
.rl-stage{color:${INK}}
.rl-stage.is-on{background:${INK};color:#fff}
@media (min-width:1024px){
  .rl-stage{color:#5d6e64}
  .rl-stage:hover{background:#103c320a}
  .rl-stage.is-on{background:#fff;color:${INK};box-shadow:0 0 0 1px #103c3214,0 24px 48px -24px #103c3255}
  .rl-stage .rl-num{box-shadow:inset 0 0 0 1.5px #103c3240}
  .rl-stage.is-on .rl-num{background:${LIME};box-shadow:none}
  .rl-stage:not(.is-on) .rl-stage-body>span:last-child{display:none}
  .rl-stage:not(.is-on) .rl-stage-body>span:first-child{font-size:20px;color:${INK}}
  .rl-stage.is-on .rl-stage-body>span:last-child{color:${SOFT}}
}
.rl-fade{animation:rlFade .35s ease-out}
@keyframes rlFade{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
.rl-float{animation:rlFloat 6s ease-in-out infinite}
@keyframes rlFloat{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}
.rl-noscroll{scrollbar-width:none}.rl-noscroll::-webkit-scrollbar{display:none}
@media (prefers-reduced-motion: reduce){.rl-fade,.rl-float{animation:none}.rl-btn,.rl-btn:hover{transition:none;transform:none}html{scroll-behavior:auto}}
`;
