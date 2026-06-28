'use client';

import Link from 'next/link';
import {
  Sparkles,
  ArrowRight,
  Gauge,
  Bot,
  MessageSquare,
  Mail,
  MonitorSmartphone,
  ShieldCheck,
  Check,
} from 'lucide-react';

export default function PricingPage() {
  return (
    <div className="min-h-screen bg-[#001820] text-white">
      <header className="border-b border-white/[0.06] sticky top-0 z-30 bg-[#001820]/95 backdrop-blur">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-yellow-300/20 flex items-center justify-center">
              <Sparkles size={16} className="text-yellow-300" />
            </div>
            <span className="font-display text-base">ClubMode</span>
          </Link>
          <Link href="/login" className="text-sm text-white/70 hover:text-white">Sign in</Link>
        </div>
      </header>

      {/* Hero */}
      <section className="max-w-3xl mx-auto px-6 pt-16 pb-8 text-center">
        <div className="inline-flex items-center gap-2 text-xs font-medium text-yellow-300/90 bg-yellow-300/10 border border-yellow-300/20 rounded-full px-3 py-1">
          <Gauge size={13} /> Pay only for what you use
        </div>
        <h1 className="mt-5 font-display text-4xl md:text-5xl tracking-tight">
          No subscription. <span className="text-yellow-300">Just a meter.</span>
        </h1>
        <p className="mt-4 text-white/60 max-w-xl mx-auto">
          Run your whole club by talking to ClubMode in plain English. Most of what you send is free —
          you only pay, pennies at a time, for the AI doing the work. A quiet winter costs almost nothing.
          No monthly fee for a tool you didn&apos;t touch.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/pricing/estimate"
            className="px-5 py-3 rounded-xl font-medium bg-yellow-300 text-[#001820] hover:bg-yellow-200 flex items-center justify-center gap-2"
          >
            <Gauge size={16} /> Estimate your monthly cost
          </Link>
          <Link
            href="/register"
            className="px-5 py-3 rounded-xl font-medium bg-white/10 hover:bg-white/15 text-white flex items-center justify-center gap-2"
          >
            Get started <ArrowRight size={16} />
          </Link>
        </div>
      </section>

      {/* Free */}
      <section className="max-w-5xl mx-auto px-6 pt-4 pb-2">
        <div className="text-center mb-5">
          <h2 className="font-display text-2xl">Free, always</h2>
          <p className="mt-1 text-white/50 text-sm">The everyday way you reach players costs you nothing.</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <FreeCard
            icon={<MonitorSmartphone size={18} className="text-emerald-400" />}
            title="The live event screen"
            desc="Court assignments, who's up next, live scores and standings — players watch it on their phone or the big screen at the club. No texting needed when everyone's right there."
          />
          <FreeCard
            icon={<Mail size={18} className="text-emerald-400" />}
            title="Email"
            desc="Announcements, event invites, lesson reminders, newsletters. Sent free, with fair-use limits — no per-email charge, ever."
          />
        </div>
      </section>

      {/* Metered */}
      <section className="max-w-5xl mx-auto px-6 pt-8 pb-2">
        <div className="text-center mb-5">
          <h2 className="font-display text-2xl">You only pay for these</h2>
          <p className="mt-1 text-white/50 text-sm">Pennies at a time, and only when they actually happen.</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <MeterCard
            icon={<Bot size={18} className="text-yellow-300" />}
            title="AI actions"
            price="pennies each"
            desc="Every time you ask ClubMode to do something — log scores, schedule a mixer, book a lesson, pull a board report — that's one action. This is the engine you're paying for."
          />
          <MeterCard
            icon={<MessageSquare size={18} className="text-yellow-300" />}
            title="Text messages"
            price="$0.05 each — only when you need them"
            desc="Just for reaching someone who isn't at the club: a lesson reminder for tomorrow, a 'your racket's ready' note, a reservation change. Most clubs send only a handful a month."
          />
        </div>
      </section>

      {/* Monthly maximum */}
      <section className="max-w-5xl mx-auto px-6 py-8">
        <div className="rounded-2xl border border-white/10 bg-[#002838] p-7">
          <div className="flex items-center gap-2 text-yellow-300">
            <ShieldCheck size={18} />
            <span className="font-display text-xl">You set your own monthly maximum</span>
          </div>
          <p className="mt-3 text-white/60 text-sm max-w-2xl">
            Pick a ceiling you&apos;re comfortable with. We&apos;ll warn you as you approach it, and you&apos;ll
            never be charged a penny more without your say-so. Hit your max mid-month and want to keep going?
            One tap raises it. It&apos;s a safety belt, not a wall — no surprise bills, ever.
          </p>
          <ul className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <Bullet>A live meter of exactly what you&apos;ve used and what you owe</Bullet>
            <Bullet>A heads-up at 80% of your monthly maximum</Bullet>
            <Bullet>No charge for AI work you didn&apos;t use</Bullet>
            <Bullet>Raise or lower your ceiling any time</Bullet>
          </ul>
        </div>
      </section>

      {/* Why not a subscription */}
      <section className="max-w-3xl mx-auto px-6 pb-20 text-center">
        <h2 className="font-display text-2xl">Why a meter instead of a monthly fee?</h2>
        <p className="mt-3 text-white/60 text-sm">
          A flat subscription makes you pay the same whether you ran ten events or none. With ClubMode you
          pay in your busy season and pay almost nothing when the courts are quiet. It&apos;s priced like a
          utility — fair when you&apos;re busy, nearly free when you&apos;re not.
        </p>
        <div className="mt-6">
          <Link
            href="/pricing/estimate"
            className="inline-flex items-center gap-1.5 text-sm text-yellow-300 hover:text-yellow-200"
          >
            <Gauge size={14} /> See what it would cost your club
          </Link>
        </div>
      </section>
    </div>
  );
}

function FreeCard({ icon, title, desc }: { icon: React.ReactNode; title: string; desc: string }) {
  return (
    <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/[0.04] p-6 flex flex-col">
      <div className="w-9 h-9 rounded-lg bg-emerald-400/10 flex items-center justify-center">{icon}</div>
      <div className="mt-4 font-display text-lg">{title}</div>
      <div className="mt-0.5 text-emerald-400 text-sm font-medium">Free</div>
      <p className="mt-3 text-white/50 text-sm leading-relaxed">{desc}</p>
    </div>
  );
}

function MeterCard({
  icon,
  title,
  price,
  desc,
}: {
  icon: React.ReactNode;
  title: string;
  price: string;
  desc: string;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-6 flex flex-col">
      <div className="w-9 h-9 rounded-lg bg-yellow-300/10 flex items-center justify-center">{icon}</div>
      <div className="mt-4 font-display text-lg">{title}</div>
      <div className="mt-0.5 text-yellow-300 text-sm font-medium">{price}</div>
      <p className="mt-3 text-white/50 text-sm leading-relaxed">{desc}</p>
    </div>
  );
}

function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2 text-sm text-white/80">
      <Check size={16} className="mt-0.5 flex-shrink-0 text-emerald-400" />
      <span>{children}</span>
    </li>
  );
}
