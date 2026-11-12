'use client';

import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { logLanding, type LandingEvent } from '@/lib/landing';
import s from './GuestHome.module.css';

/**
 * The signed-out homepage: three doors and a request box. Design and copy are
 * Kevin Carey's 11/11/26 prototype.
 *
 * Every door opens a page that works today, signed out:
 *   Players   → /courtconnect  (CourtConnect landing)
 *   Captains  → /captainmode   (CaptainMode landing: free, sends are metered)
 *   Directors → /try           (the full no-signup MixerMode)
 *
 * The request box is plain keyword matching and says nothing about AI.
 * Nothing on this page sends, books, or stores anything.
 */

type Door = 'players' | 'captains' | 'directors';

const DOORS: Record<Door, { href: string; event: LandingEvent }> = {
  players: { href: '/courtconnect', event: 'pick_players' },
  captains: { href: '/captainmode', event: 'pick_captains' },
  directors: { href: '/try', event: 'pick_directors' },
};

/** Which door a typed request belongs to, or null when it's unclear. */
export function routeRequest(text: string): Door | null {
  const t = text.toLowerCase();
  if (/\bmixers?\b|\bsocial\b|round.?robin|king of the court|pairings|\bdirector/.test(t)) return 'directors';
  if (/\bcaptain|\blineups?\b|line.up|\bteam\b|\bteams\b|availability|\bsubs?\b|\broster/.test(t)) return 'captains';
  if (/\bfourth\b|\b4th\b|\bpartner|\bgame\b|\bgames\b|\bhit\b|\bhitting\b|\bmatch\b|\bplay\b|\bplayer\b|\bdoubles\b|\bsingles\b/.test(t)) return 'players';
  return null;
}

export default function GuestHome() {
  const router = useRouter();
  const [text, setText] = useState('');
  const [unclear, setUnclear] = useState(false);

  useEffect(() => {
    logLanding('home', 'view');
  }, []);

  const go = (door: Door) => {
    logLanding('home', DOORS[door].event);
    router.push(DOORS[door].href);
  };

  const submit = (e?: FormEvent, value = text) => {
    e?.preventDefault();
    if (!value.trim()) return;
    logLanding('home', 'ask');
    const door = routeRequest(value);
    setUnclear(!door);
    if (door) go(door);
  };

  return (
    <div className={s.page}>
      <a className={s.skip} href="#main">Skip to content</a>

      <header className={s.header}>
        <Link className={s.logo} href="/" aria-label="ClubMode home">
          <svg viewBox="0 0 32 32" fill="none" aria-hidden="true">
            <rect width="32" height="32" rx="11" fill="#D4FF49" />
            <path d="M18 7 10 17h7l-3 8 9-12h-7l2-6Z" stroke="#103C32" strokeWidth="1.7" strokeLinejoin="round" />
          </svg>
          ClubMode<small>AI</small>
        </Link>
        <div className={s.headerRight}>
          <span className={s.headerNote}>Less admin. More play.</span>
          <Link className={s.signIn} href="/login">Sign in</Link>
        </div>
      </header>

      <main id="main" className={s.main}>
        <section className={s.hero}>
          <div className={s.eyebrow}>A little less between you and the game.</div>
          <h1 className={s.h1}>More time<br />on court.</h1>
          <p className={s.lede}>
            Find your game. Bring your team. <span>Make it happen.</span>
          </p>
        </section>

        <section className={s.choices} aria-label="Choose your ClubMode tool">
          <DoorTile door="players" role="Players / CourtConnect" title="Find your game." line="A good match. A fourth player. Your next hit." onPick={go}>
            <svg viewBox="0 0 190 130" fill="none">
              <ellipse cx="99" cy="112" rx="55" ry="5" fill="#183a2a" opacity=".07" />
              <path d="M46 34h98v65H46zM58 34v65m74-65v65M46 66h98M58 49h74m-74 33h74M95 49v33" stroke="#6a8461" strokeWidth="1" opacity=".6" />
              <circle cx="75" cy="44" r="12" fill="#103c32" />
              <circle cx="115" cy="88" r="12" fill="#103c32" />
              <circle cx="115" cy="44" r="12" fill="#d4ff49" stroke="#a4c843" />
              <path d="M110 44h10m-5-5v10" stroke="#103c32" strokeWidth="1.2" />
              <circle cx="75" cy="88" r="12" fill="#103c32" />
            </svg>
          </DoorTile>
          <DoorTile door="captains" role="Captains / CaptainMode" title="Bring your team." line="Know who’s in. Put your lineup together." onPick={go}>
            <svg viewBox="0 0 190 130" fill="none">
              <ellipse cx="98" cy="113" rx="48" ry="5" fill="#183a2a" opacity=".06" />
              <rect x="55" y="22" width="90" height="85" rx="13" transform="rotate(8 100 65)" fill="#d1d8c9" />
              <rect x="43" y="13" width="90" height="89" rx="13" fill="#fafbf5" stroke="#cbd3c6" />
              <path d="M60 31h37" stroke="#8c9d85" strokeWidth="3" strokeLinecap="round" />
              <circle cx="62" cy="52" r="8" fill="#103c32" />
              <path d="M79 51h33" stroke="#a1b198" strokeWidth="3" strokeLinecap="round" />
              <circle cx="62" cy="77" r="8" fill="#103c32" />
              <path d="M79 77h24" stroke="#a1b198" strokeWidth="3" strokeLinecap="round" />
              <circle cx="132" cy="94" r="18" fill="#d4ff49" />
              <path d="m124 94 5 5 10-11" stroke="#103c32" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </DoorTile>
          <DoorTile door="directors" role="Directors / MixerMode" title="Run a great mixer." line="Players in. Pairings ready. Let’s play." onPick={go}>
            <svg viewBox="0 0 190 130" fill="none">
              <path d="m42 42 62-19 48 38-62 20z" fill="#245449" stroke="#668976" />
              <path d="m42 54 48 39 62-20M42 66l48 39 62-20" stroke="#5c806a" />
              <path d="m49 48 63-19m-55 25 63-19M73 33l48 38M53 51l63-20M66 61l62-19m-47-3 11 9-25 8m51-17-26 9 12 9" stroke="#adc69c" strokeWidth=".8" opacity=".7" />
              <circle cx="139" cy="91" r="16" fill="#d4ff49" />
              <path d="M127 82c12 1 17 8 17 22m-1-28c-10 8-13 17-10 29" stroke="#7c9e28" strokeWidth="1.2" />
            </svg>
          </DoorTile>
        </section>

        <section className={s.request} aria-label="Describe what you need">
          <form onSubmit={submit}>
            <span className={s.spark} aria-hidden="true">✧</span>
            <input
              className={s.field}
              value={text}
              onChange={(e) => { setText(e.target.value); setUnclear(false); }}
              aria-label="What would you like to do?"
              placeholder="Or just tell us what you’d like to do…"
              maxLength={250}
            />
            <button className={s.send} aria-label="Find the right tool" type="submit">↑</button>
          </form>
          <p className={s.example}>
            Try{' '}
            <button
              type="button"
              className={s.exampleBtn}
              onClick={() => { const v = 'Set up a mixer for 12 players'; setText(v); submit(undefined, v); }}
            >
              “Set up a mixer for 12 players”
            </button>
          </p>
          {unclear && (
            <p className={s.intentError} role="status">
              Not sure which one that is. Pick Players, Captains or Directors above, or mention a game, a team or a mixer.
            </p>
          )}
          <p className={s.note}>Start without an account. You only pay when ClubMode sends emails or texts for you.</p>
        </section>
      </main>

      <footer className={s.footer}>
        <span>Built for the people who love the game.</span>
        <nav className={s.footerLinks} aria-label="More">
          <Link href="/platform">See everything</Link>
          <Link href="/pricing">Pricing</Link>
          <Link href="/terms">Terms</Link>
          <Link href="/privacy">Privacy</Link>
        </nav>
      </footer>
    </div>
  );
}

function DoorTile({
  door, role, title, line, onPick, children,
}: {
  door: Door; role: string; title: string; line: string;
  onPick: (d: Door) => void; children: React.ReactNode;
}) {
  return (
    <a
      className={s.choice}
      href={DOORS[door].href}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return; // let new-tab clicks through
        e.preventDefault();
        onPick(door);
      }}
    >
      <span className={s.role}>{role}</span>
      <div className={s.art} aria-hidden="true">{children}</div>
      <div className={s.choiceBottom}>
        <div>
          <h2>{title}</h2>
          <p>{line}</p>
        </div>
        <span className={s.arrow} aria-hidden="true">↗</span>
      </div>
    </a>
  );
}
