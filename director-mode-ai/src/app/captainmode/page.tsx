import type { Metadata } from 'next';
import Link from 'next/link';
import {
  ClipboardList, MessageSquareOff, HelpCircle, Zap, Users, Scale,
  ShieldCheck, CalendarClock, ArrowRight, Trophy, RefreshCw,
} from 'lucide-react';
import { APP_HOST } from '@/lib/appUrl';

/**
 * /captainmode — the public landing page for CaptainMode.
 *
 * PUBLIC ON PURPOSE, and the traffic is unusually well-qualified: the link at
 * the foot of every hosting email we send goes here, which means the reader is
 * a captain at another club who is doing this job by group text right now, in
 * season, and has just been shown what organised looks like.
 *
 * So the page is written for that person and no one else. It leads with their
 * week rather than our feature list, every claim is something the product
 * actually does (see CAPTAINMODE_SPEC.md), and the pricing is stated plainly
 * because a volunteer paying out of their own pocket will not chase a quote.
 */

export const metadata: Metadata = {
  title: 'CaptainMode — run your league team without the group text',
  description:
    'Availability, lineups, confirmations, subs and playoff eligibility for USTA and local-league captains. One tap for players, no logins, no spreadsheet.',
};

export default function CaptainModePage() {
  return (
    <div className="min-h-screen bg-[#001016] text-white" style={{ fontFamily: "'Inter', system-ui, sans-serif" }}>
      {/* ============================= HERO ============================= */}
      <section className="relative overflow-hidden px-5 py-20 sm:px-8 sm:py-28">
        <div
          aria-hidden
          className="pointer-events-none absolute -top-40 left-1/2 h-[32rem] w-[32rem] -translate-x-1/2 rounded-full bg-[#D3FB52]/[0.07] blur-3xl"
        />
        <div className="relative mx-auto max-w-3xl text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-[#D3FB52]/20 bg-[#D3FB52]/10 px-3 py-1 text-xs font-semibold tracking-wide text-[#D3FB52]">
            <ClipboardList size={13} /> CaptainMode
          </span>
          <h1 className="mt-6 text-4xl font-bold leading-[1.08] tracking-tight sm:text-6xl">
            You didn&apos;t volunteer to run
            <span className="block text-[#D3FB52]">a group text.</span>
          </h1>
          <p className="mx-auto mt-6 max-w-xl text-[17px] leading-relaxed text-white/55">
            Captaining is a real job nobody pays you for: chasing availability, building a lineup
            that keeps eight people happy, and finding a sub at 9pm the night before.
            CaptainMode does the chasing so you just make the calls.
          </p>
          <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              href="/register?next=/captain"
              className="inline-flex items-center gap-2 rounded-xl bg-[#D3FB52] px-7 py-3.5 font-semibold text-[#002838] transition-colors hover:bg-[#c5f035]"
            >
              Start free <ArrowRight size={17} />
            </Link>
            <a
              href="#week"
              className="inline-flex items-center gap-2 rounded-xl border border-white/12 px-7 py-3.5 font-medium text-white/75 transition-colors hover:border-white/30 hover:text-white"
            >
              See how a week works
            </a>
          </div>
          <p className="mt-4 text-[13px] text-white/35">
            Your players never create an account. Not one login, ever.
          </p>
        </div>
      </section>

      {/* ========================= BEFORE / AFTER ========================= */}
      <section className="border-t border-white/[0.06] px-5 py-16 sm:px-8 sm:py-20">
        <div className="mx-auto grid max-w-4xl gap-5 md:grid-cols-2">
          <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-7">
            <div className="flex items-center gap-2.5 text-white/40">
              <MessageSquareOff size={18} />
              <h2 className="text-sm font-semibold uppercase tracking-widest">This week, now</h2>
            </div>
            <ul className="mt-5 space-y-3 text-[15px] leading-relaxed text-white/45">
              <li>Text 12 people. Six reply. Two reply &ldquo;maybe?&rdquo;</li>
              <li>Text the six who didn&apos;t. Twice.</li>
              <li>Build the lineup in your head at 11pm, second-guessing who played least.</li>
              <li>Send it. Field &ldquo;wait, am I playing?&rdquo; from four people who are not.</li>
              <li>Someone bails Monday. Text nine subs one at a time.</li>
              <li>Realise Sally still needs two matches to qualify. Redo the lineup.</li>
            </ul>
          </div>
          <div className="rounded-2xl border border-[#D3FB52]/25 bg-[#D3FB52]/[0.04] p-7">
            <div className="flex items-center gap-2.5 text-[#D3FB52]">
              <Zap size={18} />
              <h2 className="text-sm font-semibold uppercase tracking-widest">This week, with CaptainMode</h2>
            </div>
            <ul className="mt-5 space-y-3 text-[15px] leading-relaxed text-white/75">
              <li>Tap <em>poll</em>. Everyone gets one email with three buttons.</li>
              <li>Non-responders get nudged automatically, 48 hours out.</li>
              <li>Tap <em>generate</em>. A legal, fair lineup appears. Drag to change anything.</li>
              <li>It emails the whole team, so nobody has to ask.</li>
              <li>Someone bails? One tap blasts every eligible sub. First to claim gets it.</li>
              <li>Eligibility and play counts are tracked for you, all season.</li>
            </ul>
          </div>
        </div>
      </section>

      {/* ============================ THE WEEK ============================ */}
      <section id="week" className="border-t border-white/[0.06] px-5 py-16 sm:px-8 sm:py-20">
        <div className="mx-auto max-w-4xl">
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">The weekly loop</h2>
          <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-white/50">
            This is the whole product. Everything else exists to support it.
          </p>

          <ol className="mt-10 space-y-4">
            <Step
              n="1"
              icon={<HelpCircle size={19} />}
              title="Ask who can play"
              body="One email per player: “Can you play Tue 7:00pm vs Diablo Valley (home)?” with Yes / No / Maybe buttons. One tap, no login, no app. You watch a live tally instead of scrolling a thread."
              detail="Anyone who hasn't answered is nudged automatically 48 hours before your deadline — the reminder you currently send by hand every single week."
            />
            <Step
              n="2"
              icon={<Users size={19} />}
              title="Build the lineup"
              body="Availability is a hard filter, so only players who said yes are considered. Then it stacks by strength, honours partner preferences, pairs a deuce-side player with an ad-side player, and balances who's played least."
              detail="Never-pair lists and court limits are never violated. Combined-rating caps for Combo and Mixed are enforced — it won't hand you an illegal 8.5 court. Override anything you like; it warns rather than blocks."
            />
            <Step
              n="3"
              icon={<CalendarClock size={19} />}
              title="Send it, a week out"
              body="The lineup goes to the whole team, not just the eight playing — which kills the “am I playing this week?” texts. Players who are in must tap Confirm."
              detail="So you find out about a bailer seven days early instead of on match morning."
            />
            <Step
              n="4"
              icon={<RefreshCw size={19} />}
              title="When someone drops"
              body="Mark them out. One click emails every eligible sub at once with a Claim button. First to tap gets the spot, everyone else sees “already filled,” and the lineup updates itself."
              detail="Eligibility is checked for you: the sub's rating has to fit the court and the league's rules, and they can't already be playing."
            />
            <Step
              n="5"
              icon={<Trophy size={19} />}
              title="After the match"
              body="Enter court-by-court scores. That feeds your record, everyone's match count, playoff eligibility, and which pairs actually win together."
              detail="Rained out? One button re-polls availability from scratch and rebuilds — because last week's answers were for a different day."
            />
          </ol>
        </div>
      </section>

      {/* ========================= DRAMA PREVENTION ========================= */}
      <section className="border-t border-white/[0.06] px-5 py-16 sm:px-8 sm:py-20">
        <div className="mx-auto max-w-4xl">
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
            The two things that cause every argument
          </h2>
          <div className="mt-9 grid gap-5 md:grid-cols-2">
            <Card
              icon={<Scale size={20} />}
              color="#fb923c"
              title="Who's played least"
              body="Matches played per player, visible at a glance, and fed straight into the generator. It's the number one source of team friction, and it's the one thing a spreadsheet never keeps current."
            />
            <Card
              icon={<ShieldCheck size={20} />}
              color="#34d399"
              title="Who still needs matches"
              body="USTA asks more matches of self-rated and appeal-rated players than computer-rated ones, and the number changes with how many lines your league plays. Set both thresholds once and you get warned in time: “Sally needs 1 more (1/2) — only 2 matches left.”"
              foot="Off by default. Plenty of leagues have no playoffs, and tracking nothing is better than tracking noise."
            />
          </div>
        </div>
      </section>

      {/* ============================ FORMATS ============================ */}
      <section className="border-t border-white/[0.06] px-5 py-16 sm:px-8 sm:py-20">
        <div className="mx-auto max-w-4xl">
          <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">It knows your league&apos;s rules</h2>
          <p className="mt-3 max-w-xl text-[15px] text-white/50">
            The lineup rules differ by format, and getting them wrong means a defaulted court.
          </p>
          <div className="mt-7 grid gap-3 sm:grid-cols-2">
            {[
              ['USTA Adult 18+ / 40+ / 55+', 'Singles and doubles courts at one NTRP level'],
              ['USTA Combo', 'Combined-rating caps per court — 7.5, 8.5, 9.5 — validated, not assumed'],
              ['USTA Mixed', 'Rating caps plus one man and one woman per pair'],
              ['USTA Tri-Level', 'Three NTRP levels, one court each'],
              ['TopDog & flex leagues', 'Looser formats, same weekly loop'],
              ['East Bay Women&apos;s Tennis', 'Local-league friendly, no playoff tracking needed'],
            ].map(([name, note]) => (
              <div key={name} className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4">
                <p className="text-[14.5px] font-semibold" dangerouslySetInnerHTML={{ __html: name }} />
                <p className="mt-1 text-[13px] leading-relaxed text-white/45">{note}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ============================ PRICING ============================ */}
      <section className="border-t border-white/[0.06] px-5 py-16 sm:px-8 sm:py-20">
        <div className="mx-auto max-w-3xl text-center">
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">You pay, not your club</h2>
          <p className="mx-auto mt-3 max-w-lg text-[15px] leading-relaxed text-white/50">
            Your own card, no committee, no approval. Up to three teams. Co-captains are free.
          </p>

          <div className="mt-9 grid gap-4 sm:grid-cols-2">
            <div className="rounded-2xl border border-[#D3FB52]/30 bg-[#D3FB52]/[0.05] p-7 text-left">
              <p className="text-[13px] font-semibold uppercase tracking-widest text-[#D3FB52]">
                Your club uses ClubMode
              </p>
              <p className="mt-3 text-4xl font-bold">
                $10<span className="text-base font-normal text-white/40"> / month</span>
              </p>
              <p className="mt-3 text-[14px] leading-relaxed text-white/55">
                Half price, because your club already carries the platform.
              </p>
            </div>
            <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-7 text-left">
              <p className="text-[13px] font-semibold uppercase tracking-widest text-white/40">
                Your club doesn&apos;t
              </p>
              <p className="mt-3 text-4xl font-bold">
                $20<span className="text-base font-normal text-white/40"> / month</span>
              </p>
              <p className="mt-3 text-[14px] leading-relaxed text-white/55">
                Works exactly the same. And it&apos;s a decent argument to bring your director.
              </p>
            </div>
          </div>

          <div className="mt-10">
            <Link
              href="/register?next=/captain"
              className="inline-flex items-center gap-2 rounded-xl bg-[#D3FB52] px-8 py-4 font-semibold text-[#002838] transition-colors hover:bg-[#c5f035]"
            >
              Start free <ArrowRight size={17} />
            </Link>
            <p className="mt-4 text-[13px] text-white/35">
              Set your team up in a few minutes. Send one availability poll and see what happens.
            </p>
          </div>
        </div>
      </section>

      {/* ============================= FOOTER ============================= */}
      <footer className="border-t border-white/[0.06] px-5 py-10 sm:px-8">
        <div className="mx-auto flex max-w-4xl flex-col items-center justify-between gap-3 text-[13px] text-white/30 sm:flex-row">
          <p>
            CaptainMode is part of{' '}
            <Link href="/" className="text-white/50 underline hover:text-white">
              {APP_HOST}
            </Link>{' '}
            — the platform clubs use to run courts, leagues and lessons.
          </p>
          <div className="flex items-center gap-4">
            <Link href="/terms" className="hover:text-white/60">Terms</Link>
            <Link href="/privacy" className="hover:text-white/60">Privacy</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

function Step({
  n, icon, title, body, detail,
}: {
  n: string; icon: React.ReactNode; title: string; body: string; detail?: string;
}) {
  return (
    <li className="flex gap-5 rounded-2xl border border-white/[0.07] bg-white/[0.02] p-6">
      <div className="flex flex-col items-center gap-2">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#D3FB52]/10 text-[#D3FB52]">
          {icon}
        </span>
        <span className="text-[11px] font-bold text-white/20">{n}</span>
      </div>
      <div className="min-w-0">
        <h3 className="text-[17px] font-semibold tracking-tight">{title}</h3>
        <p className="mt-1.5 text-[15px] leading-relaxed text-white/60">{body}</p>
        {detail && (
          <p className="mt-2.5 border-l-2 border-[#D3FB52]/30 pl-3 text-[13.5px] leading-relaxed text-white/40">
            {detail}
          </p>
        )}
      </div>
    </li>
  );
}

function Card({
  icon, color, title, body, foot,
}: {
  icon: React.ReactNode; color: string; title: string; body: string; foot?: string;
}) {
  return (
    <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-7">
      <span
        className="flex h-11 w-11 items-center justify-center rounded-xl"
        style={{ background: `${color}1f`, color }}
      >
        {icon}
      </span>
      <h3 className="mt-4 text-[17px] font-semibold tracking-tight">{title}</h3>
      <p className="mt-2 text-[15px] leading-relaxed text-white/55">{body}</p>
      {foot && <p className="mt-3 text-[13px] leading-relaxed text-white/35">{foot}</p>}
    </div>
  );
}
