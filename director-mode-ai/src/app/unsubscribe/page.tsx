/**
 * Public /unsubscribe page.
 *
 * Visiting /unsubscribe?token=<signed> verifies the HMAC token from the
 * email footer and, if valid, inserts a row into email_unsubscribes for
 * that address. Once the row exists, safeResendSend short-circuits every
 * future email to that recipient.
 *
 * One-click via GET — visiting the link is enough. Offers a "resubscribe"
 * form (POST-style via a nested route) in case they change their mind.
 * Unknown / tampered tokens show a friendly error.
 */

import Link from 'next/link';
import { Trophy, Check, AlertCircle } from 'lucide-react';
import {
  verifyUnsubscribeToken,
  recordUnsubscribe,
  removeUnsubscribe,
  isUnsubscribed,
} from '@/lib/emailUnsubscribe';

export const dynamic = 'force-dynamic';

type SearchParams = Promise<{ token?: string; action?: string }>;

export default async function UnsubscribePage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { token, action } = await searchParams;
  const payload = token ? verifyUnsubscribeToken(token) : null;

  let state:
    | 'no-token'
    | 'invalid-token'
    | 'unsubscribed'
    | 'resubscribed'
    | 'error' = 'no-token';
  let errorMessage = '';
  let email: string | null = null;

  if (!token) {
    state = 'no-token';
  } else if (!payload) {
    state = 'invalid-token';
  } else {
    email = payload.email;
    if (action === 'resubscribe') {
      const result = await removeUnsubscribe(payload.email, payload.scope);
      if (result.success) {
        state = 'resubscribed';
      } else {
        state = 'error';
        errorMessage = result.error || 'Failed to resubscribe';
      }
    } else {
      // Default action is unsubscribe. Idempotent — if they already were
      // unsubscribed, we still show the confirmation.
      const already = await isUnsubscribed(payload.email);
      if (!already) {
        const result = await recordUnsubscribe(payload.email, payload.scope);
        if (!result.success) {
          state = 'error';
          errorMessage = result.error || 'Failed to unsubscribe';
        } else {
          state = 'unsubscribed';
        }
      } else {
        state = 'unsubscribed';
      }
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
              <Link
                href={`/unsubscribe?token=${token}&action=resubscribe`}
                className="inline-block px-4 py-2 text-sm border border-white/20 rounded-lg hover:bg-white/5 text-white/80"
              >
                Resubscribe
              </Link>
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
