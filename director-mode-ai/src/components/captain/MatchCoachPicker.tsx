'use client';

/**
 * "Coach at this match" — who from our side is going to be standing at the
 * courts. Shown at the top of the match page whether or not any email has gone
 * out, because it is the first thing anyone asks on match day.
 *
 * Picks from the team's own contacts (Team page → contacts), so the name,
 * email and phone live in one place. Once named, the coach is copied on every
 * email about this match — see matchCcRecipients.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

export type CoachOption = {
  id: string;
  name: string;
  role: string | null;
  email: string | null;
  phone: string | null;
};

export default function MatchCoachPicker({
  teamId,
  matchId,
  options,
  initialId,
}: {
  teamId: string;
  matchId: string;
  options: CoachOption[];
  initialId: string | null;
}) {
  const router = useRouter();
  const [id, setId] = useState<string | null>(initialId);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const coach = options.find((o) => o.id === id) ?? null;

  async function choose(next: string | null) {
    setBusy(true);
    try {
      const res = await fetch('/api/captain/matches', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ team_id: teamId, match_id: matchId, patch: { match_coach_id: next } }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || 'Could not save the coach.');
      setId(next);
      setEditing(false);
      toast.success(next ? `${options.find((o) => o.id === next)?.name} is coaching this match.` : 'Coach cleared.');
      router.refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // Coaches first, then everyone else on the contact list.
  const sorted = [...options].sort(
    (a, b) =>
      (a.role === 'coach' ? 0 : 1) - (b.role === 'coach' ? 0 : 1) || a.name.localeCompare(b.name),
  );

  return (
    <div className="rounded-xl border border-[#D3FB52]/30 bg-[#D3FB52]/[0.06] px-4 py-2.5 text-sm">
      <div className="text-[#D3FB52]/80 text-[11px] uppercase tracking-wide">Our coach at this match</div>
      {!editing ? (
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="text-white font-medium">{coach ? coach.name : 'Not set'}</span>
          {coach?.phone && (
            <a href={`tel:${coach.phone}`} className="text-[#D3FB52]/90 hover:text-[#D3FB52]">
              {coach.phone}
            </a>
          )}
          <button
            onClick={() => setEditing(true)}
            className="text-white/50 hover:text-white underline text-xs"
          >
            {coach ? 'change' : 'choose'}
          </button>
        </div>
      ) : options.length === 0 ? (
        <p className="text-white/60 text-xs mt-1">
          Add the coach under contacts on the team page first, then pick them here.
        </p>
      ) : (
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <select
            defaultValue={id ?? ''}
            disabled={busy}
            onChange={(e) => choose(e.target.value || null)}
            className="px-2.5 py-1.5 rounded-lg bg-[#001820] border border-white/10 text-white text-base md:text-sm"
            style={{ color: '#fff' }}
          >
            <option value="">— nobody —</option>
            {sorted.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
                {o.role && o.role !== 'coach' ? ` (${o.role.replace('_', ' ')})` : ''}
              </option>
            ))}
          </select>
          <button onClick={() => setEditing(false)} className="text-white/50 hover:text-white text-xs">
            cancel
          </button>
        </div>
      )}
      {coach && !editing && (
        <div className="text-white/40 text-[11px] mt-0.5">Copied on every email about this match</div>
      )}
    </div>
  );
}
