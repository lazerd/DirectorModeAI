/**
 * Public /unsubscribe page.
 *
 * Visiting /unsubscribe?token=<signed> verifies the HMAC token from the email
 * footer and SHOWS a button. The write happens in POST /api/unsubscribe.
 *
 * It used to opt the address out on the GET itself, so a link scanner, a mail
 * app's preview fetch or a prefetch could unsubscribe someone who never
 * clicked. That is how Darrin's own address ended up on the list on
 * 2026-09-08, and eight days of his captain alerts went nowhere. A GET renders;
 * only a posted form changes anything.
 */

import Link from 'next/link';
import { Trophy, Check, AlertCircle } from 'lucide-react';
import { verifyUnsubscribeToken, isUnsubscribed } from '@/lib/emailUnsubscribe';

export const dynamic = 'force-dynamic';

type SearchParams = Promise<{ token?: string; state?: string; m?: string }>;

export default async function UnsubscribePage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { token, state: posted, m } = await searchParams;
  const payload = token ? verifyUnsubscribeToken(token) : null;

  let state:
    | 'no-token'
    | 'invalid-token'
    | 'confirm'
    | 'unsubscribed'
    | 'resubscribed'
    | 'error' = 'no-token';
  const errorMessage = m || '';
  let email: string | null = null;

  if (!token) {
    state = 'no-token';
  } else if (!payload) {
    state = 'invalid-token';
  } else {
    email = payload.email;
    // Only POST /api/unsubscribe writes; this page reflects what it did, or
    // asks. An address already on the list reads as unsubscribed either way.
    if (posted === 'unsubscribed' || posted === 'resubscribed' || posted === 'error') {
      state = posted;
    } else {
      state = (await isUnsubscribed(payload.email)) ? 'unsubscribed' : 'confirm';
    }
  }

  return (
    <div className="min-h-screen bg-[#001820] text-white flex items-center justify-center p-4">
      <div className="max-w-md w-full">
        <div className="flex items-center justify-center mb-8">
          <div className="w-12 h-12 rounded-xl bg-[#D3FB52] flex items-center justify-center">
            <Trophy size={24} className="text-[#002838]" />
          </div>
        </div>

        <div className="bg-[#002838] border border-white/10 rounded-2xl p-6 sm:p-8">
          {state === 'no-token' && (
            <>
              <div className="flex items-center gap-2 text-yellow-400 mb-3">
                <AlertCircle size={20} />
                <h1 className="text-lg font-semibold">Missing unsubscribe link</h1>
              </div>
              <p className="text-sm text-white/60">
                This page was opened without a valid unsubscribe token. If you arrived
                here from an email, please click the link in the email again.
              </p>
            </>
          )}

          {state === 'invalid-token' && (
            <>
              <div className="flex items-center gap-2 text-red-400 mb-3">
                <AlertCircle size={20} />
                <h1 className="text-lg font-semibold">Invalid or expired link</h1>
              </div>
              <p className="text-sm text-white/60">
                We couldn&apos;t verify this unsubscribe link. It may have been
                tampered with, or the signing key has rotated. If you&apos;d still
                like to stop receiving emails, reply to any email you&apos;ve
                received from us with the word &quot;unsubscribe&quot; and we&apos;ll
                handle it manually.
              </p>
            </>
          )}

          {state === 'confirm' && email && (
            <>
              <h1 className="text-lg font-semibold mb-3">Stop these emails?</h1>
              <p className="text-sm text-white/70 mb-4">
                <span className="font-mono text-white">{email}</span> will stop receiving match
                reminders, lesson notifications, event invites and bracket updates.
              </p>
              <form method="POST" action="/api/unsubscribe">
                <input type="hidden" name="token" value={token} />
                <button
                  type="submit"
                  className="inline-block px-4 py-2.5 text-sm font-semibold rounded-lg bg-[#D3FB52] text-[#001820]"
                >
                  Unsubscribe {email}
                </button>
              </form>
              <p className="text-xs text-white/40 mt-4">
                Nothing has changed yet — this takes effect when you press the button.
              </p>
            </>
          )}

          {state === 'unsubscribed' && email && (
            <>
              <div className="flex items-center gap-2 text-[#D3FB52] mb-3">
                <Check size={20} />
                <h1 className="text-lg font-semibold">You&apos;re unsubscribed</h1>
              </div>
              <p className="text-sm text-white/70 mb-4">
                <span className="font-mono text-white">{email}</span> will no longer
                receive transactional emails from ClubMode AI — match reminders,
                lesson notifications, event invites, and bracket updates are all
                turned off.
              </p>
              <p className="text-xs text-white/40 mb-6">
                You&apos;ll still receive emails that are legally required (e.g.
                payment receipts) and any email where another player directly
                contacts you through the platform.
              </p>
              <p className="text-xs text-white/50 mb-2">Changed your mind?</p>
              <form method="POST" action="/api/unsubscribe">
                <input type="hidden" name="token" value={token} />
                <input type="hidden" name="action" value="resubscribe" />
                <button
                  type="submit"
                  className="inline-block px-4 py-2 text-sm border border-white/20 rounded-lg hover:bg-white/5 text-white/80"
                >
                  Resubscribe
                </button>
              </form>
            </>
          )}

          {state === 'resubscribed' && email && (
            <>
              <div className="flex items-center gap-2 text-[#D3FB52] mb-3">
                <Check size={20} />
                <h1 className="text-lg font-semibold">You&apos;re subscribed again</h1>
              </div>
              <p className="text-sm text-white/70">
                Welcome back. <span className="font-mono text-white">{email}</span>{' '}
                will once again receive match reminders, lesson notifications, and
                event updates.
              </p>
            </>
          )}

          {state === 'error' && (
            <>
              <div className="flex items-center gap-2 text-red-400 mb-3">
                <AlertCircle size={20} />
                <h1 className="text-lg font-semibold">Something went wrong</h1>
              </div>
              <p className="text-sm text-white/60">
                We couldn&apos;t process your unsubscribe request: {errorMessage}.
                Please try again in a moment, or reply to any email from us and
                we&apos;ll handle it manually.
              </p>
            </>
          )}
        </div>

        <div className="text-center mt-6 text-xs text-white/30">
          <Link href="/" className="hover:text-white/50">
            ClubMode AI
          </Link>
        </div>
      </div>
    </div>
  );
}
