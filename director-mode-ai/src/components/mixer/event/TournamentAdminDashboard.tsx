'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  Users,
  Loader2,
  Copy,
  Check,
  Share2,
  AlertCircle,
  Trash2,
  Wand2,
  Mail,
  Edit3,
  PartyPopper,
  ListChecks,
  Calendar,
  UserPlus,
  ArrowUp,
  ArrowDown,
  Tv,
  Printer,
  Music,
  Download,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { isValidQuadScore, formatTimeDisplay, resolveCourtList } from '@/lib/quads';

const FORMAT_LABELS: Record<string, string> = {
  'rr-singles': 'Round Robin — Singles',
  'rr-doubles': 'Round Robin — Doubles',
  'single-elim-singles': 'Single Elimination — Singles',
  'single-elim-doubles': 'Single Elimination — Doubles',
  'fmlc-singles': 'First-Match Loser Consolation — Singles',
  'fmlc-doubles': 'First-Match Loser Consolation — Doubles',
  'ffic-singles': 'Full Feed-In Consolation — Singles',
  'ffic-doubles': 'Full Feed-In Consolation — Doubles',
};

type EventRow = {
  id: string;
  name: string;
  slug: string;
  match_format: string;
  public_status: string;
  entry_fee_cents: number;
  max_players: number | null;
  num_courts: number | null;
  court_names: string[] | null;
  event_date: string | null;
  daily_start_time: string | null;
  daily_end_time: string | null;
  default_match_length_minutes: number | null;
};

type Entry = {
  id: string;
  player_name: string;
  player_email: string | null;
  parent_email: string | null;
  partner_name: string | null;
  ntrp: number | null;
  utr: number | null;
  composite_rating: number | null;
  position: 'pending_payment' | 'in_draw' | 'waitlist' | 'withdrawn';
  payment_status: 'pending' | 'paid' | 'waived' | 'refunded' | 'failed';
  registered_at: string;
  seed: number | null;
};

type Match = {
  id: string;
  bracket: 'main' | 'consolation';
  round: number;
  slot: number;
  match_type: 'singles' | 'doubles';
  player1_id: string | null;
  player2_id: string | null;
  player3_id: string | null;
  player4_id: string | null;
  score: string | null;
  winner_side: 'a' | 'b' | null;
  status: string;
  score_token: string;
  court: string | null;
  scheduled_at: string | null;
  scheduled_date: string | null;
  winner_feeds_to: string | null;
};

const POSITION_LABELS: Record<Entry['position'], { label: string; color: string }> = {
  in_draw: { label: 'Confirmed', color: 'bg-emerald-100 text-emerald-700' },
  waitlist: { label: 'Waitlist', color: 'bg-amber-100 text-amber-700' },
  pending_payment: { label: 'Pending pmt', color: 'bg-gray-100 text-gray-700' },
  withdrawn: { label: 'Withdrawn', color: 'bg-red-100 text-red-700' },
};

type Tab = 'entries' | 'matches' | 'schedule' | 'settings';
type ScoreOutcome = 'played' | 'walkover' | 'retired' | 'default';

/** Accept tennis scores PLUS walkover/default/retired markers. */
function isValidTournamentScore(raw: string, outcome: ScoreOutcome): boolean {
  const s = raw.trim();
  if (outcome === 'walkover' || outcome === 'default') return true;
  if (outcome === 'retired') {
    if (!s) return true;
    return isValidQuadScore(s);
  }
  return isValidQuadScore(s);
}

function buildScoreString(raw: string, outcome: ScoreOutcome): string {
  const s = raw.trim();
  if (outcome === 'walkover') return 'W/O';
  if (outcome === 'default') return 'DEF';
  if (outcome === 'retired') return s ? `${s}, RET` : 'RET';
  return s;
}

/** Strip trailing modifier so the inline edit form can repopulate. */
function detectOutcome(score: string | null): { outcome: ScoreOutcome; cleanScore: string } {
  if (!score) return { outcome: 'played', cleanScore: '' };
  const s = score.trim().toUpperCase();
  if (s === 'W/O' || s === 'WO') return { outcome: 'walkover', cleanScore: '' };
  if (s === 'DEF') return { outcome: 'default', cleanScore: '' };
  if (s.endsWith(', RET') || s === 'RET') {
    return { outcome: 'retired', cleanScore: score.replace(/,?\s*RET$/i, '').trim() };
  }
  return { outcome: 'played', cleanScore: score };
}

/** Tennis round label: "Round of 16", "Quarterfinals", "Semifinals", "Final". */
function roundLabel(round: number, totalRounds: number, bracket: 'main' | 'consolation'): string {
  if (round === totalRounds) return bracket === 'consolation' ? 'Consolation Final' : 'Final';
  if (round === totalRounds - 1) return 'Semifinals';
  if (round === totalRounds - 2) return 'Quarterfinals';
  const playersLeft = 2 ** (totalRounds - round + 1);
  return `Round of ${playersLeft}`;
}

/** Split "6-4, 6-2" into per-side game tallies: { a: ['6','6'], b: ['4','2'] }. */
function parseScoreSets(score: string | null): { a: string[]; b: string[] } | null {
  if (!score) return null;
  const setPairs = score.split(/[,\s]+/).filter(Boolean);
  const a: string[] = [];
  const b: string[] = [];
  for (const s of setPairs) {
    const m = s.match(/^(\d+)-(\d+)$/);
    if (!m) return null;
    a.push(m[1]);
    b.push(m[2]);
  }
  return a.length === 0 ? null : { a, b };
}

/** Format a team for a bracket row: "Smith / Jones" or just "Smith" for singles. */
function formatTeamName(entry: { player_name: string; partner_name: string | null } | null): string {
  if (!entry) return '';
  if (entry.partner_name) return `${entry.player_name} / ${entry.partner_name}`;
  return entry.player_name;
}

/** Single team row in a bracket match card — seed chip, name(s), score digits per set. */
function TeamRow({
  entry,
  won,
  dimmed,
  sets,
  marker,
}: {
  entry: Entry | null | undefined;
  won: boolean;
  dimmed: boolean;
  sets: string[] | null;
  marker?: string | null;
}) {
  if (!entry) {
    return (
      <div className="px-3 py-2 flex items-center justify-between gap-2 min-h-[42px]">
        <div className="flex items-center gap-2 text-gray-400 italic text-sm">
          <span className="w-6 inline-block text-center">—</span>
          TBD
        </div>
      </div>
    );
  }
  return (
    <div
      className={`px-3 py-2 flex items-center justify-between gap-2 min-h-[42px] ${
        won ? 'bg-emerald-50' : dimmed ? 'opacity-60' : ''
      }`}
    >
      <div className="flex items-center gap-2 min-w-0">
        <span
          className={`w-6 h-5 inline-flex items-center justify-center text-[10px] font-bold rounded flex-shrink-0 ${
            entry.seed != null ? 'bg-gray-900 text-white' : 'text-gray-300 border border-gray-200'
          }`}
        >
          {entry.seed ?? '·'}
        </span>
        <span className={`truncate text-sm text-gray-900 ${won ? 'font-bold' : 'font-medium'}`}>
          {formatTeamName(entry)}
        </span>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        {sets && sets.length > 0 && (
          <div
            className={`font-mono text-sm tabular-nums whitespace-nowrap flex gap-1.5 ${
              won ? 'font-bold text-gray-900' : 'text-gray-600'
            }`}
          >
            {sets.map((g, i) => (
              <span key={i}>{g}</span>
            ))}
          </div>
        )}
        {won && marker && (
          <span className="px-1.5 py-0.5 bg-gray-900 text-white text-[10px] font-bold rounded tracking-wider">
            {marker}
          </span>
        )}
      </div>
    </div>
  );
}

export default function TournamentAdminDashboard({ eventId }: { eventId: string }) {
  const [event, setEvent] = useState<EventRow | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [tab, setTab] = useState<Tab>('entries');
  const [busy, setBusy] = useState<string | null>(null);
  const [emailing, setEmailing] = useState(false);
  const [emailResult, setEmailResult] = useState<{ sent: number; total: number } | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [scoreInput, setScoreInput] = useState<{
    score: string;
    winner_side: '' | 'a' | 'b';
    outcome: ScoreOutcome;
  }>({ score: '', winner_side: '', outcome: 'played' });
  const [showAdd, setShowAdd] = useState(false);
  const [newPlayer, setNewPlayer] = useState({
    player_name: '',
    player_email: '',
    parent_email: '',
    gender: '' as '' | 'male' | 'female' | 'nonbinary',
    ntrp: '',
    utr: '',
    partner_name: '',
  });
  const [scheduling, setScheduling] = useState(false);
  const [emailMode, setEmailMode] = useState<'scoring' | 'schedule' | null>(null);

  // Bracket-connector SVG paths, keyed by bracket name. Recomputed on layout
  // changes via useLayoutEffect (see below).
  const canvasRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [connectorPaths, setConnectorPaths] = useState<Record<string, string[]>>({});

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const supabase = createClient();
    const { data: ev, error: evErr } = await supabase
      .from('events')
      .select(
        'id, name, slug, match_format, public_status, entry_fee_cents, max_players, num_courts, court_names, event_date, daily_start_time, daily_end_time, default_match_length_minutes'
      )
      .eq('id', eventId)
      .maybeSingle();
    if (evErr) {
      setError(evErr.message);
      setLoading(false);
      return;
    }
    setEvent(ev as EventRow);

    const [eRes, mRes] = await Promise.all([
      supabase
        .from('tournament_entries')
        .select(
          'id, player_name, player_email, parent_email, partner_name, ntrp, utr, composite_rating, position, payment_status, registered_at, seed'
        )
        .eq('event_id', eventId)
        .order('registered_at', { ascending: true }),
      supabase
        .from('tournament_matches')
        .select('id, bracket, round, slot, match_type, player1_id, player2_id, player3_id, player4_id, score, winner_side, status, score_token, court, scheduled_at, scheduled_date, winner_feeds_to')
        .eq('event_id', eventId)
        .order('round'),
    ]);
    setEntries((eRes.data as Entry[]) || []);
    setMatches((mRes.data as Match[]) || []);
    setLoading(false);
  }, [eventId]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  /**
   * Measure each match card's position and build SVG paths connecting each
   * match to its winner_feeds_to destination. Path goes: right edge of source
   * → horizontal to midpoint of column gap → vertical to dest height →
   * horizontal to left edge of dest. Recomputed when matches/editing change
   * or the window resizes.
   */
  useLayoutEffect(() => {
    const compute = () => {
      const next: Record<string, string[]> = {};
      for (const bracket of ['main', 'consolation'] as const) {
        const container = canvasRefs.current[bracket];
        if (!container) continue;
        const bMatches = matches.filter((m) => m.bracket === bracket);
        if (bMatches.length === 0) continue;
        const matchByPosition = new Map<string, Match>();
        for (const m of bMatches) {
          matchByPosition.set(`${m.bracket}:${m.round}:${m.slot}`, m);
        }
        const containerRect = container.getBoundingClientRect();
        const matchRects = new Map<string, DOMRect>();
        container.querySelectorAll<HTMLElement>('[data-match-id]').forEach((el) => {
          if (el.dataset.matchId) matchRects.set(el.dataset.matchId, el.getBoundingClientRect());
        });
        const paths: string[] = [];
        for (const m of bMatches) {
          if (!m.winner_feeds_to) continue;
          const parts = m.winner_feeds_to.split(':');
          if (parts.length < 3) continue;
          const dest = matchByPosition.get(`${parts[0]}:${parts[1]}:${parts[2]}`);
          if (!dest) continue;
          const src = matchRects.get(m.id);
          const dst = matchRects.get(dest.id);
          if (!src || !dst) continue;
          const srcX = src.right - containerRect.left;
          const srcY = src.top + src.height / 2 - containerRect.top;
          const dstX = dst.left - containerRect.left;
          const dstY = dst.top + dst.height / 2 - containerRect.top;
          const midX = (srcX + dstX) / 2;
          paths.push(`M ${srcX} ${srcY} H ${midX} V ${dstY} H ${dstX}`);
        }
        next[bracket] = paths;
      }
      setConnectorPaths(next);
    };
    compute();
    // Re-measure on resize. RAF guard against layout thrash.
    let raf = 0;
    const onResize = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(compute);
    };
    window.addEventListener('resize', onResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
    };
  }, [matches, editing, tab]);

  const publicUrl = useMemo(() => {
    if (!event) return '';
    if (typeof window === 'undefined') return `/tournaments/${event.slug}`;
    return `${window.location.origin}/tournaments/${event.slug}`;
  }, [event]);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(publicUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* swallow */
    }
  };

  const removeEntry = async (entryId: string) => {
    if (!confirm('Remove this entry permanently?')) return;
    const supabase = createClient();
    await supabase.from('tournament_entries').delete().eq('id', entryId);
    await fetchAll();
  };

  const setPosition = async (entryId: string, position: 'in_draw' | 'waitlist' | 'withdrawn') => {
    setBusy(entryId);
    await fetch(`/api/tournaments/entries/${entryId}/position`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ position }),
    });
    await fetchAll();
    setBusy(null);
  };

  const addManualEntry = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy('add');
    setError(null);
    const res = await fetch(`/api/tournaments/events/${eventId}/add-entry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        player_name: newPlayer.player_name,
        player_email: newPlayer.player_email,
        parent_email: newPlayer.parent_email,
        gender: newPlayer.gender,
        ntrp: newPlayer.ntrp ? parseFloat(newPlayer.ntrp) : null,
        utr: newPlayer.utr ? parseFloat(newPlayer.utr) : null,
        partner_name: newPlayer.partner_name,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || 'Could not add entry');
      setBusy(null);
      return;
    }
    setNewPlayer({
      player_name: '',
      player_email: '',
      parent_email: '',
      gender: '',
      ntrp: '',
      utr: '',
      partner_name: '',
    });
    setShowAdd(false);
    await fetchAll();
    setBusy(null);
  };

  const autoSchedule = async () => {
    if (
      matches.some((m) => m.scheduled_at) &&
      !confirm('Auto-schedule will overwrite existing court + time assignments. Continue?')
    )
      return;
    setScheduling(true);
    await fetch(`/api/tournaments/events/${eventId}/auto-schedule`, { method: 'POST' });
    await fetchAll();
    setScheduling(false);
  };

  const updateMatchSchedule = async (
    matchId: string,
    field: 'court' | 'scheduled_at' | 'scheduled_date',
    value: string
  ) => {
    const supabase = createClient();
    await supabase
      .from('tournament_matches')
      .update({ [field]: value || null })
      .eq('id', matchId);
    await fetchAll();
  };

  const emailSchedules = async () => {
    if (!confirm('Email each confirmed player their personal match schedule?')) return;
    setEmailMode('schedule');
    setEmailResult(null);
    try {
      const res = await fetch(`/api/tournaments/events/${eventId}/email-schedules`, {
        method: 'POST',
      });
      const data = await res.json();
      setEmailResult(data);
    } catch {
      /* swallow */
    }
    setEmailMode(null);
  };

  const generateBracket = async () => {
    if (
      matches.length > 0 &&
      !confirm(
        'Regenerate bracket? This wipes existing matches and re-seeds players by current rating.'
      )
    )
      return;
    setBusy('generate');
    try {
      const res = await fetch(`/api/tournaments/events/${eventId}/generate-bracket`, {
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Failed to generate bracket');
        setBusy(null);
        return;
      }
      await fetchAll();
      setTab('matches');
    } catch (err: any) {
      setError(err?.message || 'Network error');
    }
    setBusy(null);
  };

  const emailScoringLinks = async () => {
    if (
      !confirm('Email a personal scoring link to every confirmed player?')
    )
      return;
    setEmailing(true);
    setEmailMode('scoring');
    setEmailResult(null);
    try {
      const res = await fetch(`/api/tournaments/events/${eventId}/email-scoring-links`, {
        method: 'POST',
      });
      const data = await res.json();
      setEmailResult(data);
    } catch {
      /* swallow */
    }
    setEmailing(false);
    setEmailMode(null);
  };

  const completeTournament = async () => {
    if (!confirm('Complete this tournament and open the public results page?')) return;
    try {
      const res = await fetch(`/api/tournaments/events/${eventId}/complete`, { method: 'POST' });
      const data = await res.json();
      if (res.ok && data.slug) {
        window.location.href = `/tournaments/${data.slug}/results`;
      }
    } catch {
      /* swallow */
    }
  };

  const openEdit = (m: Match) => {
    setEditing(m.id);
    const { outcome, cleanScore } = detectOutcome(m.score);
    setScoreInput({ score: cleanScore, winner_side: m.winner_side ?? '', outcome });
  };

  const saveScore = async (m: Match) => {
    if (!scoreInput.winner_side) return;
    if (!isValidTournamentScore(scoreInput.score, scoreInput.outcome)) return;
    setBusy(m.id);
    try {
      const res = await fetch(`/api/tournaments/match/${m.score_token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          winner_side: scoreInput.winner_side,
          score: buildScoreString(scoreInput.score, scoreInput.outcome),
          reported_by_name: 'Director',
        }),
      });
      if (res.ok) {
        setEditing(null);
        await fetchAll();
      }
    } catch {
      /* swallow */
    }
    setBusy(null);
  };

  const updateSeed = async (entryId: string, seedValue: string) => {
    const supabase = createClient();
    const trimmed = seedValue.trim();
    const seed = trimmed === '' ? null : parseInt(trimmed, 10);
    if (seed !== null && (!Number.isFinite(seed) || seed < 1 || seed > 999)) return;
    await supabase.from('tournament_entries').update({ seed }).eq('id', entryId);
    await fetchAll();
  };

  /** Wrap a CSV cell: quote + escape only when it contains a comma, quote, or newline. */
  const csvCell = (val: string | number | null | undefined): string => {
    const s = val == null ? '' : String(val);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  /** Download the entrant list as a CSV — client-side, sorted like the table. */
  const exportEntries = () => {
    if (!event) return;
    const rows = [...entries].sort((a, b) => {
      const aSeed = a.seed ?? Infinity;
      const bSeed = b.seed ?? Infinity;
      if (aSeed !== bSeed) return aSeed - bSeed;
      return (b.composite_rating ?? 0) - (a.composite_rating ?? 0);
    });
    const headers = [
      'Seed',
      'Player',
      'Partner',
      'Player Email',
      'Parent Email',
      'Rating',
      'Status',
      'Payment',
      'Registered',
    ];
    const lines = rows.map((e) =>
      [
        e.seed ?? '',
        e.player_name,
        e.partner_name ?? '',
        e.player_email ?? '',
        e.parent_email ?? '',
        e.utr ? `UTR ${e.utr.toFixed(2)}` : e.ntrp ? `NTRP ${e.ntrp.toFixed(1)}` : '',
        POSITION_LABELS[e.position].label,
        e.payment_status,
        e.registered_at ? new Date(e.registered_at).toLocaleString() : '',
      ]
        .map(csvCell)
        .join(',')
    );
    const csv = [headers.join(','), ...lines].join('\r\n');
    // BOM so Excel reads UTF-8 names (apostrophes/accents) correctly.
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${event.slug}-entrants.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="animate-spin text-orange-500" size={24} />
      </div>
    );
  }

  if (error || !event) {
    return (
      <div className="p-4 sm:p-6">
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-3 flex items-start gap-2">
          <AlertCircle size={16} className="mt-0.5" />
          <div>
            <p className="font-medium">Failed to load tournament.</p>
            {error && <p className="text-sm">{error}</p>}
          </div>
        </div>
      </div>
    );
  }

  const inDraw = entries.filter((x) => x.position === 'in_draw').length;
  const waitlist = entries.filter((x) => x.position === 'waitlist').length;
  const pending = entries.filter((x) => x.position === 'pending_payment').length;
  const allMatchesDone =
    matches.length > 0 && matches.every((m) => m.status === 'completed');

  const entryById = new Map(entries.map((e) => [e.id, e]));
  const labelEntry = (id: string | null) => {
    if (!id) return 'TBD';
    const e = entryById.get(id);
    if (!e) return '—';
    if (e.partner_name) return `${e.player_name} + ${e.partner_name}`;
    return e.player_name;
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-6xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/mixer/home" className="p-2 hover:bg-gray-100 rounded-lg">
          <ArrowLeft size={20} />
        </Link>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="font-semibold text-2xl text-gray-900 truncate">{event.name}</h1>
            <span className="px-2 py-0.5 bg-orange-100 text-orange-700 rounded-full text-xs font-medium">
              {FORMAT_LABELS[event.match_format] ?? event.match_format}
            </span>
            <span
              className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                event.public_status === 'open'
                  ? 'bg-emerald-100 text-emerald-700'
                  : event.public_status === 'running'
                    ? 'bg-blue-100 text-blue-700'
                    : event.public_status === 'completed'
                      ? 'bg-gray-200 text-gray-700'
                      : 'bg-amber-100 text-amber-700'
              }`}
            >
              {event.public_status}
            </span>
          </div>
          <p className="text-gray-500 text-sm">
            {inDraw} confirmed · {waitlist} waitlist · {pending} pending · {matches.length} matches
          </p>
        </div>
      </div>

      <div className="bg-orange-50 border border-orange-200 rounded-xl p-3 mb-6 flex items-center gap-3 flex-wrap">
        <Share2 size={16} className="text-orange-600 flex-shrink-0" />
        <div className="text-sm text-orange-900 flex-1 truncate">
          Public signup:{' '}
          <a href={publicUrl} target="_blank" className="font-mono underline">
            {publicUrl}
          </a>
        </div>
        <button
          onClick={copyLink}
          className="inline-flex items-center gap-1 px-2 py-1 bg-orange-600 hover:bg-orange-700 text-white rounded text-xs font-semibold flex-shrink-0"
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
          {copied ? 'Copied!' : 'Copy'}
        </button>
        <Link
          href={`/mixer/events/${eventId}/dj`}
          target="_blank"
          className="inline-flex items-center gap-1 px-2 py-1 bg-yellow-300 hover:bg-yellow-200 text-[#001820] rounded text-xs font-bold flex-shrink-0"
        >
          <Music size={12} />
          DJ Console
        </Link>
        <Link
          href={`/mixer/events/${eventId}/console`}
          target="_blank"
          className="inline-flex items-center gap-1 px-2 py-1 bg-[#001820] hover:bg-black text-white rounded text-xs font-semibold flex-shrink-0"
        >
          <Tv size={12} />
          Live Console
        </Link>
        <Link
          href={`/tournaments/${event.slug}/draw`}
          target="_blank"
          className="inline-flex items-center gap-1 px-2 py-1 bg-white hover:bg-gray-50 border border-gray-300 text-gray-700 rounded text-xs font-semibold flex-shrink-0"
        >
          <Printer size={12} />
          Print Draw
        </Link>
      </div>

      <div className="border-b border-gray-200 mb-6 flex gap-1 overflow-x-auto">
        {(['entries', 'matches', 'schedule', 'settings'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 border-b-2 font-medium text-sm whitespace-nowrap capitalize ${
              tab === t
                ? 'border-orange-500 text-orange-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'entries' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="text-sm text-gray-600">
              {entries.length} total · sorted by rating
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={exportEntries}
                disabled={entries.length === 0}
                className="inline-flex items-center gap-2 px-3 py-2 border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
                title="Download the entrant list as a CSV (opens in Excel/Sheets)"
              >
                <Download size={14} />
                Export CSV
              </button>
              <button
                onClick={() => setShowAdd((s) => !s)}
                className="inline-flex items-center gap-2 px-3 py-2 bg-orange-500 text-white rounded-lg text-sm font-medium hover:bg-orange-600"
              >
                <UserPlus size={14} />
                {showAdd ? 'Cancel' : 'Add player manually'}
              </button>
            </div>
          </div>

          {showAdd && (
            <form
              onSubmit={addManualEntry}
              className="bg-white border border-gray-200 rounded-xl p-4 space-y-3"
            >
              <h3 className="font-semibold">Add player (director override)</h3>
              <div className="grid sm:grid-cols-2 gap-3">
                <input
                  type="text"
                  required
                  placeholder="Player name"
                  value={newPlayer.player_name}
                  onChange={(e) => setNewPlayer({ ...newPlayer, player_name: e.target.value })}
                  className="px-3 py-2 border rounded-lg text-gray-900 text-sm"
                />
                <input
                  type="email"
                  placeholder="Player email"
                  value={newPlayer.player_email}
                  onChange={(e) => setNewPlayer({ ...newPlayer, player_email: e.target.value })}
                  className="px-3 py-2 border rounded-lg text-gray-900 text-sm"
                />
                <input
                  type="email"
                  placeholder="Parent email"
                  value={newPlayer.parent_email}
                  onChange={(e) => setNewPlayer({ ...newPlayer, parent_email: e.target.value })}
                  className="px-3 py-2 border rounded-lg text-gray-900 text-sm"
                />
                <select
                  value={newPlayer.gender}
                  onChange={(e) =>
                    setNewPlayer({
                      ...newPlayer,
                      gender: e.target.value as typeof newPlayer.gender,
                    })
                  }
                  className="px-3 py-2 border rounded-lg text-gray-900 text-sm"
                >
                  <option value="">Gender (optional)</option>
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                  <option value="nonbinary">Non-binary</option>
                </select>
                <input
                  type="number"
                  step="0.5"
                  min={1}
                  max={7}
                  placeholder="NTRP"
                  value={newPlayer.ntrp}
                  onChange={(e) => setNewPlayer({ ...newPlayer, ntrp: e.target.value })}
                  className="px-3 py-2 border rounded-lg text-gray-900 text-sm"
                />
                <input
                  type="number"
                  step="0.01"
                  min={1}
                  max={16}
                  placeholder="UTR"
                  value={newPlayer.utr}
                  onChange={(e) => setNewPlayer({ ...newPlayer, utr: e.target.value })}
                  className="px-3 py-2 border rounded-lg text-gray-900 text-sm"
                />
                {event.match_format.endsWith('-doubles') && (
                  <input
                    type="text"
                    placeholder="Doubles partner name"
                    value={newPlayer.partner_name}
                    onChange={(e) => setNewPlayer({ ...newPlayer, partner_name: e.target.value })}
                    className="px-3 py-2 border rounded-lg text-gray-900 text-sm sm:col-span-2"
                  />
                )}
              </div>
              <button
                type="submit"
                disabled={busy === 'add' || !newPlayer.player_name.trim()}
                className="px-4 py-2 bg-orange-500 text-white rounded-lg text-sm font-medium hover:bg-orange-600 disabled:opacity-50"
              >
                {busy === 'add' ? 'Adding…' : 'Add player'}
              </button>
              <p className="text-xs text-gray-500">
                Manual adds skip Stripe (payment marked waived). Lands as Confirmed if cap allows,
                else Waitlist.
              </p>
            </form>
          )}

          {entries.length === 0 ? (
            <div className="bg-white border border-gray-200 rounded-xl p-8 text-center text-gray-500 text-sm">
              No entries yet. Share the public link or click "Add player manually" above.
            </div>
          ) : (
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-600">
                  <tr>
                    <th className="text-left px-3 py-2 w-16" title="Manual seed — overrides rating-based seeding when bracket is generated">Seed</th>
                    <th className="text-left px-3 py-2">Player</th>
                    <th className="text-left px-3 py-2">Rating</th>
                    <th className="text-left px-3 py-2">Status</th>
                    <th className="text-left px-3 py-2">Pmt</th>
                    <th className="text-right px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {entries
                    .sort((a, b) => {
                      // Manual seeds first (lowest seed = top), then by composite rating
                      const aSeed = a.seed ?? Infinity;
                      const bSeed = b.seed ?? Infinity;
                      if (aSeed !== bSeed) return aSeed - bSeed;
                      return (b.composite_rating ?? 0) - (a.composite_rating ?? 0);
                    })
                    .map((entry) => {
                      const pos = POSITION_LABELS[entry.position];
                      return (
                        <tr key={entry.id} className="border-t border-gray-100">
                          <td className="px-2 py-2">
                            <input
                              type="number"
                              min={1}
                              max={999}
                              defaultValue={entry.seed ?? ''}
                              onBlur={(e) => {
                                const v = e.target.value;
                                const cur = entry.seed?.toString() ?? '';
                                if (v !== cur) updateSeed(entry.id, v);
                              }}
                              placeholder="—"
                              className="w-12 px-1.5 py-1 border border-gray-200 rounded text-center text-xs bg-white text-gray-900"
                              title="Set seed; blank = unseeded"
                            />
                          </td>
                          <td className="px-3 py-2">
                            <div className="font-medium text-gray-900">{entry.player_name}</div>
                            <div className="text-xs text-gray-500">
                              {entry.player_email || entry.parent_email || '—'}
                              {entry.partner_name && ` · w/ ${entry.partner_name}`}
                            </div>
                          </td>
                          <td className="px-3 py-2 text-gray-700">
                            {entry.utr ? `UTR ${entry.utr.toFixed(2)}` : entry.ntrp ? `NTRP ${entry.ntrp.toFixed(1)}` : '—'}
                          </td>
                          <td className="px-3 py-2">
                            <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${pos.color}`}>
                              {pos.label}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-gray-700 text-xs">{entry.payment_status}</td>
                          <td className="px-3 py-2 text-right">
                            <div className="inline-flex items-center gap-1">
                              {entry.position === 'waitlist' && (
                                <button
                                  onClick={() => setPosition(entry.id, 'in_draw')}
                                  disabled={busy === entry.id}
                                  title="Promote to confirmed"
                                  className="p-1.5 hover:bg-emerald-50 text-emerald-600 rounded"
                                >
                                  <ArrowUp size={14} />
                                </button>
                              )}
                              {entry.position === 'in_draw' && (
                                <button
                                  onClick={() => setPosition(entry.id, 'waitlist')}
                                  disabled={busy === entry.id}
                                  title="Move to waitlist"
                                  className="p-1.5 hover:bg-amber-50 text-amber-600 rounded"
                                >
                                  <ArrowDown size={14} />
                                </button>
                              )}
                              <button
                                onClick={() => removeEntry(entry.id)}
                                className="p-1.5 hover:bg-red-50 text-red-500 rounded"
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          )}

          {inDraw >= 2 && matches.length === 0 && (
            <div className="bg-emerald-50 border-2 border-emerald-300 rounded-xl p-4 sm:p-5 flex items-center justify-between gap-3">
              <div>
                <div className="font-semibold text-emerald-900 flex items-center gap-2">
                  <Wand2 size={16} />
                  Ready to draw
                </div>
                <p className="text-sm text-emerald-800 mt-0.5">
                  {inDraw} confirmed players. Generate the bracket to seed by rating and create matches.
                </p>
              </div>
              <button
                onClick={generateBracket}
                disabled={busy === 'generate'}
                className="inline-flex items-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-semibold text-sm flex-shrink-0 disabled:opacity-50"
              >
                {busy === 'generate' ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />}
                {busy === 'generate' ? 'Generating…' : 'Generate Bracket'}
              </button>
            </div>
          )}
        </div>
      )}

      {tab === 'matches' && (
        <div className="space-y-4">
          <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
            <div>
              <h3 className="font-semibold">Schedule + notify players</h3>
              <p className="text-sm text-gray-600">
                Auto-schedule places matches across courts + time slots.
                Score matches inline; winners auto-advance.
              </p>
              {emailResult && (
                <p className="text-sm text-emerald-700 mt-2 font-medium">
                  ✓ Sent {emailResult.sent} of {emailResult.total}{' '}
                  {emailMode === 'schedule' ? 'schedule' : 'scoring-link'} emails.
                </p>
              )}
            </div>
            <div className="flex gap-2 flex-wrap">
              <button
                onClick={autoSchedule}
                disabled={scheduling || matches.length === 0}
                className="inline-flex items-center gap-2 px-3 py-2 bg-orange-500 hover:bg-orange-600 text-white rounded-lg text-sm font-semibold disabled:opacity-50"
              >
                {scheduling ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />}
                {scheduling ? 'Scheduling…' : 'Auto-schedule'}
              </button>
              <button
                onClick={emailSchedules}
                disabled={emailMode !== null || matches.every((m) => !m.scheduled_at)}
                className="inline-flex items-center gap-2 px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-semibold disabled:opacity-50"
              >
                {emailMode === 'schedule' ? <Loader2 size={14} className="animate-spin" /> : <Calendar size={14} />}
                Email schedules
              </button>
              <button
                onClick={emailScoringLinks}
                disabled={emailMode !== null || matches.length === 0}
                className="inline-flex items-center gap-2 px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-semibold disabled:opacity-50"
              >
                {emailMode === 'scoring' ? <Loader2 size={14} className="animate-spin" /> : <Mail size={14} />}
                Email scoring links
              </button>
              {matches.length > 0 && (
                <button
                  onClick={generateBracket}
                  disabled={busy === 'generate'}
                  className="inline-flex items-center gap-2 px-3 py-2 border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
                >
                  <Wand2 size={14} />
                  Regenerate
                </button>
              )}
            </div>
          </div>

          {matches.length === 0 ? (
            <div className="bg-gray-50 border border-gray-200 rounded-xl p-8 text-center text-sm text-gray-500">
              No matches yet — generate the bracket from the Entries tab.
            </div>
          ) : (
            <>
              {(['main', 'consolation'] as const)
                .filter((bracket) => matches.some((m) => m.bracket === bracket))
                .map((bracket) => {
                  const bracketMatches = matches.filter((m) => m.bracket === bracket);
                  const rounds = Array.from(new Set(bracketMatches.map((m) => m.round))).sort(
                    (a, b) => a - b
                  );
                  const totalRounds = rounds.length;
                  return (
                    <div
                      key={bracket}
                      className="bg-white border border-gray-200 rounded-xl p-4 overflow-x-auto"
                    >
                      <div className="flex items-baseline justify-between mb-4">
                        <h3 className="font-semibold text-gray-900">
                          {bracket === 'main' ? 'Main Draw' : 'Consolation Draw'}
                        </h3>
                        <span className="text-xs text-gray-500">
                          {bracketMatches.length} matches · {totalRounds} {totalRounds === 1 ? 'round' : 'rounds'}
                        </span>
                      </div>
                      <div
                        ref={(el) => {
                          canvasRefs.current[bracket] = el;
                        }}
                        className="relative min-w-max"
                      >
                        <svg
                          className="absolute inset-0 pointer-events-none"
                          width="100%"
                          height="100%"
                        >
                          {(connectorPaths[bracket] ?? []).map((d, i) => (
                            <path
                              key={i}
                              d={d}
                              stroke="#d1d5db"
                              strokeWidth={1.5}
                              fill="none"
                            />
                          ))}
                        </svg>
                      <div className="flex gap-6 min-w-max pb-2 items-stretch relative">
                        {rounds.map((round, roundIdx) => {
                          const roundMatches = bracketMatches
                            .filter((m) => m.round === round)
                            .sort((a, b) => a.slot - b.slot);
                          return (
                            <div
                              key={round}
                              className="flex flex-col min-w-[280px]"
                            >
                              <div className="text-center text-[11px] font-bold uppercase tracking-wider text-gray-600 mb-3 pb-2 border-b border-gray-200">
                                {roundLabel(roundIdx + 1, totalRounds, bracket)}
                              </div>
                              <div className="flex-1 flex flex-col justify-around gap-4">
                                {roundMatches.map((m) => {
                                  const teamA = m.player1_id ? entryById.get(m.player1_id) : null;
                                  const teamB = m.player3_id ? entryById.get(m.player3_id) : null;
                                  const aWon = m.winner_side === 'a';
                                  const bWon = m.winner_side === 'b';
                                  const isPending = m.status !== 'completed';
                                  const canScore = !!(m.player1_id && m.player3_id);
                                  const isOpen = editing === m.id;
                                  const { outcome: matchOutcome, cleanScore } = detectOutcome(m.score);
                                  const parsed = parseScoreSets(cleanScore);
                                  const marker =
                                    matchOutcome === 'walkover'
                                      ? 'W/O'
                                      : matchOutcome === 'default'
                                        ? 'DEF'
                                        : matchOutcome === 'retired'
                                          ? 'RET'
                                          : null;

                                  if (isOpen) {
                                    const aLabel = formatTeamName(teamA ?? null) || 'Side A';
                                    const bLabel = formatTeamName(teamB ?? null) || 'Side B';
                                    const outcomeOptions: { id: ScoreOutcome; label: string; hint: string }[] = [
                                      { id: 'played', label: 'Played', hint: 'Match completed normally' },
                                      { id: 'walkover', label: 'Walkover', hint: 'Opponent no-show — no match played' },
                                      { id: 'retired', label: 'Retired', hint: 'Played partial — one team had to stop' },
                                      { id: 'default', label: 'Default', hint: 'Disqualification / penalty' },
                                    ];
                                    const showScoreInput =
                                      scoreInput.outcome === 'played' || scoreInput.outcome === 'retired';
                                    return (
                                      <div
                                        key={m.id}
                                        className="border-2 border-orange-400 bg-orange-50 rounded-lg p-3 space-y-2"
                                      >
                                        <div className="text-[10px] font-semibold uppercase tracking-wider text-orange-700">
                                          Enter Score
                                        </div>
                                        <div className="grid grid-cols-2 gap-2 text-xs">
                                          <button
                                            onClick={() =>
                                              setScoreInput({ ...scoreInput, winner_side: 'a' })
                                            }
                                            className={`px-2 py-1.5 rounded font-medium ${
                                              scoreInput.winner_side === 'a'
                                                ? 'bg-emerald-600 text-white'
                                                : 'bg-white border border-gray-300 text-gray-700'
                                            }`}
                                          >
                                            {aLabel} won
                                          </button>
                                          <button
                                            onClick={() =>
                                              setScoreInput({ ...scoreInput, winner_side: 'b' })
                                            }
                                            className={`px-2 py-1.5 rounded font-medium ${
                                              scoreInput.winner_side === 'b'
                                                ? 'bg-emerald-600 text-white'
                                                : 'bg-white border border-gray-300 text-gray-700'
                                            }`}
                                          >
                                            {bLabel} won
                                          </button>
                                        </div>

                                        <div>
                                          <label className="block text-[10px] font-semibold uppercase tracking-wider text-gray-600 mb-1">
                                            Outcome
                                          </label>
                                          <div className="grid grid-cols-4 gap-1">
                                            {outcomeOptions.map((opt) => (
                                              <button
                                                key={opt.id}
                                                type="button"
                                                title={opt.hint}
                                                onClick={() =>
                                                  setScoreInput({ ...scoreInput, outcome: opt.id })
                                                }
                                                className={`px-1 py-1.5 rounded text-[11px] font-medium ${
                                                  scoreInput.outcome === opt.id
                                                    ? 'bg-gray-900 text-white'
                                                    : 'bg-white border border-gray-300 text-gray-700 hover:border-gray-400'
                                                }`}
                                              >
                                                {opt.label}
                                              </button>
                                            ))}
                                          </div>
                                        </div>

                                        {showScoreInput && (
                                          <>
                                            <input
                                              type="text"
                                              placeholder={
                                                scoreInput.outcome === 'retired'
                                                  ? 'Partial score (e.g. "6-2, 3-1") — optional'
                                                  : 'Score — e.g. "6-3, 6-4"'
                                              }
                                              value={scoreInput.score}
                                              onChange={(e) =>
                                                setScoreInput({ ...scoreInput, score: e.target.value })
                                              }
                                              className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm bg-white text-gray-900"
                                            />
                                            {scoreInput.score &&
                                              !isValidTournamentScore(
                                                scoreInput.score,
                                                scoreInput.outcome
                                              ) && (
                                                <div className="text-xs text-red-600">
                                                  Format must be like <code>6-3</code> or <code>6-3, 6-4</code>.
                                                </div>
                                              )}
                                          </>
                                        )}

                                        {!showScoreInput && (
                                          <div className="text-xs text-gray-600 bg-white rounded px-2 py-1.5 border border-gray-200">
                                            Will record as{' '}
                                            <span className="font-mono font-semibold">
                                              {scoreInput.outcome === 'walkover' ? 'W/O' : 'DEF'}
                                            </span>{' '}
                                            — no match score.
                                          </div>
                                        )}

                                        <div className="flex gap-2">
                                          <button
                                            onClick={() => setEditing(null)}
                                            className="flex-1 px-2 py-1.5 text-xs border border-gray-300 rounded hover:bg-gray-50 text-gray-700"
                                          >
                                            Cancel
                                          </button>
                                          <button
                                            onClick={() => saveScore(m)}
                                            disabled={
                                              busy === m.id ||
                                              !scoreInput.winner_side ||
                                              !isValidTournamentScore(
                                                scoreInput.score,
                                                scoreInput.outcome
                                              )
                                            }
                                            className="flex-1 px-2 py-1.5 text-xs bg-orange-500 text-white rounded font-semibold hover:bg-orange-600 disabled:opacity-50"
                                          >
                                            {busy === m.id ? 'Saving…' : 'Save'}
                                          </button>
                                        </div>
                                      </div>
                                    );
                                  }

                                  return (
                                    <div
                                      key={m.id}
                                      data-match-id={m.id}
                                      className="border border-gray-300 rounded-lg bg-white shadow-sm overflow-hidden"
                                    >
                                      <TeamRow
                                        entry={teamA ?? null}
                                        won={aWon}
                                        dimmed={bWon}
                                        sets={parsed?.a ?? null}
                                        marker={aWon ? marker : null}
                                      />
                                      <div className="border-t border-gray-200" />
                                      <TeamRow
                                        entry={teamB ?? null}
                                        won={bWon}
                                        dimmed={aWon}
                                        sets={parsed?.b ?? null}
                                        marker={bWon ? marker : null}
                                      />
                                      <div className="border-t border-gray-100 bg-gray-50 px-2.5 py-1.5 flex items-center justify-between gap-2 text-[11px]">
                                        <div className="flex items-center gap-1.5 text-gray-600 flex-wrap min-w-0">
                                          {m.court ? (
                                            <span className="font-medium text-gray-700">
                                              Court {m.court}
                                            </span>
                                          ) : (
                                            <span className="text-gray-400">No court</span>
                                          )}
                                          {m.scheduled_at && (
                                            <span className="text-gray-500">
                                              · {formatTimeDisplay(m.scheduled_at)}
                                            </span>
                                          )}
                                        </div>
                                        {canScore && isPending ? (
                                          <button
                                            onClick={() => openEdit(m)}
                                            className="px-2.5 py-1 bg-orange-500 hover:bg-orange-600 text-white rounded text-[11px] font-semibold whitespace-nowrap"
                                          >
                                            Enter Score
                                          </button>
                                        ) : !isPending ? (
                                          <button
                                            onClick={() => openEdit(m)}
                                            className="text-gray-500 hover:text-gray-900 flex items-center gap-1"
                                          >
                                            <Edit3 size={11} /> Edit
                                          </button>
                                        ) : (
                                          <span className="text-gray-400 italic">awaiting</span>
                                        )}
                                      </div>
                                      <div className="border-t border-gray-100 bg-white px-2.5 py-1.5 flex items-center gap-2 text-[10px] text-gray-500">
                                        <input
                                          type="date"
                                          defaultValue={m.scheduled_date ?? ''}
                                          onBlur={(e) => {
                                            const v = e.target.value;
                                            if ((m.scheduled_date ?? '') !== v)
                                              updateMatchSchedule(m.id, 'scheduled_date', v);
                                          }}
                                          className="px-1 py-0.5 border border-gray-200 rounded text-[10px] bg-white text-gray-700"
                                        />
                                        <input
                                          type="text"
                                          defaultValue={m.court ?? ''}
                                          onBlur={(e) => {
                                            const v = e.target.value.trim();
                                            if ((m.court ?? '') !== v)
                                              updateMatchSchedule(m.id, 'court', v);
                                          }}
                                          placeholder="Court"
                                          className="w-14 px-1 py-0.5 border border-gray-200 rounded text-[10px] bg-white text-gray-700"
                                        />
                                        <input
                                          type="time"
                                          defaultValue={m.scheduled_at?.slice(0, 5) ?? ''}
                                          onBlur={(e) => {
                                            const v = e.target.value;
                                            const current = m.scheduled_at?.slice(0, 5) ?? '';
                                            if (current !== v)
                                              updateMatchSchedule(m.id, 'scheduled_at', v);
                                          }}
                                          className="px-1 py-0.5 border border-gray-200 rounded text-[10px] bg-white text-gray-700"
                                        />
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                      </div>
                    </div>
                  );
                })}

              {allMatchesDone && event.public_status !== 'completed' && (
                <div className="bg-emerald-50 border-2 border-emerald-300 rounded-xl p-4 sm:p-5 flex items-center justify-between gap-3">
                  <div>
                    <div className="font-semibold text-emerald-900 flex items-center gap-2">
                      <PartyPopper size={16} /> All matches scored
                    </div>
                    <p className="text-sm text-emerald-800 mt-0.5">
                      Wrap it up — view final standings and share with players.
                    </p>
                  </div>
                  <button
                    onClick={completeTournament}
                    className="inline-flex items-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-semibold text-sm flex-shrink-0"
                  >
                    Complete tournament →
                  </button>
                </div>
              )}

              {event.public_status === 'completed' && (
                <div className="bg-emerald-50 border-2 border-emerald-300 rounded-xl p-4 flex items-center justify-between gap-3">
                  <div className="font-semibold text-emerald-900 flex items-center gap-2">
                    <PartyPopper size={16} /> Tournament complete
                  </div>
                  <a
                    href={`/tournaments/${event.slug}/results`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-semibold text-sm"
                  >
                    View results →
                  </a>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {tab === 'schedule' && (
        <ScheduleTab
          event={event}
          matches={matches}
          entries={entries}
          onUpdate={fetchAll}
        />
      )}

      {tab === 'settings' && (
        <div className="bg-white border border-gray-200 rounded-xl p-5 text-sm text-gray-600">
          <p className="font-medium text-gray-900 mb-2 flex items-center gap-2">
            <ListChecks size={16} /> Settings
          </p>
          <p>
            Inline editing of name / dates / fees / scoring format coming soon. For now, edit
            directly in Supabase if needed, or recreate the tournament.
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * Order-of-Play tab — drag-and-drop scheduling onto a Court × Time grid.
 *
 * - Left column: unscheduled matches (no court OR no scheduled_at).
 * - Right: a column per court showing scheduled matches sorted by time.
 * - Drag any match between columns to reassign court. Dropping on a court
 *   column without specifying time auto-picks the next free slot
 *   (latest scheduled_at + default_match_length_minutes, or daily start).
 * - Inline time editor on each scheduled card; drag to Unscheduled to clear.
 */
function ScheduleTab({
  event,
  matches,
  entries,
  onUpdate,
}: {
  event: EventRow;
  matches: Match[];
  entries: Entry[];
  onUpdate: () => void;
}) {
  const [dragOverCourt, setDragOverCourt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const entryById = useMemo(() => new Map(entries.map((e) => [e.id, e])), [entries]);

  const courts = useMemo(
    () =>
      resolveCourtList({
        courtNames: event.court_names ?? null,
        numCourts: event.num_courts ?? 0,
      }),
    [event.court_names, event.num_courts]
  );
  const matchLengthMin = event.default_match_length_minutes ?? 90;
  const dailyStart = (event.daily_start_time ?? '09:00').slice(0, 5);

  const isUnscheduled = (m: Match) => !m.court || !m.scheduled_at;
  const unscheduled = matches.filter(isUnscheduled);

  const matchesOnCourt = (court: string) =>
    matches
      .filter((m) => m.court === court && !!m.scheduled_at)
      .sort((a, b) => (a.scheduled_at ?? '').localeCompare(b.scheduled_at ?? ''));

  /** Add `minutes` to an HH:MM string, returning HH:MM. */
  const addMinutes = (hhmm: string, minutes: number): string => {
    const [h, m] = hhmm.split(':').map((x) => parseInt(x, 10));
    const total = h * 60 + m + minutes;
    const nh = Math.floor((total % (24 * 60)) / 60);
    const nm = total % 60;
    return `${String(nh).padStart(2, '0')}:${String(nm).padStart(2, '0')}`;
  };

  const nextFreeTimeOnCourt = (court: string): string => {
    const scheduled = matchesOnCourt(court);
    if (scheduled.length === 0) return dailyStart;
    const last = scheduled[scheduled.length - 1].scheduled_at ?? dailyStart;
    return addMinutes(last.slice(0, 5), matchLengthMin);
  };

  const updateMatch = async (
    matchId: string,
    updates: { court?: string | null; scheduled_at?: string | null; scheduled_date?: string | null }
  ) => {
    setBusy(true);
    const supabase = createClient();
    await supabase.from('tournament_matches').update(updates).eq('id', matchId);
    await onUpdate();
    setBusy(false);
  };

  const handleDragStart = (e: React.DragEvent, matchId: string) => {
    e.dataTransfer.setData('text/match-id', matchId);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDropOnCourt = async (e: React.DragEvent, court: string) => {
    e.preventDefault();
    setDragOverCourt(null);
    const matchId = e.dataTransfer.getData('text/match-id');
    if (!matchId) return;
    const m = matches.find((x) => x.id === matchId);
    if (!m) return;
    // If the match is already on this court with a time, no-op.
    if (m.court === court && m.scheduled_at) return;
    // Keep existing time if dragged from another court; otherwise auto-pick.
    const scheduled_at = m.scheduled_at ?? nextFreeTimeOnCourt(court);
    const scheduled_date = m.scheduled_date ?? event.event_date ?? null;
    await updateMatch(matchId, { court, scheduled_at, scheduled_date });
  };

  const handleDropOnUnscheduled = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOverCourt(null);
    const matchId = e.dataTransfer.getData('text/match-id');
    if (!matchId) return;
    await updateMatch(matchId, { court: null, scheduled_at: null });
  };

  const labelMatch = (m: Match): { a: string; b: string; round: string } => {
    const teamA = m.player1_id ? entryById.get(m.player1_id) : null;
    const teamB = m.player3_id ? entryById.get(m.player3_id) : null;
    return {
      a: teamA ? formatTeamName(teamA) : 'TBD',
      b: teamB ? formatTeamName(teamB) : 'TBD',
      round: `${m.bracket === 'consolation' ? 'C ' : ''}R${m.round}M${m.slot}`,
    };
  };

  if (courts.length === 0) {
    return (
      <div className="bg-amber-50 border border-amber-200 text-amber-900 rounded-xl p-5">
        <p className="font-medium">No courts configured.</p>
        <p className="text-sm mt-1">
          Set num_courts or court_names on this event to enable drag-and-drop scheduling.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="bg-white border border-gray-200 rounded-xl p-3 text-sm text-gray-700 flex items-center gap-2">
        <Calendar size={16} className="text-orange-500 flex-shrink-0" />
        <span>
          Drag matches between columns to (re)assign courts. Default match length{' '}
          <strong>{matchLengthMin} min</strong>; daily start <strong>{dailyStart}</strong>.
          Dropping on a court auto-picks the next free time slot.
        </span>
        {busy && <Loader2 size={14} className="animate-spin text-orange-500 flex-shrink-0" />}
      </div>

      <div className="flex gap-4 overflow-x-auto pb-2 items-start">
        {/* Unscheduled queue */}
        <ScheduleColumn
          title="Unscheduled"
          subtitle={`${unscheduled.length} match${unscheduled.length === 1 ? '' : 'es'}`}
          accent="gray"
          isDragOver={dragOverCourt === '__unscheduled__'}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOverCourt('__unscheduled__');
          }}
          onDragLeave={() => setDragOverCourt(null)}
          onDrop={handleDropOnUnscheduled}
        >
          {unscheduled.length === 0 ? (
            <div className="text-xs text-gray-400 italic text-center py-6">
              All matches scheduled
            </div>
          ) : (
            unscheduled.map((m) => {
              const lab = labelMatch(m);
              return (
                <ScheduleCard
                  key={m.id}
                  matchId={m.id}
                  onDragStart={handleDragStart}
                  pillLabel={lab.round}
                  teamA={lab.a}
                  teamB={lab.b}
                  time={null}
                  status={m.status}
                />
              );
            })
          )}
        </ScheduleColumn>

        {/* One column per court */}
        {courts.map((court) => {
          const scheduledHere = matchesOnCourt(court);
          return (
            <ScheduleColumn
              key={court}
              title={`Court ${court}`}
              subtitle={`${scheduledHere.length} match${scheduledHere.length === 1 ? '' : 'es'}`}
              accent="orange"
              isDragOver={dragOverCourt === court}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOverCourt(court);
              }}
              onDragLeave={() => setDragOverCourt(null)}
              onDrop={(e) => handleDropOnCourt(e, court)}
            >
              {scheduledHere.length === 0 ? (
                <div className="text-xs text-gray-400 italic text-center py-6">
                  Drop a match here
                </div>
              ) : (
                scheduledHere.map((m) => {
                  const lab = labelMatch(m);
                  return (
                    <ScheduleCard
                      key={m.id}
                      matchId={m.id}
                      onDragStart={handleDragStart}
                      pillLabel={lab.round}
                      teamA={lab.a}
                      teamB={lab.b}
                      time={m.scheduled_at?.slice(0, 5) ?? null}
                      onTimeChange={(v) =>
                        updateMatch(m.id, { scheduled_at: v || null })
                      }
                      status={m.status}
                    />
                  );
                })
              )}
            </ScheduleColumn>
          );
        })}
      </div>
    </div>
  );
}

function ScheduleColumn({
  title,
  subtitle,
  accent,
  isDragOver,
  onDragOver,
  onDragLeave,
  onDrop,
  children,
}: {
  title: string;
  subtitle: string;
  accent: 'gray' | 'orange';
  isDragOver: boolean;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent) => void;
  children: React.ReactNode;
}) {
  const accentClasses =
    accent === 'orange'
      ? 'border-orange-200'
      : 'border-gray-300';
  return (
    <div
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={`flex flex-col min-w-[240px] w-[240px] bg-white rounded-xl border-2 transition-colors ${
        isDragOver ? 'border-emerald-400 bg-emerald-50/40' : accentClasses
      }`}
    >
      <div className="p-3 border-b border-gray-200">
        <div className="font-semibold text-gray-900 text-sm">{title}</div>
        <div className="text-[10px] text-gray-500 uppercase tracking-wider">{subtitle}</div>
      </div>
      <div className="flex-1 p-2 space-y-2 min-h-[200px]">{children}</div>
    </div>
  );
}

function ScheduleCard({
  matchId,
  onDragStart,
  pillLabel,
  teamA,
  teamB,
  time,
  onTimeChange,
  status,
}: {
  matchId: string;
  onDragStart: (e: React.DragEvent, matchId: string) => void;
  pillLabel: string;
  teamA: string;
  teamB: string;
  time: string | null;
  onTimeChange?: (v: string) => void;
  status: string;
}) {
  const isCompleted = status === 'completed';
  return (
    <div
      draggable={!isCompleted}
      onDragStart={(e) => onDragStart(e, matchId)}
      className={`border rounded-lg p-2 bg-white ${
        isCompleted
          ? 'border-gray-200 opacity-60 cursor-default'
          : 'border-gray-300 cursor-grab active:cursor-grabbing hover:border-orange-400 hover:shadow-sm'
      }`}
    >
      <div className="flex items-center justify-between mb-1">
        <span className="text-[9px] font-bold uppercase tracking-wider text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">
          {pillLabel}
        </span>
        {time !== null && onTimeChange && (
          <input
            type="time"
            defaultValue={time}
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onBlur={(e) => {
              const v = e.target.value;
              if (v !== time) onTimeChange(v);
            }}
            className="text-[10px] px-1 py-0.5 border border-gray-200 rounded bg-white text-gray-700"
          />
        )}
        {isCompleted && (
          <span className="text-[9px] text-emerald-700 font-bold">DONE</span>
        )}
      </div>
      <div className="text-xs text-gray-900 leading-tight truncate">{teamA}</div>
      <div className="text-[10px] text-gray-400 leading-tight">vs</div>
      <div className="text-xs text-gray-900 leading-tight truncate">{teamB}</div>
    </div>
  );
}
