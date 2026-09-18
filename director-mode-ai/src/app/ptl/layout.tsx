/**
 * The Premier Tennis League shell.
 *
 * PTL is a standalone product wearing its own clothes — none of the ClubMode
 * chrome appears here. `/ptl` is added to PUBLIC_PREFIXES in ClubSidebar so the
 * director rail, the assistant widget and the live events bar all stay out of
 * it; this layout paints the rest.
 *
 * The app shell's body is dark teal, and every public surface in this codebase
 * has to paint its own background or it inherits that. PTL commits to a single
 * dark world on purpose: the live draft board is projected on a wall in a room
 * with the lights down, and a league that looks one way on the board and
 * another way on the standings page looks like two products.
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import { PtlCrest } from '@/components/ptl/Crest';
import { APP_URL } from '@/lib/appUrl';

export const metadata: Metadata = {
  title: 'Premier Tennis League',
  description:
    'A 5.0+ drafted-team league built around a three-hour night. Players enroll individually, '
    + 'captains draft balanced rosters, and a division of four plays a full round robin in one night.',
  alternates: { canonical: `${APP_URL}/ptl` },
  icons: { icon: '/ptl/icon.svg' },
  openGraph: {
    title: 'Premier Tennis League',
    description: 'A 5.0+ drafted-team league built around a three-hour night.',
    siteName: 'Premier Tennis League',
  },
};

const NAV = [
  { href: '/ptl', label: 'The League' },
  { href: '/ptl/standings', label: 'Standings' },
  { href: '/ptl/schedule', label: 'Schedule' },
  { href: '/ptl/draft/board', label: 'Draft Board' },
];

export default function PtlLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="min-h-screen"
      style={{
        // Tokens the crest reads. Setting them here means every crest on every
        // PTL page is correct without being told, and changing the league
        // colour is one line.
        ['--ptl-accent' as string]: '#2DD4BF',
        ['--ptl-field' as string]: '#0B0F14',
        background: '#0B0F14',
        color: '#E9EEF2',
        fontFamily: 'Archivo, "Helvetica Neue", Arial, sans-serif',
      }}
    >
      <header className="border-b border-white/10">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-8 gap-y-4 px-5 py-5">
          <Link href="/ptl" className="shrink-0" aria-label="Premier Tennis League — home">
            <PtlCrest variant="horizontal" width={300} byline title={null} />
          </Link>

          <nav className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm sm:ml-auto">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="tracking-wide text-white/65 transition-colors hover:text-white"
              >
                {item.label}
              </Link>
            ))}
            <Link
              href="/ptl/enroll"
              className="rounded-sm bg-teal-400 px-4 py-2 text-sm font-bold tracking-wide text-[#06231F] transition-colors hover:bg-teal-300"
            >
              Enroll
            </Link>
          </nav>
        </div>
      </header>

      {children}

      <footer className="mt-24 border-t border-white/10">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 px-5 py-10 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <PtlCrest variant="lockup" width={150} byline title={null} />
          </div>
          <div className="text-xs leading-relaxed text-white/45">
            <p className="max-w-sm">
              Premier Tennis League is a 5.0 and above drafted-team league. Every match is USTA
              sanctioned and counts toward your rating.
            </p>
            <p className="mt-3">
              Run on <span className="text-white/70">ClubMode</span>.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
