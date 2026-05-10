'use client';

/**
 * One-tap share button for the public league bracket page.
 *
 * On mobile: opens the native OS share sheet (SMS, WhatsApp, email) with a
 * pre-filled message + the public bracket URL, so viewers can fling the
 * link into their group chat without copy-pasting.
 *
 * On desktop or any browser without navigator.share: falls back to
 * writing the URL to the clipboard and flashing a small "Copied" state
 * on the button for ~2s.
 *
 * Designed to be dropped into the server-rendered bracket page header —
 * it only needs the league name and slug as props.
 */

import { useState } from 'react';
import { Share2, Check } from 'lucide-react';
import { shareLeagueBracket } from '@/lib/share';

type Props = {
  leagueName: string;
  leagueSlug: string;
};

export default function BracketShareButton({ leagueName, leagueSlug }: Props) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');

  const handleClick = async () => {
    const result = await shareLeagueBracket({ leagueName, leagueSlug });
    if (result === 'copied') {
      setState('copied');
      setTimeout(() => setState('idle'), 2000);
    } else if (result === 'failed') {
      setState('failed');
      setTimeout(() => setState('idle'), 2000);
    }
    // 'shared' and 'cancelled' — OS feedback is enough, stay idle.
  };

  const label =
    state === 'copied'
      ? 'Link copied'
      : state === 'failed'
        ? 'Share failed'
        : 'Share';

  return (
    <button
      type="button"
      onClick={handleClick}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
        state === 'copied'
          ? 'border-emerald-400 text-emerald-700 bg-emerald-50'
          : state === 'failed'
            ? 'border-red-300 text-red-700 bg-red-50'
            : 'border-orange-300 text-orange-700 bg-orange-50 hover:bg-orange-100'
      }`}
      aria-label="Share this bracket"
    >
      {state === 'copied' ? <Check size={12} /> : <Share2 size={12} />}
      {label}
    </button>
  );
}
