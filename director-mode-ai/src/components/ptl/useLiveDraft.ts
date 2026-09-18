'use client';

/**
 * Live draft state for the captain's room and the projected board.
 *
 * Two moving parts, deliberately separated:
 *
 * THE DATA. Supabase Realtime is only a nudge here, not the payload. The rows
 * a draft room actually needs — player names, the remaining pool, a captain's
 * private queue — live in tables `anon` cannot read, and must not be broadcast
 * to twelve browsers anyway. So the socket says "something changed" and a
 * debounced refetch pulls a fresh snapshot from /api/ptl/draft/state, which
 * reads service-side after checking the token. Same shape as
 * LiveBracketRefresher: the server does the first paint, the socket only
 * triggers the next one.
 *
 * THE CLOCK. Ticked locally every second off a server-authoritative deadline,
 * so it counts down smoothly without a request per second. When it hits zero
 * the browser POSTs the tick route, which auto-picks INSIDE the draft's row
 * lock — so a dozen browsers all reaching zero together still produce exactly
 * one pick, and a browser with a skewed clock achieves nothing. The fire is
 * guarded by a ref rather than state because two renders in the same second
 * must not both post.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

export type DraftState = {
  draft_id: string;
  season_id: string;
  status: 'pending' | 'live' | 'paused' | 'complete';
  pick_seconds: number;
  rounds: number;
  teams: number;
  current_pick_no: number | null;
  current_round_no: number | null;
  current_slot_no: number | null;
  on_the_clock_team_id: string | null;
  current_deadline_at: string | null;
  picks_made: number;
};

export type DraftTeam = {
  id: string;
  name: string;
  shortCode: string;
  color: string | null;
  draftSlot: number | null;
  captainName: string | null;
};

export type DraftPick = {
  pick_no: number;
  round_no: number;
  slot_no: number;
  team_id: string;
  entry_id: string;
  is_auto: boolean;
  player_name: string;
  composite: number | null;
};

/** What a roster still owes under the season's gender minimums. */
export type RosterNeeds = {
  roster_size: number;
  drafted: number;
  slots_left: number;
  men: number;
  women: number;
  men_needed: number;
  women_needed: number;
  /** null until it binds; then 'm', 'f', or 'either_needed'. */
  must_take: 'm' | 'f' | 'either_needed' | null;
};

export type PoolPlayer = {
  id: string;
  name: string;
  gender: 'm' | 'f' | null;
  home_club: string | null;
  ntrp: number | null;
  utr: number | null;
  wtn: number | null;
  composite: number | null;
  rating_confidence: string | null;
};

export type DraftSnapshot = {
  state: DraftState;
  needs?: RosterNeeds | null;
  picks: DraftPick[];
  teams: DraftTeam[];
  pool: PoolPlayer[];
  queue: string[];
  you: string | null;
};

type Options = {
  /** A captain's room passes their token; the public board passes a draft id. */
  token?: string;
  draftId?: string;
  initial: DraftSnapshot;
};

export function useLiveDraft({ token, draftId, initial }: Options) {
  const [snap, setSnap] = useState<DraftSnapshot>(initial);
  const [refreshing, setRefreshing] = useState(false);
  const [pulse, setPulse] = useState(false);

  const query = token ? `token=${encodeURIComponent(token)}` : `draftId=${encodeURIComponent(draftId || '')}`;

  const refresh = useCallback(async () => {
    try {
      setRefreshing(true);
      const res = await fetch(`/api/ptl/draft/state?${query}`, { cache: 'no-store' });
      if (!res.ok) return;
      const next = (await res.json()) as DraftSnapshot;
      setSnap(next);
      // A visible confirmation that the page is live. On a wall-projected board
      // with nobody touching it, a still screen and a broken screen look
      // identical — this is how the room can tell.
      setPulse(true);
      setTimeout(() => setPulse(false), 1100);
    } finally {
      setRefreshing(false);
    }
  }, [query]);

  // ---- realtime nudge ----
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const supabase = createClient();
    const id = initial.state.draft_id;

    const bump = () => {
      if (debounce.current) clearTimeout(debounce.current);
      debounce.current = setTimeout(refresh, 350);
    };

    const channel = supabase
      .channel(`ptl:draft:${id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'ptl_draft_picks', filter: `draft_id=eq.${id}` },
        bump,
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'ptl_drafts', filter: `id=eq.${id}` },
        bump,
      )
      .subscribe();

    return () => {
      if (debounce.current) clearTimeout(debounce.current);
      supabase.removeChannel(channel);
    };
  }, [initial.state.draft_id, refresh]);

  // ---- the clock ----
  const [remaining, setRemaining] = useState<number | null>(null);
  const firing = useRef(false);

  useEffect(() => {
    const deadline = snap.state.current_deadline_at;
    if (snap.state.status !== 'live' || !deadline) {
      setRemaining(null);
      return;
    }
    const target = new Date(deadline).getTime();

    const tick = async () => {
      const left = Math.max(0, Math.round((target - Date.now()) / 1000));
      setRemaining(left);
      if (left > 0 || firing.current) return;

      // Expired. Ask the server to auto-pick. Every open browser does this, and
      // that is fine: ptl_tick re-reads the deadline inside the row lock, so
      // the extra calls are no-ops. The short random delay just spreads twelve
      // simultaneous requests over a second.
      firing.current = true;
      setTimeout(async () => {
        try {
          await fetch('/api/ptl/draft/tick', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ draftId: snap.state.draft_id }),
          });
          await refresh();
        } catch {
          // A failed tick is recoverable: the next second tries again, and any
          // other open browser is trying too.
        } finally {
          firing.current = false;
        }
      }, Math.random() * 900);
    };

    tick();
    const iv = setInterval(tick, 1000);
    return () => clearInterval(iv);
  }, [snap.state.current_deadline_at, snap.state.status, snap.state.draft_id, refresh]);

  // A new pick means a new deadline, so the guard has to lift.
  useEffect(() => {
    firing.current = false;
  }, [snap.state.current_pick_no]);

  return { snap, setSnap, refresh, refreshing, pulse, remaining };
}

/** m:ss, and never a negative number on screen. */
export function formatClock(seconds: number | null): string {
  if (seconds == null) return '--:--';
  const s = Math.max(0, seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
