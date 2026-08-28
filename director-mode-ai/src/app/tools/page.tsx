import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { ToolCard } from '@/components/shared/SectionLanding';
import {
  SECTIONS, FOR_PLAYERS, FOR_YOU, PRODUCTS, PRODUCT_COUNT,
} from '@/config/nav';

/**
 * /tools — the full directory, and the sixth item in the "Run the club" nav.
 *
 * The daily nav carries five plain-English sections. This page is where the full
 * breadth lives, so the rail never has to grow back into an 18-item scroll. If a
 * director learned a tool by its brand ("where did StringingMode go?"), this is
 * the page that answers.
 *
 * Every number and every card comes from PRODUCTS in src/config/nav.ts. Nothing
 * on this page is written by hand — that is the whole point, see "THE COUNT"
 * in that file.
 *
 * NOTE: ClubHub (/club-hub) is deliberately absent. The route still works if you
 * visit it directly — it is unlinked pending user volume. See src/app/club-hub.
 */

export const metadata: Metadata = {
  title: 'All tools — ClubMode AI',
  description: `All ${PRODUCT_COUNT} ClubMode tools, grouped by the job they do.`,
};

export default function AllToolsPage() {
  return (
    <div className="min-h-screen bg-[#001016] text-white" style={{ fontFamily: "'Inter', system-ui, sans-serif" }}>
      <div className="mx-auto max-w-5xl px-5 py-12 sm:px-8 sm:py-16">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/30">
          Run the club
        </p>
        <h1 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">All tools</h1>
        <p className="mt-2 max-w-xl text-[15px] leading-relaxed text-white/50">
          {PRODUCT_COUNT} tools, grouped the way the nav groups them. Know the product name
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

        {/* ---------- Space 3: For you ---------- */}
        <section className="mt-14 border-t border-white/[0.07] pt-10">
          <h2 className="text-lg font-semibold tracking-tight">For you</h2>
          <p className="mt-1 text-[13.5px] text-white/45">
            Your career, not the club&apos;s operations.
          </p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FOR_YOU.map((t) => <ToolCard key={t.href} tool={t} />)}
          </div>
        </section>

        {/* ---------- Space 2: For players ---------- */}
        <section className="mt-12 border-t border-white/[0.07] pt-10">
          <h2 className="text-lg font-semibold tracking-tight">For players</h2>
          <p className="mt-1 text-[13.5px] text-white/45">
            What your members see when they log in. These are member-facing views of the
            tools above, not extra tools — which is why they don&apos;t count toward the {PRODUCT_COUNT}.
          </p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FOR_PLAYERS.map((t) => <ToolCard key={t.href} tool={t} />)}
          </div>
        </section>

        <p className="mt-12 border-t border-white/[0.07] pt-6 text-[12.5px] text-white/25">
          {PRODUCTS.length} tools listed. This page, the homepage counter, the toolkit grid and
          the footer all read the same list — see src/config/nav.ts.
        </p>
      </div>
    </div>
  );
}
