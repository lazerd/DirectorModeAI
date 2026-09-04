'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { X } from 'lucide-react';

/**
 * Remove a club from the opponent list.
 *
 * Confirms first, and names the club in the confirmation: the cards look alike
 * at a glance, and the whole reason this button exists is a list that came in
 * wrong, which is exactly when a captain is clicking quickly.
 */
export default function RemoveOpponentButton({
  teamId,
  id,
  name,
}: {
  teamId: string;
  id: string;
  name: string;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  async function remove() {
    setBusy(true);
    try {
      await fetch('/api/captain/opponents', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ team_id: teamId, id }),
      });
      router.refresh();
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  if (confirming) {
    return (
      <span className="flex items-center gap-2 shrink-0">
        <button
          onClick={remove}
          disabled={busy}
          className="text-[11px] px-2 py-1 rounded-lg bg-red-500/20 text-red-200 hover:bg-red-500/30 disabled:opacity-50"
        >
          {busy ? 'Removing…' : `Remove ${name.split(' ')[0]}?`}
        </button>
        <button
          onClick={() => setConfirming(false)}
          className="text-[11px] text-white/40 hover:text-white"
        >
          Keep
        </button>
      </span>
    );
  }

  return (
    <button
      onClick={() => setConfirming(true)}
      title={`Remove ${name}`}
      className="shrink-0 text-white/25 hover:text-red-300 transition-colors"
    >
      <X size={15} />
    </button>
  );
}
