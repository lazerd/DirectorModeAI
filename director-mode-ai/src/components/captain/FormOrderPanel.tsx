'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowDown, ArrowUp, TrendingUp } from 'lucide-react';

/**
 * Strength order suggested by results — the junior answer to "order by WTN".
 *
 * A 10U player has no rating, so the order is whatever the captain typed in
 * July. After one match day it was already wrong: Noelle won everything from
 * line 3, Gavin lost from line 2. This shows what the results say and applies
 * it only when the captain taps. Captain-only, like the equal-play numbers:
 * players see the lineup, never the ranking behind it.
 */

type Row = {
  id: string;
  name: string;
  seed: number;
  form: number;
  wins: number;
  losses: number;
  days: number;
  reasons: string[];
};
type Proposal = { playerId: string; name: string; from: number; to: number; form: number; reasons: string[] };

export default function FormOrderPanel({ teamId }: { teamId: string }) {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>([]);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [order, setOrder] = useState<{ id: string; name: string }[]>([]);
  const [matchDays, setMatchDays] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/captain/form?team_id=${teamId}`);
    if (!res.ok) return;
    const j = await res.json();
    setRows(j.current || []);
    setProposals(j.proposals || []);
    setOrder(j.order || []);
    setMatchDays(j.matchDays || 0);
  }, [teamId]);

  useEffect(() => {
    load();
  }, [load]);

  const apply = async (ids: string[], what: string) => {
    setError(null);
    setBusy(what);
    try {
      const res = await fetch('/api/captain/players', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ team_id: teamId, order: ids }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Could not save the order.');
      setNote('Strength order updated. Lineups from here on use it.');
      await load();
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  /** One player's move, leaving everyone else in their current order. */
  const applyOne = (p: Proposal) => {
    const ids = rows.map((r) => r.id);
    const from = ids.indexOf(p.playerId);
    if (from < 0) return;
    ids.splice(from, 1);
    ids.splice(p.to - 1, 0, p.playerId);
    apply(ids, p.playerId);
  };

  if (!matchDays) return null;

  const played = rows.filter((r) => r.days > 0);
  const btn = 'px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-50';

  return (
    <section className="mt-6 rounded-2xl border border-white/[0.08] bg-[#002838] p-4">
      <div className="flex items-center gap-2">
        <TrendingUp size={16} className="text-[#D3FB52]" />
        <h3 className="text-white font-medium">What the results say about the order</h3>
      </div>
      <p className="mt-1 text-[13px] text-white/40">
        From {matchDays} match day{matchDays === 1 ? '' : 's'}. Winning the line you were seeded at is par;
        winning above it is what moves a player. Singles count more than doubles, and nobody moves more than one
        place per match day they have played. Nothing changes until you apply it.
      </p>

      {proposals.length === 0 ? (
        <p className="mt-3 text-[13px] text-[#D3FB52]">The results agree with your order.</p>
      ) : (
        <>
          <ul className="mt-3 space-y-2">
            {proposals.map((p) => {
              const up = p.to < p.from;
              return (
                <li key={p.playerId} className="rounded-xl border border-white/10 bg-[#001820] p-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={up ? 'text-[#D3FB52]' : 'text-amber-300'}>
                      {up ? <ArrowUp size={14} /> : <ArrowDown size={14} />}
                    </span>
                    <span className="text-white text-sm font-medium">{p.name}</span>
                    <span className="text-white/40 text-sm">
                      #{p.from} → #{p.to}
                    </span>
                    <button
                      onClick={() => applyOne(p)}
                      disabled={!!busy}
                      className={`${btn} ml-auto border border-white/15 text-white/70 hover:text-white`}
                    >
                      {busy === p.playerId ? 'Moving…' : 'Move'}
                    </button>
                  </div>
                  {p.reasons.length > 0 && (
                    <p className="mt-1.5 text-[12.5px] text-white/50">{p.reasons.slice(0, 4).join(' · ')}</p>
                  )}
                </li>
              );
            })}
          </ul>
          <button
            onClick={() => apply(order.map((o) => o.id), 'all')}
            disabled={!!busy}
            className={`${btn} mt-3 bg-[#D3FB52] text-[#001820] hover:brightness-95`}
          >
            {busy === 'all' ? 'Applying…' : `Apply all ${proposals.length} moves`}
          </button>
        </>
      )}

      {played.length > 0 && (
        <div className="mt-4">
          <button
            onClick={() => setShowAll((v) => !v)}
            className="text-xs text-white/40 underline underline-offset-2 hover:text-white"
          >
            {showAll ? 'Hide the numbers' : 'Show every player’s form'}
          </button>
          {showAll && (
            <ul className="mt-2 space-y-1">
              {rows.map((r) => (
                <li key={r.id} className="flex items-baseline gap-3 text-[13px]">
                  <span className="text-white/30 w-7">#{r.seed}</span>
                  <span className="text-white/80 flex-1 min-w-[8rem]">{r.name}</span>
                  <span className="text-white/40">
                    {r.days ? `${r.wins}-${r.losses}` : 'no results yet'}
                  </span>
                  <span className={r.form > 0 ? 'text-[#D3FB52] w-14 text-right' : 'text-white/40 w-14 text-right'}>
                    {r.days ? (r.form > 0 ? `+${r.form}` : r.form) : '—'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {error && <p className="mt-3 text-sm text-red-300">{error}</p>}
      {note && <p className="mt-3 text-sm text-[#D3FB52]">{note}</p>}
    </section>
  );
}
