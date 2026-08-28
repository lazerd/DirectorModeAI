import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, Sparkles } from 'lucide-react';
import { SectionShell, ToolCard } from '@/components/shared/SectionLanding';
import { findSection } from '@/config/nav';

/**
 * "Programs" section landing.
 *
 * MixerMode, LeagueMode and TournamentMode already share the same /mixer/*
 * engine and the same data model — they were only ever three doors into one
 * scheduler. So this page leads with a FORMAT PICKER (Mixer, Round robin,
 * League, JTT, Tournament, Quad, Ladder) rather than three separate products,
 * and keeps the brands underneath as the places the work lives.
 *
 * CaptainMode is the captain-facing view of LeagueMode's data, so it is linked
 * from inside Programs rather than sitting as a peer product in the nav.
 *
 * Every link below points at a route that already exists. No URL changed.
 */

export const metadata: Metadata = { title: 'Programs — ClubMode AI' };

type Format = {
  name: string;
  blurb: string;
  emoji: string;
  href?: string;
  /** Rendered flat and unclickable — the format is named in the taxonomy but not built yet. */
  comingSoon?: boolean;
};

const FORMATS: Format[] = [
  {
    name: 'Mixer',
    blurb: 'Social play, day-of. Rotate partners, fill the courts, no winner declared.',
    emoji: '🔀',
    href: '/mixer/events/new?format=doubles',
  },
  {
    name: 'Round robin',
    blurb: 'Everyone plays everyone. Standings by W–L, done in a day.',
    emoji: '🔁',
    href: '/mixer/tournaments/new?format=rr-doubles',
  },
  {
    name: 'League',
    blurb: 'Multi-week, new opponent each week, standings that build over a season.',
    emoji: '📅',
    href: '/mixer/leagues/new?type=rr-league',
  },
  {
    name: 'JTT',
    blurb: 'Junior Team Tennis. Club vs club, divisions, singles + doubles lines per matchup.',
    emoji: '🏟️',
    href: '/mixer/leagues/new?type=jtt',
  },
  {
    name: 'Tournament',
    blurb: 'Draws and brackets — single elim, consolation feeds, compass.',
    emoji: '🏆',
    href: '/mixer/select-format',
  },
  {
    name: 'Quad',
    blurb: 'Flights of four. Three singles round-robin, then doubles 1+4 vs 2+3.',
    emoji: '🎯',
    href: '/mixer/quads/new',
  },
  {
    name: 'Ladder',
    blurb: 'Standing challenge ladder — players climb by beating the rung above.',
    emoji: '🪜',
    comingSoon: true,
  },
];

function FormatCard({ f }: { f: Format }) {
  const body = (
    <>
      <div className="flex items-center gap-2.5">
        <span className="text-[19px] leading-none">{f.emoji}</span>
        <h3 className="text-[14.5px] font-semibold tracking-tight text-white">{f.name}</h3>
        {f.comingSoon && (
          <span className="ml-auto rounded-full border border-white/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white/35">
            Soon
          </span>
        )}
      </div>
      <p className="mt-2 text-[13px] leading-relaxed text-white/45">{f.blurb}</p>
    </>
  );

  if (f.comingSoon || !f.href) {
    return (
      <div className="rounded-2xl border border-dashed border-white/[0.08] bg-white/[0.01] p-4 opacity-70">
        {body}
      </div>
    );
  }
  return (
    <Link
      href={f.href}
      className="group rounded-2xl border border-white/[0.08] bg-white/[0.02] p-4 transition-colors hover:border-[#D3FB52]/40 hover:bg-white/[0.05]"
    >
      {body}
    </Link>
  );
}

export default function ProgramsSectionPage() {
  const section = findSection('programs')!;
  // CaptainMode is surfaced separately, below the engine products.
  const captain = section.tools.find((t) => t.name === 'CaptainMode')!;
  const products = section.tools.filter((t) => t.name !== 'CaptainMode');

  return (
    <SectionShell section={section}>
      {/* ---------- One engine, many formats ---------- */}
      <section className="mt-10">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">Start something</h2>
            <p className="mt-1 text-[13.5px] text-white/45">
              One scheduling engine. Pick the format and it sets up the right kind of event.
            </p>
          </div>
          <Link
            href="/mixer/select-format"
            className="inline-flex items-center gap-1.5 text-[13px] font-medium text-white/45 transition-colors hover:text-[#D3FB52]"
          >
            <Sparkles size={14} /> Compare every format
          </Link>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {FORMATS.map((f) => <FormatCard key={f.name} f={f} />)}
        </div>
      </section>

      {/* ---------- Where the work lives (brands preserved) ---------- */}
      <section className="mt-12">
        <h2 className="text-lg font-semibold tracking-tight">Where the work lives</h2>
        <p className="mt-1 text-[13.5px] text-white/45">
          Already running? Go straight to the board.
        </p>
        <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {products.map((t) => <ToolCard key={t.href} tool={t} />)}
        </div>
      </section>

      {/* ---------- CaptainMode: the captain-facing view of league data ---------- */}
      <section className="mt-10">
        <Link
          href={captain.href}
          className="group flex flex-col gap-3 rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5 transition-colors hover:border-white/20 hover:bg-white/[0.05] sm:flex-row sm:items-center sm:gap-5"
        >
          <span
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl"
            style={{ background: `${captain.color}1f` }}
          >
            <captain.icon size={21} style={{ color: captain.color }} />
          </span>
          <div className="min-w-0">
            <h3 className="text-[15px] font-semibold tracking-tight text-white">{captain.name}</h3>
            <p className="mt-1 text-[13.5px] leading-relaxed text-white/50">
              {captain.description} Same league data, pointed at the people who run the teams.
            </p>
          </div>
          <span className="inline-flex shrink-0 items-center gap-1.5 text-[13px] font-medium text-white/40 transition-colors group-hover:text-[#D3FB52] sm:ml-auto">
            Open <ArrowRight size={14} />
          </span>
        </Link>
      </section>
    </SectionShell>
  );
}
