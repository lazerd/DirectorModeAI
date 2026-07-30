'use client';

/**
 * Drag the roster into strength order.
 *
 * Ratings are too coarse to order a lineup with — half a B2/B3 roster shares a
 * 3.0 — so the generator takes the captain's own ranking first and falls back
 * to rating only for players who haven't been placed. #1 is the strongest.
 *
 * Ordering is saved as a whole list rather than per-row, so ranks can never end
 * up duplicated or with gaps. Up/down buttons sit alongside the drag handle:
 * dragging 23 names on a phone is miserable, and it keeps this usable by
 * keyboard.
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import RatingsPastePanel from './RatingsPastePanel';

export type RankablePlayer = {
  id: string;
  name: string;
  rating: number | null;
  sort_order: number | null;
  is_sub: boolean;
};

function Row({
  id,
  name,
  rating,
  rank,
  ranked,
  onUp,
  onDown,
  first,
  last,
}: {
  id: string;
  name: string;
  rating: number | null;
  rank: number;
  ranked: boolean;
  onUp: () => void;
  onDown: () => void;
  first: boolean;
  last: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
  });
  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
      }}
      className={`flex items-center gap-3 rounded-xl border bg-[#002838] px-3 py-2 ${
        isDragging ? 'border-[#D3FB52]/50' : 'border-white/[0.08]'
      }`}
    >
      <button
        type="button"
        {...listeners}
        {...attributes}
        aria-label={`Drag to reorder ${name}`}
        title="Drag to set strength order"
        className="cursor-grab active:cursor-grabbing touch-none text-white/25 hover:text-white/70 shrink-0 text-lg leading-none"
      >
        ⠿
      </button>
      <span className="w-7 text-right text-xs text-white/40 shrink-0">#{rank}</span>
      <span className="flex-1 min-w-0 truncate text-white text-sm">
        {name}
        {rating != null && <span className="text-white/35"> · {rating}</span>}
        {!ranked && <span className="text-white/25 text-xs"> · unranked</span>}
      </span>
      <span className="flex gap-1 shrink-0">
        <button
          onClick={onUp}
          disabled={first}
          aria-label={`Move ${name} up`}
          className="px-1.5 text-white/30 hover:text-white disabled:opacity-20 text-sm"
        >
          ↑
        </button>
        <button
          onClick={onDown}
          disabled={last}
          aria-label={`Move ${name} down`}
          className="px-1.5 text-white/30 hover:text-white disabled:opacity-20 text-sm"
        >
          ↓
        </button>
      </span>
    </div>
  );
}

/** Ranked players first in their given order, then unranked by rating. */
function initialOrder(players: RankablePlayer[]): RankablePlayer[] {
  return [...players].sort((a, b) => {
    const ra = a.sort_order;
    const rb = b.sort_order;
    if (ra != null && rb != null) return ra - rb;
    if (ra != null) return -1;
    if (rb != null) return 1;
    const d = (b.rating ?? 0) - (a.rating ?? 0);
    return d !== 0 ? d : a.name.localeCompare(b.name);
  });
}

export default function StrengthOrderPanel({
  teamId,
  players,
}: {
  teamId: string;
  players: RankablePlayer[];
}) {
  const router = useRouter();
  const roster = players.filter((p) => !p.is_sub);
  const [order, setOrder] = useState<RankablePlayer[]>(() => initialOrder(roster));
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Re-sync when the roster changes underneath us (a player added or removed),
  // but never while there are unsaved drags to clobber.
  useEffect(() => {
    if (!dirty) setOrder(initialOrder(players.filter((p) => !p.is_sub)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [players]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function move(from: number, to: number) {
    if (to < 0 || to >= order.length) return;
    setOrder((o) => arrayMove(o, from, to));
    setDirty(true);
    setMsg(null);
  }

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = order.findIndex((p) => p.id === active.id);
    const to = order.findIndex((p) => p.id === over.id);
    if (from < 0 || to < 0) return;
    move(from, to);
  }

  async function save() {
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      const res = await fetch('/api/captain/players', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ team_id: teamId, order: order.map((p) => p.id) }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(j.error || 'Could not save the order.');
        return;
      }
      setDirty(false);
      setMsg(`Ranked ${j.ranked} players. Lineups will use this before rating.`);
      router.refresh();
    } catch {
      setError('Network problem — try again.');
    } finally {
      setBusy(false);
    }
  }

  if (!roster.length) return null;

  return (
    <section className="mt-10">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-xl font-display text-white">Strength order</h2>
        {dirty && (
          <button
            onClick={save}
            disabled={busy}
            className="px-4 py-2 rounded-xl bg-[#D3FB52] text-[#001820] font-semibold text-sm disabled:opacity-50"
          >
            {busy ? 'Saving…' : 'Save order'}
          </button>
        )}
      </div>

      <p className="text-sm text-white/50 mt-2">
        #1 is your strongest. This beats rating when the generator picks courts — useful when half
        the roster shares a rating.
      </p>

      <RatingsPastePanel teamId={teamId} />

      {msg && <p className="text-sm text-[#D3FB52] mt-3">{msg}</p>}
      {error && <p className="text-sm text-red-300 mt-3">{error}</p>}
      {dirty && !error && (
        <p className="text-sm text-amber-300/90 mt-3">Unsaved order — hit Save order.</p>
      )}

      <div className="mt-4">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={order.map((p) => p.id)} strategy={verticalListSortingStrategy}>
            <div className="space-y-1.5">
              {order.map((p, i) => (
                <Row
                  key={p.id}
                  id={p.id}
                  name={p.name}
                  rating={p.rating}
                  rank={i + 1}
                  ranked={p.sort_order != null}
                  first={i === 0}
                  last={i === order.length - 1}
                  onUp={() => move(i, i - 1)}
                  onDown={() => move(i, i + 1)}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      </div>
    </section>
  );
}
