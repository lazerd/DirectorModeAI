import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import type { Section, Tool } from '@/config/nav';

/**
 * SectionLanding — the shared shell for a "Run the club" section page (/run/*).
 *
 * The nav label above the fold is plain English ("Courts", "Programs", ...); the
 * cards below it carry the product BRANDS (CourtSheet, MixerMode, StringingMode,
 * ...). That split is the whole point of the section layer: directors navigate by
 * job-to-be-done, and still meet the branded product once they arrive.
 *
 * Every card links to the tool's existing URL — no route moved.
 */

export function ToolCard({ tool }: { tool: Tool }) {
  const Icon = tool.icon;
  return (
    <Link
      href={tool.href}
      className="group relative flex flex-col gap-3 rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5 transition-colors hover:border-white/20 hover:bg-white/[0.05]"
    >
      <span
        className="flex h-11 w-11 items-center justify-center rounded-xl"
        style={{ background: `${tool.color}1f` }}
      >
        <Icon size={21} style={{ color: tool.color }} />
      </span>
      <div>
        {/* Product brand — preserved verbatim. */}
        <h3 className="text-[15px] font-semibold tracking-tight text-white">{tool.name}</h3>
        <p className="mt-1.5 text-[13.5px] leading-relaxed text-white/50">{tool.description}</p>
      </div>
      <span className="mt-auto inline-flex items-center gap-1.5 pt-1 text-[13px] font-medium text-white/40 transition-colors group-hover:text-[#D3FB52]">
        Open <ArrowRight size={14} />
      </span>
    </Link>
  );
}

export function SectionShell({
  section,
  children,
}: {
  section: Section;
  children?: React.ReactNode;
}) {
  const Icon = section.icon;
  return (
    <div className="min-h-screen bg-[#001016] text-white" style={{ fontFamily: "'Inter', system-ui, sans-serif" }}>
      <div className="mx-auto max-w-5xl px-5 py-12 sm:px-8 sm:py-16">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/30">
          Run the club
        </p>
        <div className="mt-3 flex items-start gap-4">
          <span
            className="mt-0.5 flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl"
            style={{ background: `${section.color}1f` }}
          >
            <Icon size={24} style={{ color: section.color }} />
          </span>
          <div>
            <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{section.label}</h1>
            <p className="mt-2 max-w-xl text-[15px] leading-relaxed text-white/50">{section.blurb}</p>
          </div>
        </div>

        {children}

        <div className="mt-12 border-t border-white/[0.07] pt-6">
          <Link
            href="/tools"
            className="inline-flex items-center gap-1.5 text-[13.5px] font-medium text-white/40 transition-colors hover:text-white"
          >
            See all tools <ArrowRight size={14} />
          </Link>
        </div>
      </div>
    </div>
  );
}

/** The default section body: one card per tool. */
export default function SectionLanding({ section }: { section: Section }) {
  return (
    <SectionShell section={section}>
      <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {section.tools.map((t) => <ToolCard key={t.href} tool={t} />)}
      </div>
    </SectionShell>
  );
}
