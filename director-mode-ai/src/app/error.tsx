'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { Zap, RefreshCw, ArrowRight } from 'lucide-react';

/**
 * The screen a customer sees when something throws.
 *
 * There was no error boundary anywhere in the app, so any uncaught exception
 * rendered React's raw error screen — a stack trace in production, and a blank
 * white page with a dev-tools overlay in development. This catches it once, at
 * the root, and says something a non-engineer can act on.
 *
 * Deliberately does NOT print the error text: it can carry ids, emails or
 * query fragments, and a stranger reading a stack trace on a first visit is
 * worse than reading nothing. The digest is shown because it is the one thing
 * that makes a support message diagnosable.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Reaches the Vercel function logs with a stack, unlike the rendered page.
    console.error('Unhandled error boundary:', error);
  }, [error]);

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

        <h1 className="mt-10 text-3xl font-bold tracking-tight">Something went wrong</h1>
        <p className="mt-3 text-[15px] leading-relaxed text-white/50">
          That&apos;s on us, not on you. Nothing you did caused it and nothing you entered
          was lost — try again, and if it keeps happening let us know.
        </p>

        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <button
            onClick={reset}
            className="inline-flex items-center gap-2 rounded-xl bg-[#D3FB52] px-6 py-3 font-semibold text-[#002838] transition-colors hover:bg-[#c5f035]"
          >
            <RefreshCw size={16} /> Try again
          </button>
          <Link
            href="/"
            className="inline-flex items-center gap-2 rounded-xl border border-white/12 px-6 py-3 font-medium text-white/75 transition-colors hover:border-white/30 hover:text-white"
          >
            Back to ClubMode <ArrowRight size={16} />
          </Link>
        </div>

        {error.digest && (
          <p className="mt-8 font-mono text-[12px] text-white/25">
            Reference: {error.digest}
          </p>
        )}
      </div>
    </div>
  );
}
