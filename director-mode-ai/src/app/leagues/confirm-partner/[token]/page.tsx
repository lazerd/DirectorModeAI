'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Trophy, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';

type ConfirmState =
  | { status: 'loading' }
  | { status: 'success'; partnerName: string; captainName: string; alreadyConfirmed?: boolean }
  | { status: 'error'; message: string };

export default function ConfirmPartnerPage() {
  const params = useParams();
  const token = Array.isArray(params.token) ? params.token[0] : params.token;
  const [state, setState] = useState<ConfirmState>({ status: 'loading' });

  useEffect(() => {
    if (!token) {
      setState({ status: 'error', message: 'Missing token in URL.' });
      return;
    }
    (async () => {
      try {
        const res = await fetch('/api/leagues/confirm-partner', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        });
        const data = await res.json();
        if (!res.ok) {
          setState({ status: 'error', message: data.error || `HTTP ${res.status}` });
          return;
        }
        setState({
          status: 'success',
          partnerName: data.partnerName,
          captainName: data.captainName,
          alreadyConfirmed: data.alreadyConfirmed,
        });
      } catch (err: any) {
        setState({ status: 'error', message: err?.message || 'Network error' });
      }
    })();
  }, [token]);

  return (
    <div className="min-h-screen bg-[#001820] text-white flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        <div className="flex items-center justify-center gap-2.5 mb-8">
          <div className="w-10 h-10 rounded-xl bg-[#D3FB52] flex items-center justify-center">
            <Trophy size={22} className="text-[#002838]" />
          </div>
          <span className="font-display text-2xl">CoachMode Leagues</span>
        </div>

        <div className="bg-white/5 border border-white/10 rounded-xl p-6 sm:p-8 text-center">
          {state.status === 'loading' && (
            <>
              <Loader2 size={28} className="animate-spin mx-auto text-[#D3FB52] mb-4" />
              <h1 className="font-semibold text-xl mb-2">Confirming partnership…</h1>
              <p className="text-white/60 text-sm">Hang on a sec.</p>
            </>
          )}

          {state.status === 'success' && (
            <>
              <div className="w-14 h-14 rounded-full bg-green-500/20 flex items-center justify-center mx-auto mb-4">
                <CheckCircle size={28} className="text-green-400" />
              </div>
              <h1 className="font-semibold text-xl mb-2">
                {state.alreadyConfirmed ? 'Already confirmed' : "You're in!"}
              </h1>
              <p className="text-white/70 text-sm mb-4">
                {state.alreadyConfirmed
                  ? `You previously confirmed your partnership with ${state.captainName}. You're all set.`
                  : `You're officially playing doubles with ${state.captainName} in the league.`}
              </p>
              <p className="text-white/50 text-xs">
                You'll get another email when draws are generated and your first match is scheduled.
              </p>
            </>
          )}

          {state.status === 'error' && (
            <>
              <div className="w-14 h-14 rounded-full bg-red-500/20 flex items-center justify-center mx-auto mb-4">
                <AlertCircle size={28} className="text-red-400" />
              </div>
              <h1 className="font-semibold text-xl mb-2">Couldn&apos;t confirm</h1>
              <p className="text-red-300 text-sm mb-4">{state.message}</p>
              <p className="text-white/50 text-xs">
                The link might be expired, used already, or invalid. If you think this is a mistake,
                reach out to the league director.
              </p>
            </>
          )}

          <div className="mt-6 pt-6 border-t border-white/10">
            <Link href="/" className="text-xs text-white/40 hover:text-white">
              ← Back to CoachMode
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
