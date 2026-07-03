'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { CheckCircle2, Loader2, AlertCircle } from 'lucide-react';

export default function JoinClubPage() {
  const params = useParams();
  const code = String(params.code || '');
  const [state, setState] = useState<'loading' | 'joined' | 'already' | 'error'>('loading');
  const [clubName, setClubName] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    (async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        window.location.href = `/login?redirect=/join/${encodeURIComponent(code)}`;
        return;
      }
      try {
        const res = await fetch('/api/clubs/join', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Could not join club');
        setClubName(json.club);
        setState(json.alreadyMember ? 'already' : 'joined');
      } catch (e: any) {
        setMessage(e?.message || 'Could not join club');
        setState('error');
      }
    })();
  }, [code]);

  return (
    <div className="min-h-screen bg-[#001820] text-white flex items-center justify-center px-4">
      <div className="max-w-md w-full rounded-2xl border border-white/10 bg-[#002838] p-8 text-center">
        {state === 'loading' && (
          <>
            <Loader2 className="h-10 w-10 mx-auto text-yellow-300 animate-spin" />
            <p className="mt-4 text-white/70">Joining your club…</p>
          </>
        )}
        {(state === 'joined' || state === 'already') && (
          <>
            <CheckCircle2 className="h-12 w-12 mx-auto text-emerald-400" />
            <h1 className="mt-4 font-display text-2xl">
              {state === 'joined' ? "You're in!" : "You're already a member"}
            </h1>
            <p className="mt-2 text-white/60">
              Welcome to <span className="text-white font-medium">{clubName}</span>.
            </p>
            <Link
              href="/client/dashboard"
              className="mt-6 inline-block px-5 py-3 rounded-xl bg-yellow-300 text-[#001820] font-medium hover:bg-yellow-200"
            >
              Go to my dashboard
            </Link>
          </>
        )}
        {state === 'error' && (
          <>
            <AlertCircle className="h-12 w-12 mx-auto text-red-400" />
            <h1 className="mt-4 font-display text-2xl">Hmm.</h1>
            <p className="mt-2 text-white/60">{message}</p>
            <Link href="/" className="mt-6 inline-block px-5 py-3 rounded-xl bg-white/10 hover:bg-white/15 font-medium">
              Back home
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
