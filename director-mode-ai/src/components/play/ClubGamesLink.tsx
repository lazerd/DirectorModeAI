'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { C } from './shared';

/**
 * "Your club's games →" for people signed in to ClubMode, linking Racquets IRL
 * (/play) to their club's own board (Club Games at /member/games). Renders
 * nothing for everyone else. getSession reads the local session only (no
 * network call), so it is cheap enough for every /play and /p page.
 */
export function ClubGamesLink({ className = '' }: { className?: string }) {
  const [signedIn, setSignedIn] = useState(false);
  useEffect(() => {
    let live = true;
    createClient().auth.getSession()
      .then(({ data }) => { if (live) setSignedIn(!!data.session); })
      .catch(() => {});
    return () => { live = false; };
  }, []);
  if (!signedIn) return null;
  return (
    <div className={className}>
      <Link href="/member/games" className="font-semibold underline underline-offset-4" style={{ color: C.ink }}>
        Your club&apos;s games →
      </Link>
    </div>
  );
}
