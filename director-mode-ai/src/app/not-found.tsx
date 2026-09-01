import Link from 'next/link';
import { Zap, ArrowRight } from 'lucide-react';

/**
 * The 404 a stranger sees.
 *
 * There was no not-found.tsx anywhere in the app, so a mistyped URL — or a
 * stale link out of an old email — served the stock unbranded Next.js
 * "404: This page could not be found." on white. For someone arriving from a
 * cold email that reads as a dead site, not a mistyped address.
 */
export default function NotFound() {
  return (
    <div
      className="flex min-h-screen items-center justify-center bg-[#001016] px-5 text-white"
      style={{ fontFamily: "'Inter', system-ui, sans-serif" }}
    >
      <div className="w-full max-w-md text-center">
        <Link href="/" className="inline-flex items-center gap-2.5">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#D3FB52]">
            <Zap className="text-[#002838]" size={20} />
          </span>
          <span className="text-[19px] font-bold tracking-tight">
            ClubMode<span className="text-[#D3FB52]"> AI</span>
          </span>
        </Link>

        <p className="mt-10 text-[13px] font-semibold uppercase tracking-[0.16em] text-white/30">
          404
        </p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">This page doesn&apos;t exist</h1>
        <p className="mt-3 text-[15px] leading-relaxed text-white/50">
          The link may be out of date, or the address slightly off. Nothing is broken —
          you&apos;re just somewhere that isn&apos;t a page.
        </p>

        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link
            href="/"
            className="inline-flex items-center gap-2 rounded-xl bg-[#D3FB52] px-6 py-3 font-semibold text-[#002838] transition-colors hover:bg-[#c5f035]"
          >
            Go to ClubMode <ArrowRight size={16} />
          </Link>
          <Link
            href="/login"
            className="inline-flex items-center gap-2 rounded-xl border border-white/12 px-6 py-3 font-medium text-white/75 transition-colors hover:border-white/30 hover:text-white"
          >
            Sign in
          </Link>
        </div>

        {/* A player who lands here came from a tokenized link that has moved or
            expired, and has no idea what to do next. */}
        <p className="mt-8 text-[13px] text-white/30">
          Following a link from your club? Ask them to resend it — scoring and signup links
          are personal to you.
        </p>
      </div>
    </div>
  );
}
