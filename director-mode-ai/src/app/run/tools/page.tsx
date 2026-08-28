import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { ToolCard } from '@/components/shared/SectionLanding';
import { SECTIONS, FOR_PLAYERS, FOR_YOU } from '@/config/nav';

/**
 * "All tools" — the sixth "Run the club" nav item, and the escape hatch from the
 * five-section grouping. Every product in ClubMode is on this page, under the
 * section it now lives in, with its brand name intact.
 *
 * Nothing is hidden by the reorganisation: if a director learned a tool by its
 * brand ("where's StringingMode?"), this page is where they find it again.
 *
 * NOTE: ClubHub (/club-hub) is deliberately absent. The route still works if you
 * visit it directly — it is unlinked pending user volume. See src/app/club-hub.
 */

export const metadata: Metadata = { title: 'All tools — ClubMode AI' };

export default function AllToolsPage() {
  return (
    <div className="min-h-screen bg-[#001016] text-white" style={{ fontFamily: "'Inter', system-ui, sans-serif" }}>
      <div className="mx-auto max-w-5xl px-5 py-12 sm:px-8 sm:py-16">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/30">
          Run the club
        </p>
        <h1 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">All tools</h1>
        <p className="mt-2 max-w-xl text-[15px] leading-relaxed text-white/50">
          Everything ClubMode does, grouped the way the nav groups it. Know the product name
          but not the section? Start here.
        </p>

        {/* ---------- Space 1: Run the club ---------- */}
        {SECTIONS.map((s) => (
          <section key={s.key} className="mt-12">
            <div className="flex items-center gap-3">
              <span
                className="flex h-9 w-9 items-center justify-center rounded-xl"
                style={{ background: `${s.color}1f` }}
              >
                <s.icon size={18} style={{ color: s.color }} />
              </span>
              <h2 className="text-lg font-semibold tracking-tight">{s.label}</h2>
              <Link
                href={s.href}
                className="ml-auto inline-flex items-center gap-1.5 text-[13px] font-medium text-white/35 transition-colors hover:text-white"
              >
                Section <ArrowRight size={13} />
              </Link>
            </div>
            <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {s.tools.map((t) => <ToolCard key={t.href} tool={t} />)}
            </div>
          </section>
        ))}

        {/* ---------- Space 2: For players ---------- */}
        <section className="mt-14 border-t border-white/[0.07] pt-10">
          <h2 className="text-lg font-semibold tracking-tight">For players</h2>
          <p className="mt-1 text-[13.5px] text-white/45">
            What your members see when they log in.
          </p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FOR_PLAYERS.map((t) => <ToolCard key={t.href} tool={t} />)}
          </div>
        </section>

        {/* ---------- Space 3: For you ---------- */}
        <section className="mt-12 border-t border-white/[0.07] pt-10">
          <h2 className="text-lg font-semibold tracking-tight">For you</h2>
          <p className="mt-1 text-[13.5px] text-white/45">
            Your career, not the club&apos;s operations.
          </p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FOR_YOU.map((t) => <ToolCard key={t.href} tool={t} />)}
          </div>
        </section>
      </div>
    </div>
  );
}
