'use client';

/**
 * /invite/[token] — where an invited pro or member lands.
 *
 * Says who invited them, to what, and as what, BEFORE asking them to sign in —
 * an invitation that opens on a login wall gets closed. Signed out, it carries
 * the destination through login and signup so they come back here and land in
 * the right place.
 *
 * PAINTS ITS OWN LIGHT BACKGROUND: the app shell sets a dark navy body.
 */

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Check, Loader2, UserPlus } from 'lucide-react';

type Info = {
  club_name: string;
  role: string;
  role_label: string;
  invited_name: string | null;
  invited_email: string;
  note: string | null;
  signed_in_as: string | null;
  email_matches: boolean;
};

export default function InvitePage() {
  const token = useParams()?.token as string;
  const router = useRouter();
  const [info, setInfo] = useState<Info | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [accepting, setAccepting] = useState(false);
  const [done, setDone] = useState<{ next: string } | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/clubs/invites/accept?token=${encodeURIComponent(token)}`, {
      cache: 'no-store',
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(j.error || 'That invitation link is not valid.');
      setLoading(false);
      return;
    }
    setInfo(j as Info);
    setLoading(false);
  }, [token]);

  useEffect(() => {
    if (token) load();
  }, [token, load]);

  const accept = async () => {
    setAccepting(true);
    setError(null);
    const res = await fetch('/api/clubs/invites/accept', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    const j = await res.json().catch(() => ({}));
    setAccepting(false);
    if (!res.ok) {
      setError(j.error || 'Could not accept that invitation.');
      return;
    }
    setDone({ next: (j.next as string) || '/' });
    setTimeout(() => router.push((j.next as string) || '/'), 1200);
  };

  const signInHref = `/login?redirect=${encodeURIComponent(`/invite/${token}`)}`;

  return (
    <div style={{ background: '#f1f5f9', minHeight: '100vh' }}>
      <div style={{ maxWidth: 460, margin: '0 auto', padding: '64px 18px' }}>
        <div className="rounded-2xl bg-white p-7 shadow-sm">
          {loading ? (
            <p className="flex items-center gap-2 text-slate-500">
              <Loader2 size={16} className="animate-spin" /> Checking your invitation…
            </p>
          ) : done ? (
            <>
              <div className="flex items-center gap-2 text-emerald-600">
                <Check size={20} />
                <h1 className="text-lg font-semibold">You&apos;re in</h1>
              </div>
              <p className="mt-2 text-[15px] leading-relaxed text-slate-600">
                Welcome to {info?.club_name}. Taking you to your{' '}
                {info?.role === 'coach' ? 'lesson setup' : 'club'}…
              </p>
            </>
          ) : error && !info ? (
            <>
              <h1 className="text-lg font-semibold text-slate-900">Invitation not valid</h1>
              <p className="mt-2 text-[15px] leading-relaxed text-slate-600">{error}</p>
            </>
          ) : info ? (
            <>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-900 px-2.5 py-1 text-[12px] font-semibold text-white">
                <UserPlus size={12} /> {info.role_label}
              </span>
              <h1 className="mt-3 text-[22px] font-bold leading-tight tracking-tight text-slate-900">
                {info.invited_name ? `${info.invited_name}, you're` : "You're"} invited to{' '}
                {info.club_name}
              </h1>
              <p className="mt-2 text-[15px] leading-relaxed text-slate-600">
                {info.role === 'coach'
                  ? 'Accepting sets you up to take lesson bookings — members will be able to book the times you open up.'
                  : info.role === 'member'
                    ? 'Accepting lets you book courts, sign up for events and follow your club.'
                    : 'Accepting gives you access to the club’s tools.'}
              </p>

              {info.note && (
                <p className="mt-3 rounded-lg border-l-[3px] border-[#D3FB52] bg-slate-50 px-3 py-2.5 text-[14px] leading-relaxed text-slate-700">
                  {info.note}
                </p>
              )}

              {!info.signed_in_as ? (
                <>
                  <a
                    href={signInHref}
                    className="mt-5 block w-full rounded-xl bg-slate-900 px-5 py-3 text-center text-[15px] font-semibold text-white"
                  >
                    Sign in or create an account
                  </a>
                  <p className="mt-2 text-center text-[12.5px] text-slate-500">
                    Use <strong>{info.invited_email}</strong> — this invitation is for that address.
                  </p>
                </>
              ) : info.email_matches ? (
                <button
                  onClick={accept}
                  disabled={accepting}
                  className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 px-5 py-3 text-[15px] font-semibold text-white disabled:opacity-50"
                >
                  {accepting ? <Loader2 size={15} className="animate-spin" /> : null}
                  Join {info.club_name}
                </button>
              ) : (
                <div className="mt-5 rounded-xl bg-amber-50 p-4 text-[14px] leading-relaxed text-amber-900">
                  This invitation was sent to <strong>{info.invited_email}</strong>, but you&apos;re
                  signed in as <strong>{info.signed_in_as}</strong>. Sign out and sign back in with
                  the invited address, or ask for a new invitation to this one.
                  <a href={signInHref} className="mt-2 block font-semibold underline">
                    Switch account
                  </a>
                </div>
              )}

              {error && (
                <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-[13.5px] text-red-700">
                  {error}
                </p>
              )}
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
