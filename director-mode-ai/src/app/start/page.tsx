'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Sparkles, ArrowRight, ArrowLeft, Loader2, Check, LayoutGrid, Calendar, Users, Building2,
} from 'lucide-react';

/**
 * /start — the first-run flow.
 *
 * A new director used to sign up and land on fifteen tools all showing zero,
 * which reads as abandoned software rather than a fresh account. This walks them
 * to something real in about a minute: a club, its courts, a league, and a few
 * players. Every step has a sensible default and every step can be skipped —
 * the goal is a club with data in it, not a complete profile.
 *
 * All four steps are collected client-side and written in ONE call to
 * /api/onboarding/first-run, so a director who abandons halfway creates nothing,
 * and a retry after an error resumes rather than duplicating.
 *
 * NOTE ON INPUTS: text colour is set inline. This app's global input CSS sits
 * outside Tailwind's layers and wins the cascade, which renders form text
 * white-on-white if you rely on utility classes here.
 */

const INPUT: React.CSSProperties = {
  color: '#ffffff',
  backgroundColor: 'rgba(255,255,255,0.06)',
  caretColor: '#D3FB52',
};

/**
 * The zones nearly every club is in, plus whatever the browser reported —
 * that one is prepended as its own option, so a club in Europe or Hawaii is
 * never forced into the wrong answer by a short list.
 */
const TIMEZONES = [
  { value: 'America/New_York', label: 'Eastern — New York' },
  { value: 'America/Chicago', label: 'Central — Chicago' },
  { value: 'America/Denver', label: 'Mountain — Denver' },
  { value: 'America/Phoenix', label: 'Mountain, no DST — Phoenix' },
  { value: 'America/Los_Angeles', label: 'Pacific — Los Angeles' },
  { value: 'America/Anchorage', label: 'Alaska — Anchorage' },
  { value: 'Pacific/Honolulu', label: 'Hawaii — Honolulu' },
];

/**
 * The categories a league can be entered under.
 *
 * Setup used to seed 'men_doubles' silently for every club that named a
 * league, which is wrong roughly half the time and invisible until somebody
 * tries to register.
 */
const CATEGORIES = [
  { value: 'women_doubles', label: "Women's doubles" },
  { value: 'men_doubles', label: "Men's doubles" },
  { value: 'women_singles', label: "Women's singles" },
  { value: 'men_singles', label: "Men's singles" },
];

type Step = 0 | 1 | 2 | 3 | 4;

export default function StartPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /*
   * Who is signing up.
   *
   * Everything below this asks about courts and leagues, which is a director's
   * world. A captain has neither — they run one team in someone else's league —
   * and used to be walked through club setup anyway before finding CaptainMode
   * on their own, if they ever did.
   *
   * Coaches are deliberately NOT a choice here: a coach's record is created
   * when they accept a club invite, so they never arrive through this page.
   *
   * Only 'director' is ever stored — picking captain navigates away to the
   * CaptainMode trial rather than continuing here, so there is no captain
   * state for this page to be in.
   */
  const [role, setRole] = useState<'director' | null>(null);

  const [clubName, setClubName] = useState('');
  /*
   * The club's timezone.
   *
   * Every time the club ever shows — court bookings, match times, reminder
   * emails — is rendered in this. It used to be asked for nowhere at all, so
   * every club took the column default of Pacific and a club in Boston ran
   * three hours out with no way to say otherwise.
   *
   * Detected in an effect rather than in the initial state because this
   * component server-renders first, where Intl reports the SERVER's zone (UTC
   * on Vercel) — using it as the initial value would hydrate a mismatch and
   * show the wrong answer for a frame.
   */
  const [timezone, setTimezone] = useState('');
  useEffect(() => {
    try {
      setTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone || '');
    } catch {
      /* Ancient browser: leave it blank and let them pick. */
    }
  }, []);
  const [courtCount, setCourtCount] = useState(6);
  const [leagueName, setLeagueName] = useState('');
  const [categoryKey, setCategoryKey] = useState('');
  // Local calendar date, not toISOString() — that is the UTC date, which is
  // already tomorrow after 5pm Pacific.
  const [leagueStart, setLeagueStart] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });
  const [players, setPlayers] = useState(['', '', '']);

  const [result, setResult] = useState<{
    club: { name: string; slug: string; joinCode: string | null };
    league: { slug: string | null } | null;
    created: { club: boolean; courts: number; league: boolean; players: number };
  } | null>(null);

  const setPlayer = (i: number, v: string) =>
    setPlayers((p) => p.map((x, n) => (n === i ? v : x)));

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/onboarding/first-run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clubName,
          courtCount,
          leagueName: leagueName.trim() || undefined,
          categoryKey: categoryKey || undefined,
          leagueStart,
          timezone: timezone || undefined,
          players: players.filter((p) => p.trim()),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Setup failed');
      setResult(json);
      setStep(4);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Setup failed');
    } finally {
      setSaving(false);
    }
  };

  const STEPS = ['Your club', 'Courts', 'A league', 'Players'];

  // Ask who they are before asking anything that assumes an answer.
  if (role === null) {
    return (
      <div className="min-h-screen bg-[#001820] text-white" style={{ fontFamily: "'Inter', system-ui, sans-serif" }}>
        <div className="mx-auto max-w-xl px-5 py-12 sm:py-16">
          <div className="inline-flex items-center gap-2 rounded-full border border-[#D3FB52]/20 bg-[#D3FB52]/10 px-3 py-1 text-xs font-medium text-[#D3FB52]">
            <Sparkles size={13} /> Setting up
          </div>
          <h1 className="mt-5 text-3xl font-bold tracking-tight sm:text-4xl">
            What brings you to ClubMode?
          </h1>
          <p className="mt-2 text-[15px] text-white/50">
            So we set up the right thing. You can use both later.
          </p>

          <div className="mt-8 space-y-3">
            <button
              onClick={() => setRole('director')}
              className="group flex w-full items-center gap-4 rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5 text-left transition-colors hover:border-[#D3FB52]/40 hover:bg-white/[0.05]"
            >
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#D3FB52]/12 text-[#D3FB52]">
                <Building2 size={20} />
              </span>
              <span className="min-w-0">
                <span className="block text-[15px] font-semibold">I run a club or program</span>
                <span className="block text-[13px] text-white/45">
                  Courts, leagues, events and members. Takes about a minute to set up.
                </span>
              </span>
              <ArrowRight size={16} className="ml-auto shrink-0 text-white/25 transition-colors group-hover:text-[#D3FB52]" />
            </button>

            {/* Straight out to the trial page: CaptainMode is priced separately
                and that page states the cost before asking for anything. */}
            <button
              // No setRole here on purpose: this leaves the page entirely, and
              // setting it would render a frame of the director wizard first.
              onClick={() => router.push('/captain/start?from=onboarding')}
              className="group flex w-full items-center gap-4 rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5 text-left transition-colors hover:border-[#D3FB52]/40 hover:bg-white/[0.05]"
            >
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#D3FB52]/12 text-[#D3FB52]">
                <Users size={20} />
              </span>
              <span className="min-w-0">
                <span className="block text-[15px] font-semibold">I captain a team</span>
                <span className="block text-[13px] text-white/45">
                  Lineups, availability and match emails for one team — that&apos;s CaptainMode.
                </span>
              </span>
              <ArrowRight size={16} className="ml-auto shrink-0 text-white/25 transition-colors group-hover:text-[#D3FB52]" />
            </button>
          </div>

          <p className="mt-10 text-center text-[13px] text-white/25">
            <Link href="/run/courts" className="underline hover:text-white/50">
              Skip setup and explore on my own
            </Link>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#001820] text-white" style={{ fontFamily: "'Inter', system-ui, sans-serif" }}>
      <div className="mx-auto max-w-xl px-5 py-12 sm:py-16">
        <div className="inline-flex items-center gap-2 rounded-full border border-[#D3FB52]/20 bg-[#D3FB52]/10 px-3 py-1 text-xs font-medium text-[#D3FB52]">
          <Sparkles size={13} /> Setting up
        </div>

        {step < 4 && (
          <>
            <h1 className="mt-5 text-3xl font-bold tracking-tight sm:text-4xl">
              Let&apos;s set up your first league
            </h1>
            <p className="mt-2 text-[15px] text-white/50">
              Four quick questions and your club has real data in it. Skip anything you
              don&apos;t want to answer yet — you can change all of it later.
            </p>

            {/* Progress */}
            <div className="mt-8 flex items-center gap-2">
              {STEPS.map((label, i) => (
                <div key={label} className="flex-1">
                  <div
                    className="h-1 rounded-full transition-colors"
                    style={{ background: i <= step ? '#D3FB52' : 'rgba(255,255,255,0.12)' }}
                  />
                  <p className={`mt-1.5 text-[11px] ${i === step ? 'text-white/70' : 'text-white/30'}`}>{label}</p>
                </div>
              ))}
            </div>
          </>
        )}

        <div className="mt-8">
          {/* ------------------------------- 0: club ------------------------------- */}
          {step === 0 && (
            <Card icon={<Building2 size={20} />} title="What's your club called?">
              <input
                autoFocus
                value={clubName}
                onChange={(e) => setClubName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && clubName.trim()) setStep(1); }}
                placeholder="Riverside Tennis Club"
                style={INPUT}
                className="mt-4 w-full rounded-xl border border-white/10 px-4 py-3 text-[15px] outline-none placeholder:text-white/25 focus:border-[#D3FB52]/50"
              />

              {/* Asked here rather than on its own screen: it is pre-filled
                  from the browser, so for almost everyone it is a glance and a
                  Continue, not a decision. */}
              <label htmlFor="club-tz" className="mt-5 block text-[12.5px] text-white/40">
                Time zone
              </label>
              <select
                id="club-tz"
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                style={INPUT}
                className="mt-1 w-full rounded-xl border border-white/10 px-4 py-3 text-[15px] outline-none focus:border-[#D3FB52]/50"
              >
                {timezone && !TIMEZONES.some((t) => t.value === timezone) && (
                  <option value={timezone}>{timezone.replace(/_/g, ' ')}</option>
                )}
                {TIMEZONES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
              <p className="mt-1.5 text-[12.5px] text-white/35">
                Court times, match times and reminder emails all use this.
              </p>

              <Nav
                onNext={() => setStep(1)}
                nextDisabled={!clubName.trim()}
                nextLabel="Continue"
              />
            </Card>
          )}

          {/* ------------------------------ 1: courts ------------------------------ */}
          {step === 1 && (
            <Card icon={<LayoutGrid size={20} />} title="How many courts?">
              <p className="mt-1 text-[13.5px] text-white/45">
                We&apos;ll name them Court 1 through Court {courtCount}. Rename or add more any time.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                {[2, 4, 6, 8, 10, 12].map((n) => (
                  <button
                    key={n}
                    onClick={() => setCourtCount(n)}
                    className="rounded-xl border px-4 py-2.5 text-[15px] font-medium transition-colors"
                    style={{
                      borderColor: courtCount === n ? '#D3FB52' : 'rgba(255,255,255,0.12)',
                      background: courtCount === n ? 'rgba(211,251,82,0.12)' : 'transparent',
                      color: courtCount === n ? '#D3FB52' : 'rgba(255,255,255,0.7)',
                    }}
                  >
                    {n}
                  </button>
                ))}
              </div>
              <input
                type="number"
                min={0}
                max={30}
                value={courtCount}
                onChange={(e) => setCourtCount(Math.max(0, Math.min(30, Number(e.target.value) || 0)))}
                style={INPUT}
                className="mt-3 w-28 rounded-xl border border-white/10 px-4 py-2.5 text-[15px] outline-none focus:border-[#D3FB52]/50"
              />
              <Nav onBack={() => setStep(0)} onNext={() => setStep(2)} nextLabel="Continue" />
            </Card>
          )}

          {/* ------------------------------ 2: league ------------------------------ */}
          {step === 2 && (
            <Card icon={<Calendar size={20} />} title="Name your first league">
              <p className="mt-1 text-[13.5px] text-white/45">
                We&apos;ll open it as an 8-week round robin starting on this date. Nothing is
                published until you say so.
              </p>
              <input
                autoFocus
                value={leagueName}
                onChange={(e) => setLeagueName(e.target.value)}
                placeholder="Fall Doubles League"
                style={INPUT}
                className="mt-4 w-full rounded-xl border border-white/10 px-4 py-3 text-[15px] outline-none placeholder:text-white/25 focus:border-[#D3FB52]/50"
              />
              <label className="mt-3 block text-[12.5px] text-white/40">Starts</label>
              <input
                type="date"
                value={leagueStart}
                onChange={(e) => setLeagueStart(e.target.value)}
                style={INPUT}
                className="mt-1 rounded-xl border border-white/10 px-4 py-2.5 text-[15px] outline-none focus:border-[#D3FB52]/50"
              />

              {/* Only once they have named a league — asked rather than assumed,
                  because this used to be seeded as men's doubles for everyone. */}
              {leagueName.trim() && (
                <>
                  <label htmlFor="league-cat" className="mt-3 block text-[12.5px] text-white/40">
                    Who plays in it
                  </label>
                  <select
                    id="league-cat"
                    value={categoryKey}
                    onChange={(e) => setCategoryKey(e.target.value)}
                    style={INPUT}
                    className="mt-1 w-full rounded-xl border border-white/10 px-4 py-2.5 text-[15px] outline-none focus:border-[#D3FB52]/50"
                  >
                    <option value="">Choose one…</option>
                    {CATEGORIES.map((c) => (
                      <option key={c.value} value={c.value}>{c.label}</option>
                    ))}
                  </select>
                  <p className="mt-1.5 text-[12.5px] text-white/35">
                    You can add more divisions to this league later.
                  </p>
                </>
              )}

              <Nav
                onBack={() => setStep(1)}
                onNext={() => setStep(3)}
                nextDisabled={!!leagueName.trim() && !categoryKey}
                nextLabel={leagueName.trim() ? 'Continue' : 'Skip for now'}
              />
            </Card>
          )}

          {/* ----------------------------- 3: players ----------------------------- */}
          {step === 3 && (
            <Card icon={<Users size={20} />} title="Add three players">
              <p className="mt-1 text-[13.5px] text-white/45">
                Just enough to see your roster working. You can import the rest from a
                spreadsheet later.
              </p>
              <div className="mt-4 space-y-2">
                {players.map((p, i) => (
                  <input
                    key={i}
                    autoFocus={i === 0}
                    value={p}
                    onChange={(e) => setPlayer(i, e.target.value)}
                    placeholder={['First player', 'Second player', 'Third player'][i]}
                    style={INPUT}
                    className="w-full rounded-xl border border-white/10 px-4 py-3 text-[15px] outline-none placeholder:text-white/25 focus:border-[#D3FB52]/50"
                  />
                ))}
              </div>
              {error && (
                <p className="mt-4 rounded-xl border border-red-400/25 bg-red-400/10 px-4 py-3 text-[13.5px] text-red-300">
                  {error}
                </p>
              )}
              <Nav
                onBack={() => setStep(2)}
                onNext={submit}
                nextLabel={saving ? 'Setting up…' : 'Finish setup'}
                busy={saving}
              />
            </Card>
          )}

          {/* ------------------------------- 4: done ------------------------------- */}
          {step === 4 && result && (
            <div>
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#D3FB52]/15">
                <Check size={24} className="text-[#D3FB52]" />
              </div>
              <h1 className="mt-5 text-3xl font-bold tracking-tight sm:text-4xl">
                {result.club.name} is live
              </h1>
              <p className="mt-2 text-[15px] text-white/50">
                {[
                  result.created.courts ? `${result.created.courts} courts` : null,
                  result.created.league ? '1 league' : null,
                  result.created.players ? `${result.created.players} players` : null,
                ].filter(Boolean).join(' · ') || 'Your club is ready.'}
                {' — '}here&apos;s where they live.
              </p>

              <div className="mt-8 space-y-3">
                <Dest href="/courtsheet/staff" icon={<LayoutGrid size={18} />} color="#22d3ee"
                  title="CourtSheet" body="Today's grid, with your courts on it." />
                {result.league && (
                  <Dest href="/mixer/leagues" icon={<Calendar size={18} />} color="#34d399"
                    title="LeagueMode" body="Your league, ready for entries." />
                )}
                <Dest href="/courtconnect/vault" icon={<Users size={18} />} color="#2dd4bf"
                  title="PlayerVault" body="Your roster. Import the rest when you're ready." />
              </div>

              {result.club.joinCode && (
                <div className="mt-8 rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5">
                  <p className="text-[13px] font-medium text-white/70">Invite your members</p>
                  <p className="mt-1 text-[13px] text-white/45">
                    Share this code and they can join and book courts themselves.
                  </p>
                  <p className="mt-2 font-mono text-lg tracking-[0.2em] text-[#D3FB52]">
                    {result.club.joinCode}
                  </p>
                </div>
              )}

              <button
                onClick={() => router.push('/run/courts')}
                className="mt-8 inline-flex items-center gap-2 rounded-xl bg-[#D3FB52] px-6 py-3 font-semibold text-[#002838] transition-colors hover:bg-[#c5f035]"
              >
                Go to my club <ArrowRight size={16} />
              </button>
            </div>
          )}
        </div>

        {step < 4 && (
          <p className="mt-10 text-center text-[13px] text-white/25">
            <Link href="/run/courts" className="underline hover:text-white/50">
              Skip setup and explore on my own
            </Link>
          </p>
        )}
      </div>
    </div>
  );
}

function Card({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-6">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#D3FB52]/10 text-[#D3FB52]">
          {icon}
        </span>
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      </div>
      {children}
    </div>
  );
}

function Nav({
  onBack, onNext, nextLabel, nextDisabled, busy,
}: {
  onBack?: () => void;
  onNext: () => void;
  nextLabel: string;
  nextDisabled?: boolean;
  busy?: boolean;
}) {
  return (
    <div className="mt-6 flex items-center gap-3">
      {onBack && (
        <button
          onClick={onBack}
          className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 px-4 py-2.5 text-[14px] font-medium text-white/60 transition-colors hover:text-white"
        >
          <ArrowLeft size={15} /> Back
        </button>
      )}
      <button
        onClick={onNext}
        disabled={nextDisabled || busy}
        className="ml-auto inline-flex items-center gap-2 rounded-xl bg-[#D3FB52] px-5 py-2.5 text-[14px] font-semibold text-[#002838] transition-colors hover:bg-[#c5f035] disabled:cursor-not-allowed disabled:opacity-40"
      >
        {busy ? <Loader2 size={15} className="animate-spin" /> : null}
        {nextLabel}
        {!busy && <ArrowRight size={15} />}
      </button>
    </div>
  );
}

function Dest({ href, icon, color, title, body }: {
  href: string; icon: React.ReactNode; color: string; title: string; body: string;
}) {
  return (
    <Link
      href={href}
      className="group flex items-center gap-4 rounded-2xl border border-white/[0.08] bg-white/[0.02] p-4 transition-colors hover:border-white/20 hover:bg-white/[0.05]"
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl" style={{ background: `${color}1f`, color }}>
        {icon}
      </span>
      <div className="min-w-0">
        <p className="text-[14.5px] font-semibold">{title}</p>
        <p className="text-[13px] text-white/45">{body}</p>
      </div>
      <ArrowRight size={16} className="ml-auto shrink-0 text-white/25 transition-colors group-hover:text-[#D3FB52]" />
    </Link>
  );
}
