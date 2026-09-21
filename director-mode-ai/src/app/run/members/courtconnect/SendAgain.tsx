'use client';

/**
 * "Send again" — one person at a time.
 *
 * Sleepy Hollow's first 16 invitations went out before the deliverability fixes
 * (HTML-only, no one-click headers, from "ClubMode" rather than from the club),
 * so most of them are in spam and the people in them never got the chance to
 * answer. They need the email again, in the shape that arrives.
 *
 * Per person, not another blast: a director knows which four of fifteen he
 * actually wants on court tomorrow, and a second mass email about one game is
 * how a club teaches its members to mute it.
 */

import { useState } from 'react';
import { Loader2, RotateCw } from 'lucide-react';

type Person = { id: string; name: string };

export default function SendAgain({ gameId, people }: { gameId: string; people: Person[] }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<Record<string, 'sent' | 'failed'>>({});

  if (!people.length) return null;

  async function again(p: Person) {
    setBusy(p.id);
    try {
      const res = await fetch(`/api/play/games/${gameId}/notify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resend: [p.id] }),
      });
      const json = await res.json();
      setDone((d) => ({ ...d, [p.id]: res.ok && json.sent ? 'sent' : 'failed' }));
    } catch {
      setDone((d) => ({ ...d, [p.id]: 'failed' }));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mt-1.5">
      <p className="text-[11px] text-white/35">No reply yet — send it again:</p>
      <div className="mt-1 flex flex-wrap gap-1">
        {people.map((p) => {
          const state = done[p.id];
          return (
            <button
              key={p.id}
              onClick={() => again(p)}
              disabled={busy !== null || state === 'sent'}
              title={`Email ${p.name} about this game again`}
              className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] ${
                state === 'sent'
                  ? 'bg-emerald-400/15 text-emerald-300'
                  : state === 'failed'
                    ? 'bg-rose-400/15 text-rose-300'
                    : 'bg-white/[0.06] text-white/70 hover:bg-white/10'
              } disabled:opacity-60`}
            >
              {busy === p.id ? (
                <Loader2 size={10} className="animate-spin" />
              ) : state === 'sent' ? null : (
                <RotateCw size={10} />
              )}
              {p.name}
              {state === 'sent' ? ' ✓' : ''}
            </button>
          );
        })}
      </div>
    </div>
  );
}
