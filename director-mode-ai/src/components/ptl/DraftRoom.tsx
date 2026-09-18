'use client';

/**
 * The captain's draft room.
 *
 * Opened from a link with a team token in it — no account, because PTL captains
 * come from a dozen different clubs and most have never heard of ClubMode.
 *
 * The screen answers three questions in priority order, because that is the
 * order a captain asks them on draft night:
 *
 *   1. Is it my pick, and how long have I got?   → the bar, impossible to miss
 *   2. Who is still on the board?                → the pool, sorted by rating
 *   3. What happens if I'm not looking?          → the queue, which auto-picks
 *
 * The queue is the part that makes a distributed draft survivable. Captains
 * will be driving, coaching, or eating dinner. A captain who has queued ten
 * names drafts sensibly for twenty minutes without touching the page, and one
 * who never opens it at all still gets best-available rather than nothing.
 */

import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  formatClock,
  useLiveDraft,
  type DraftSnapshot,
  type PoolPlayer,
} from './useLiveDraft';

type Props = {
  token: string;
  teamName: string;
  seasonName: string;
  rosterSize: number;
  initial: DraftSnapshot;
};

type Sort = 'rating' | 'name' | 'club';

export default function DraftRoom({ token, teamName, seasonName, rosterSize, initial }: Props) {
  const { snap, refresh, pulse, remaining } = useLiveDraft({ token, initial });
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<Sort>('rating');
  const [busy, setBusy] = useState<string | null>(null);
  const [tab, setTab] = useState<'queue' | 'roster' | 'board'>('queue');

  const you = snap.you;
  const live = snap.state.status === 'live';
  const yourPick = live && snap.state.on_the_clock_team_id === you;
  const onClockTeam = snap.teams.find((t) => t.id === snap.state.on_the_clock_team_id);

  const yourPicks = useMemo(
    () => snap.picks.filter((p) => p.team_id === you).sort((a, b) => a.pick_no - b.pick_no),
    [snap.picks, you],
  );

  const poolById = useMemo(() => new Map(snap.pool.map((p) => [p.id, p])), [snap.pool]);
  const queued = useMemo(
    () => snap.queue.map((id) => poolById.get(id)).filter((p): p is PoolPlayer => !!p),
    [snap.queue, poolById],
  );
  const queuedIds = useMemo(() => new Set(snap.queue), [snap.queue]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rows = q
      ? snap.pool.filter(
          (p) => p.name.toLowerCase().includes(q) || (p.home_club || '').toLowerCase().includes(q),
        )
      : snap.pool;
    const sorted = [...rows];
    if (sort === 'name') sorted.sort((a, b) => a.name.localeCompare(b.name));
    else if (sort === 'club') sorted.sort((a, b) => (a.home_club || '').localeCompare(b.home_club || ''));
    else sorted.sort((a, b) => (b.composite ?? 0) - (a.composite ?? 0));
    return sorted;
  }, [snap.pool, search, sort]);

  async function draft(entryId: string, name: string) {
    setBusy(entryId);
    try {
      const res = await fetch('/api/ptl/draft/pick', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, entryId }),
      });
      const body = await res.json();
      if (!res.ok) {
        toast.error(body.error || 'That pick did not go through.');
        // Whatever went wrong, the board has moved on without us — the cheapest
        // way to stop showing a stale pool is to go and get the real one.
        await refresh();
        return;
      }
      toast.success(`${name} is yours.`);
      await refresh();
    } catch {
      toast.error('Lost the connection. Try that again.');
    } finally {
      setBusy(null);
    }
  }

  async function saveQueue(ids: string[]) {
    try {
      await fetch('/api/ptl/draft/queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, entryIds: ids }),
      });
      await refresh();
    } catch {
      toast.error('Could not save your queue.');
    }
  }

  const toggleQueue = (id: string) =>
    saveQueue(queuedIds.has(id) ? snap.queue.filter((q) => q !== id) : [...snap.queue, id]);

  const move = (i: number, by: number) => {
    const next = [...snap.queue];
    const j = i + by;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    saveQueue(next);
  };

  const rosterCount = yourPicks.length;
  const clockLow = remaining != null && remaining <= 15;

  return (
    <div className="mx-auto max-w-6xl px-5 pb-20 pt-8">
      {/* ---------- who am I, and is it my turn ---------- */}
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-teal-400">
            {seasonName} · Draft room
          </p>
          <h1 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">{teamName}</h1>
        </div>
        <p className="text-sm text-white/50">
          {rosterCount} of {rosterSize} drafted
          {pulse && <span className="ml-3 text-teal-400">● live</span>}
        </p>
      </div>

      {/* The clock bar. Deliberately loud when it's your pick and deliberately
          quiet when it isn't — a captain glancing at a phone should be able to
          tell from across a room. */}
      <div
        className={`mt-6 flex flex-wrap items-center justify-between gap-4 rounded-sm border px-5 py-4 ${
          yourPick
            ? clockLow
              ? 'border-red-400/60 bg-red-400/10'
              : 'border-teal-400/60 bg-teal-400/10'
            : 'border-white/10 bg-white/[0.03]'
        }`}
      >
        <div>
          {snap.state.status === 'complete' ? (
            <p className="text-xl font-black tracking-tight">The draft is done.</p>
          ) : snap.state.status === 'paused' ? (
            <p className="text-xl font-black tracking-tight text-amber-300">
              Paused by the commissioner.
            </p>
          ) : snap.state.status === 'pending' ? (
            <p className="text-xl font-black tracking-tight text-white/70">
              Waiting for the draft to start.
            </p>
          ) : yourPick ? (
            <>
              <p className="text-2xl font-black tracking-tight text-teal-300">You&rsquo;re on the clock.</p>
              <p className="mt-1 text-sm text-white/60">
                Pick {snap.state.current_pick_no} · Round {snap.state.current_round_no}
              </p>
            </>
          ) : (
            <>
              <p className="text-xl font-bold tracking-tight">
                {onClockTeam?.name || 'Someone else'} is picking.
              </p>
              <p className="mt-1 text-sm text-white/50">
                Pick {snap.state.current_pick_no} · Round {snap.state.current_round_no} · You&rsquo;re
                next when the snake turns.
              </p>
            </>
          )}
        </div>

        {live && (
          <div className="text-right">
            <div
              className={`text-4xl font-black tabular-nums ${
                clockLow && yourPick ? 'text-red-300' : yourPick ? 'text-teal-300' : 'text-white/70'
              }`}
            >
              {formatClock(remaining)}
            </div>
            <div className="text-[11px] uppercase tracking-[0.14em] text-white/40">
              {yourPick ? 'to pick' : 'on the clock'}
            </div>
          </div>
        )}
      </div>

      {!yourPick && live && queued.length === 0 && (
        <p className="mt-3 text-sm text-amber-300/90">
          Queue some players below. If your clock runs out, we take the top name still available —
          so you never lose a pick because you were driving.
        </p>
      )}

      <div className="mt-8 grid gap-8 lg:grid-cols-[1.5fr_1fr]">
        {/* ---------- the pool ---------- */}
        <section>
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-lg font-bold tracking-tight">
              On the board <span className="text-white/40">({snap.pool.length})</span>
            </h2>
            <div className="ml-auto flex gap-2">
              {(['rating', 'name', 'club'] as Sort[]).map((s) => (
                <button
                  key={s}
                  onClick={() => setSort(s)}
                  className={`rounded-sm px-2.5 py-1 text-xs capitalize transition-colors ${
                    sort === s ? 'bg-white/15 text-white' : 'text-white/45 hover:text-white/80'
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          <input
            id="ptl-pool-search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search a name or a club…"
            className="mt-3 w-full rounded-sm border border-white/15 bg-white/[0.04] px-3 py-2.5 text-sm text-white placeholder:text-white/35 focus:border-teal-400/70 focus:outline-none"
          />

          <ul className="mt-4 divide-y divide-white/[0.07]">
            {visible.slice(0, 120).map((p) => (
              <li key={p.id} className="flex items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{p.name}</p>
                  <p className="truncate text-xs text-white/45">
                    {p.home_club || 'Unattached'}
                    {p.ntrp != null && <> · NTRP {p.ntrp}</>}
                    {p.utr != null && <> · UTR {p.utr}</>}
                  </p>
                </div>
                <span className="shrink-0 text-sm tabular-nums text-white/55">
                  {p.composite?.toFixed(1) ?? '—'}
                </span>
                <button
                  onClick={() => toggleQueue(p.id)}
                  className={`shrink-0 rounded-sm border px-2.5 py-1.5 text-xs transition-colors ${
                    queuedIds.has(p.id)
                      ? 'border-teal-400/60 text-teal-300'
                      : 'border-white/20 text-white/60 hover:border-white/45 hover:text-white'
                  }`}
                  aria-label={queuedIds.has(p.id) ? `Remove ${p.name} from your queue` : `Queue ${p.name}`}
                >
                  {queuedIds.has(p.id) ? 'Queued' : 'Queue'}
                </button>
                <button
                  onClick={() => draft(p.id, p.name)}
                  disabled={!yourPick || busy === p.id}
                  className="shrink-0 rounded-sm bg-teal-400 px-3 py-1.5 text-xs font-bold text-[#06231F] transition-colors hover:bg-teal-300 disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/35"
                >
                  {busy === p.id ? '…' : 'Draft'}
                </button>
              </li>
            ))}
          </ul>

          {visible.length > 120 && (
            <p className="mt-4 text-sm text-white/40">
              Showing the top 120. Search to narrow it down.
            </p>
          )}
          {visible.length === 0 && (
            <p className="mt-4 text-sm text-white/40">Nobody left matching that.</p>
          )}
        </section>

        {/* ---------- queue / roster / board ---------- */}
        <section>
          <div className="flex gap-2 border-b border-white/10 pb-2">
            {([
              ['queue', `My queue (${queued.length})`],
              ['roster', `My team (${rosterCount})`],
              ['board', 'Board'],
            ] as const).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`rounded-sm px-3 py-1.5 text-sm transition-colors ${
                  tab === key ? 'bg-white/15 font-semibold text-white' : 'text-white/50 hover:text-white/85'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {tab === 'queue' && (
            <div className="mt-4">
              {queued.length === 0 ? (
                <p className="text-sm leading-relaxed text-white/50">
                  Nothing queued. Add players from the board and we&rsquo;ll take the top one still
                  available if your clock runs out.
                </p>
              ) : (
                <ol className="space-y-px">
                  {queued.map((p, i) => (
                    <li key={p.id} className="flex items-center gap-2 border-b border-white/[0.07] py-2">
                      <span className="w-6 shrink-0 text-sm tabular-nums text-white/40">{i + 1}</span>
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">{p.name}</span>
                      <button
                        onClick={() => move(i, -1)}
                        disabled={i === 0}
                        className="shrink-0 px-1.5 text-white/40 hover:text-white disabled:opacity-25"
                        aria-label={`Move ${p.name} up`}
                      >
                        ↑
                      </button>
                      <button
                        onClick={() => move(i, 1)}
                        disabled={i === queued.length - 1}
                        className="shrink-0 px-1.5 text-white/40 hover:text-white disabled:opacity-25"
                        aria-label={`Move ${p.name} down`}
                      >
                        ↓
                      </button>
                      <button
                        onClick={() => toggleQueue(p.id)}
                        className="shrink-0 px-1.5 text-white/40 hover:text-red-300"
                        aria-label={`Remove ${p.name} from your queue`}
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ol>
              )}
              <p className="mt-4 text-xs leading-relaxed text-white/35">
                Only you can see this list.
              </p>
            </div>
          )}

          {tab === 'roster' && (
            <div className="mt-4">
              {rosterCount === 0 ? (
                <p className="text-sm text-white/50">No picks yet.</p>
              ) : (
                <ol className="space-y-px">
                  {yourPicks.map((p) => (
                    <li key={p.pick_no} className="flex items-baseline gap-3 border-b border-white/[0.07] py-2">
                      <span className="w-12 shrink-0 text-xs tabular-nums text-white/40">
                        R{p.round_no}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">
                        {p.player_name}
                      </span>
                      {p.is_auto && (
                        <span className="shrink-0 text-[10px] uppercase tracking-wider text-amber-300/80">
                          auto
                        </span>
                      )}
                    </li>
                  ))}
                </ol>
              )}
            </div>
          )}

          {tab === 'board' && (
            <div className="mt-4 max-h-[520px] overflow-y-auto">
              <ol className="space-y-px">
                {[...snap.picks].reverse().map((p) => {
                  const team = snap.teams.find((t) => t.id === p.team_id);
                  return (
                    <li key={p.pick_no} className="flex items-baseline gap-3 border-b border-white/[0.07] py-2">
                      <span className="w-8 shrink-0 text-xs tabular-nums text-white/35">
                        {p.pick_no}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm">{p.player_name}</span>
                      <span className="shrink-0 text-xs font-semibold text-white/55">
                        {team?.shortCode}
                      </span>
                    </li>
                  );
                })}
              </ol>
              {snap.picks.length === 0 && (
                <p className="text-sm text-white/50">No picks yet.</p>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
