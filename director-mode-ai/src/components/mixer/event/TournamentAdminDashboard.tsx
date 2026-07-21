'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import HubButton from './HubButton';
import SquareSyncButton from './SquareSyncButton';
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
  LayoutGrid,
  X,
  Layers,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { isValidQuadScore, formatTimeDisplay, resolveCourtList } from '@/lib/quads';
import EventSettingsPanel from './EventSettingsPanel';
import DrawView from '@/components/tournament/DrawView';
import DeskHub from '@/components/tournament/DeskHub';

const FORMAT_LABELS: Record<string, string> = {
  'rr-singles': 'Round Robin — Singles',
  'rr-doubles': 'Round Robin — Doubles',
  'single-elim-singles': 'Single Elimination — Singles',
  'single-elim-doubles': 'Single Elimination — Doubles',
  'fmlc-singles': 'First-Match Loser Consolation — Singles',
  'fmlc-doubles': 'First-Match Loser Consolation — Doubles',
  'ffic-singles': 'Full Feed-In Consolation — Singles',
  'ffic-doubles': 'Full Feed-In Consolation — Doubles',
  'compass-singles': 'Compass Draw — Singles',
  'compass-doubles': 'Compass Draw — Doubles',
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
  hub_slug: string | null;
  hub_title: string | null;
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

type Tab = 'entries' | 'draw' | 'schedule' | 'matches' | 'desk' | 'settings';
type ScoreOutcome = 'played' | 'walkover' | 'retired' | 'default';

/** A sibling division inside the same tournament hub. */
type Sibling = { id: string; name: string; division: string; public_status: string };

/**
 * Short division tag from an event name — mirrors the Desk Hub / desk API logic
 * so the division switcher labels match the board. Prefer the draw name
 * (Gold/Silver/Bronze), else an age/category, else the leading words.
 */
function divisionTag(name: string): string {
  const draw = name.match(/\b(Gold|Silver|Bronze)\b/i);
  if (draw) return draw[0];
  const cat = name.match(/\b(10U|12U|13&O|13U|14U|16U|18U|Open|Boys|Girls|Men|Women|Mixed)\b/i);
  if (cat) return cat[0];
  return name.split(/[—·|]|\s-\s/)[0].trim().slice(0, 16) || name.slice(0, 16);
}

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

/** Dark-themed team row for the Desk-Hub-style Matches board. */
function DarkTeamRow({
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
      <div className="px-3 py-2.5 flex items-center gap-2 min-h-[44px] text-slate-500 italic text-sm">
        <span className="w-6 inline-block text-center">—</span>
        TBD
      </div>
    );
  }
  return (
    <div
      className={`px-3 py-2.5 flex items-center justify-between gap-2 min-h-[44px] ${
        won ? 'bg-[#D3FB52]/10' : dimmed ? 'opacity-50' : ''
      }`}
    >
      <div className="flex items-center gap-2 min-w-0">
        <span
          className={`w-6 h-5 inline-flex items-center justify-center text-[10px] font-bold rounded flex-shrink-0 ${
            entry.seed != null ? 'bg-[#D3FB52] text-[#00131c]' : 'text-slate-500 border border-white/15'
          }`}
        >
          {entry.seed ?? '·'}
        </span>
        <span className={`truncate text-sm ${won ? 'font-bold text-white' : 'font-medium text-slate-200'}`}>
          {formatTeamName(entry)}
        </span>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        {sets && sets.length > 0 && (
          <div
            className={`font-mono text-sm tabular-nums whitespace-nowrap flex gap-1.5 ${
              won ? 'font-bold text-white' : 'text-slate-400'
            }`}
          >
            {sets.map((g, i) => (
              <span key={i}>{g}</span>
            ))}
          </div>
        )}
        {won && marker && (
          <span className="px-1.5 py-0.5 bg-[#D3FB52] text-[#00131c] text-[10px] font-bold rounded tracking-wider">
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
  // Sibling divisions in the same tournament hub (for the division switcher).
  const [siblings, setSiblings] = useState<Sibling[]>([]);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const supabase = createClient();
    const { data: ev, error: evErr } = await supabase
      .from('events')
      .select(
        'id, name, slug, match_format, public_status, entry_fee_cents, max_players, num_courts, court_names, event_date, daily_start_time, daily_end_time, default_match_length_minutes, hub_slug, hub_title'
      )
      .eq('id', eventId)
      .maybeSingle();
    if (evErr) {
      setError(evErr.message);
      setLoading(false);
      return;
    }
    setEvent(ev as EventRow);

    // Sibling divisions: every other event sharing this tournament's hub_slug.
    // These become the division switcher so the director hops division→division
    // inside the one tournament instead of bouncing back to the mode index.
    const hubSlug = (ev as EventRow | null)?.hub_slug ?? null;
    if (hubSlug) {
      const { data: sibs } = await supabase
        .from('events')
        .select('id, name, public_status, event_date')
        .eq('hub_slug', hubSlug)
        .order('event_date', { ascending: true })
        .order('name', { ascending: true });
      setSiblings(
        ((sibs as { id: string; name: string; public_status: string }[]) || []).map((s) => ({
          id: s.id,
          name: s.name,
          division: divisionTag(s.name),
          public_status: s.public_status,
        }))
      );
    } else {
      setSiblings([]);
    }

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
      <div className="flex items-center gap-3 mb-4">
        <Link
          href="/mixer/tournaments"
          className="p-2 hover:bg-gray-100 rounded-lg flex-shrink-0"
          title="Back to Tournaments"
        >
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

      {/* Division switcher — one tournament, many divisions. Jump between the
          sibling draws that share this event's hub without leaving TournamentMode. */}
      {siblings.length > 1 && (
        <div className="mb-6 rounded-xl border border-gray-200 bg-white p-2.5">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-gray-500 px-1.5">
              <Layers size={13} className="text-orange-500" />
              {event.hub_title || 'Divisions'}
            </span>
            <div className="flex items-center gap-1.5 flex-wrap">
              {siblings.map((s) => {
                const active = s.id === event.id;
                return active ? (
                  <span
                    key={s.id}
                    className="rounded-lg bg-orange-500 text-white font-semibold text-sm px-3 py-1.5 inline-flex items-center gap-1.5"
                    title={s.name}
                  >
                    {s.division}
                    {s.public_status === 'completed' && (
                      <span className="text-[10px] font-bold uppercase tracking-wide opacity-80">done</span>
                    )}
                  </span>
                ) : (
                  <Link
                    key={s.id}
                    href={`/mixer/events/${s.id}`}
                    className="rounded-lg border border-gray-200 bg-gray-50 hover:bg-gray-100 hover:border-gray-300 text-gray-700 font-medium text-sm px-3 py-1.5 inline-flex items-center gap-1.5 transition-colors"
                    title={s.name}
                  >
                    {s.division}
                    {s.public_status === 'completed' && (
                      <span className="text-[10px] font-bold uppercase tracking-wide text-gray-400">done</span>
                    )}
                  </Link>
                );
              })}
            </div>
          </div>
        </div>
      )}

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
        <HubButton
          eventId={event.id}
          hubSlug={event.hub_slug}
          hubTitle={event.hub_title}
          eventName={event.name}
        />
        <SquareSyncButton hubSlug={event.hub_slug} eventName={event.name} />
        <Link
          href={`/mixer/events/${eventId}/dj`}
          target="_blank"
          className="inline-flex items-center gap-1 px-2 py-1 bg-yellow-300 hover:bg-yellow-200 text-[#001820] rounded text-xs font-bold flex-shrink-0"
        >
          <Music size={12} />
          DJ Console
        </Link>
        <Link
          href="/mixer/tournaments/desk"
          target="_blank"
          className="inline-flex items-center gap-1 px-2 py-1 bg-[#D3FB52] hover:brightness-95 text-[#00131c] rounded text-xs font-bold flex-shrink-0"
        >
          <LayoutGrid size={12} />
          Desk Hub
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
        {([
          ['entries', 'Entries'],
          ['draw', 'Draw'],
          ['schedule', 'Schedule'],
          ['matches', 'Matches'],
          ['desk', 'Desk'],
          ['settings', 'Settings'],
        ] as const).map(([t, label]) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 border-b-2 font-medium text-sm whitespace-nowrap ${
              tab === t
                ? 'border-orange-500 text-orange-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'draw' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="font-semibold text-gray-900">Draw sheet</h3>
              <p className="text-sm text-gray-600">
                The shape of the {FORMAT_LABELS[event.match_format] ?? 'tournament'}. Read-only —
                enter results on the Matches tab or the live Desk.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <a
                href={`/tournaments/${event.slug}/draw`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-3 py-2 border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50"
              >
                <Printer size={14} />
                Print
              </a>
              {matches.length > 0 && (
                <button
                  onClick={generateBracket}
                  disabled={busy === 'generate'}
                  className="inline-flex items-center gap-2 px-3 py-2 border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
                  title="Wipe and re-seed the draw from the current confirmed entries"
                >
                  {busy === 'generate' ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />}
                  Regenerate
                </button>
              )}
            </div>
          </div>
          {matches.length === 0 && inDraw < 2 ? (
            <div className="bg-gray-50 border border-gray-200 rounded-xl p-8 text-center text-sm text-gray-500">
              Confirm at least 2 players on the Entries tab, then generate the draw.
            </div>
          ) : matches.length === 0 ? (
            <div className="bg-emerald-50 border-2 border-emerald-300 rounded-xl p-4 sm:p-5 flex items-center justify-between gap-3">
              <div>
                <div className="font-semibold text-emerald-900 flex items-center gap-2">
                  <Wand2 size={16} /> Ready to draw
                </div>
                <p className="text-sm text-emerald-800 mt-0.5">
                  {inDraw} confirmed players. Generate to seed by rating and build the draw.
                </p>
              </div>
              <button
                onClick={generateBracket}
                disabled={busy === 'generate'}
                className="inline-flex items-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-semibold text-sm flex-shrink-0 disabled:opacity-50"
              >
                {busy === 'generate' ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />}
                Generate Draw
              </button>
            </div>
          ) : (
            <div className="bg-white border border-gray-200 rounded-xl p-4 sm:p-5">
              <DrawView
                format={event.match_format}
                entries={entries}
                matches={matches}
                revealAllSeeds
              />
            </div>
          )}
        </div>
      )}

      {tab === 'desk' && (
        <div className="space-y-3">
          <div className="rounded-xl border border-[#D3FB52]/30 bg-[#00131c] text-slate-200 p-3 flex flex-wrap items-center gap-2 text-sm">
            <LayoutGrid size={15} className="text-[#D3FB52]" />
            <span className="font-semibold text-slate-100">Live desk — this division.</span>
            <span className="text-slate-400">Put matches on courts and score them fast on match day.</span>
            <Link
              href="/mixer/tournaments/desk"
              target="_blank"
              className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-[#D3FB52] text-[#00131c] font-bold px-3 py-1.5 text-xs"
            >
              <LayoutGrid size={13} /> Open all-divisions board ↗
            </Link>
          </div>
          <div className="rounded-2xl overflow-hidden border border-white/10">
            <DeskHub initialEvents={[eventId]} />
          </div>
        </div>
      )}

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
            <button
              onClick={() => setTab('draw')}
              className="w-full text-left bg-emerald-50 border-2 border-emerald-300 rounded-xl p-4 sm:p-5 flex items-center justify-between gap-3 hover:bg-emerald-100/70"
            >
              <div>
                <div className="font-semibold text-emerald-900 flex items-center gap-2">
                  <Wand2 size={16} />
                  Ready to draw
                </div>
                <p className="text-sm text-emerald-800 mt-0.5">
                  {inDraw} confirmed players. Head to the Draw tab to seed by rating and build the draw.
                </p>
              </div>
              <span className="inline-flex items-center gap-2 px-4 py-2.5 bg-emerald-600 text-white rounded-lg font-semibold text-sm flex-shrink-0">
                Go to Draw →
              </span>
            </button>
          )}
        </div>
      )}

      {tab === 'matches' && (
        <div className="rounded-2xl bg-[#00131c] text-slate-100 p-4 sm:p-5 space-y-5">
          {/* Toolbar */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="min-w-0">
              <h3 className="text-lg font-bold">Matches — results ledger</h3>
              <p className="text-xs text-slate-400 mt-0.5">
                {matches.length === 0
                  ? 'Generate the draw first, then enter results here.'
                  : `${matches.filter((m) => m.status === 'completed').length}/${matches.length} scored · enter or fix any result · winners auto-advance`}
              </p>
            </div>
            <div className="flex-1" />
            {emailResult && emailMode !== 'schedule' && (
              <span className="text-xs text-emerald-300 font-medium">
                ✓ Sent {emailResult.sent}/{emailResult.total} scoring-link emails
              </span>
            )}
            <div className="flex gap-2 flex-wrap">
              <button
                onClick={emailScoringLinks}
                disabled={emailMode !== null || matches.length === 0}
                className="inline-flex items-center gap-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 px-3 py-2 text-sm font-semibold disabled:opacity-40"
                title="Email each confirmed player a personal link to report their own scores"
              >
                {emailMode === 'scoring' ? <Loader2 size={14} className="animate-spin" /> : <Mail size={14} />}
                Email scoring links
              </button>
            </div>
          </div>

          {matches.length === 0 ? (
            <div className="rounded-xl border border-dashed border-white/15 bg-white/[0.02] p-10 text-center text-sm text-slate-400">
              No matches yet — build the draw on the Draw tab.
            </div>
          ) : (
            <div className="space-y-7">
              {(['main', 'consolation'] as const)
                .filter((bracket) => matches.some((m) => m.bracket === bracket))
                .map((bracket) => {
                  const bracketMatches = matches.filter((m) => m.bracket === bracket);
                  const rounds = Array.from(new Set(bracketMatches.map((m) => m.round))).sort(
                    (a, b) => a - b
                  );
                  const totalRounds = rounds.length;
                  const hasConsolation = matches.some((m) => m.bracket === 'consolation');
                  return (
                    <div key={bracket} className="space-y-5">
                      {hasConsolation && (
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold uppercase tracking-wider text-slate-200">
                            {bracket === 'main' ? 'Main Draw' : 'Consolation Draw'}
                          </span>
                          <span className="text-xs text-slate-500">{bracketMatches.length} matches</span>
                        </div>
                      )}
                      {rounds.map((round, roundIdx) => {
                        const roundMatches = bracketMatches
                          .filter((m) => m.round === round)
                          .sort((a, b) => a.slot - b.slot);
                        const doneInRound = roundMatches.filter((m) => m.status === 'completed').length;
                        return (
                          <div key={round}>
                            <div className="flex items-center gap-2 mb-2.5">
                              <span className="text-[11px] font-bold uppercase tracking-wider text-[#D3FB52]">
                                {roundLabel(roundIdx + 1, totalRounds, bracket)}
                              </span>
                              <span className="text-[11px] text-slate-500">
                                {doneInRound}/{roundMatches.length}
                              </span>
                              <div className="flex-1 h-px bg-white/10" />
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                              {roundMatches.map((m) => {
                                const teamA = m.player1_id ? entryById.get(m.player1_id) : null;
                                const teamB = m.player3_id ? entryById.get(m.player3_id) : null;
                                const aWon = m.winner_side === 'a';
                                const bWon = m.winner_side === 'b';
                                const isPending = m.status !== 'completed';
                                const canScore = !!(m.player1_id && m.player3_id);
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
                                return (
                                  <div
                                    key={m.id}
                                    className={`rounded-xl border overflow-hidden ${
                                      isPending
                                        ? 'border-white/10 bg-white/[0.03]'
                                        : 'border-[#D3FB52]/25 bg-[#062733]'
                                    }`}
                                  >
                                    <DarkTeamRow
                                      entry={teamA ?? null}
                                      won={aWon}
                                      dimmed={bWon}
                                      sets={parsed?.a ?? null}
                                      marker={aWon ? marker : null}
                                    />
                                    <div className="border-t border-white/5" />
                                    <DarkTeamRow
                                      entry={teamB ?? null}
                                      won={bWon}
                                      dimmed={aWon}
                                      sets={parsed?.b ?? null}
                                      marker={bWon ? marker : null}
                                    />
                                    <div className="flex items-center justify-between gap-2 bg-black/20 px-3 py-1.5 text-[11px]">
                                      <div className="flex items-center gap-1.5 text-slate-400 min-w-0">
                                        {m.court ? (
                                          <span className="font-medium text-slate-300">Court {m.court}</span>
                                        ) : (
                                          <span className="text-slate-600">No court</span>
                                        )}
                                        {m.scheduled_at && <span>· {formatTimeDisplay(m.scheduled_at)}</span>}
                                      </div>
                                      {canScore && isPending ? (
                                        <button
                                          onClick={() => openEdit(m)}
                                          className="rounded-md bg-[#D3FB52] text-[#00131c] font-bold px-2.5 py-1 text-[11px] whitespace-nowrap hover:brightness-95"
                                        >
                                          Enter score
                                        </button>
                                      ) : !isPending ? (
                                        <button
                                          onClick={() => openEdit(m)}
                                          className="inline-flex items-center gap-1 text-slate-400 hover:text-slate-100"
                                        >
                                          <Edit3 size={11} /> Edit
                                        </button>
                                      ) : (
                                        <span className="text-slate-600 italic">awaiting players</span>
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })}

              {allMatchesDone && event.public_status !== 'completed' && (
                <div className="rounded-xl border border-[#D3FB52]/40 bg-[#D3FB52]/10 p-4 sm:p-5 flex items-center justify-between gap-3">
                  <div>
                    <div className="font-semibold text-[#D3FB52] flex items-center gap-2">
                      <PartyPopper size={16} /> All matches scored
                    </div>
                    <p className="text-sm text-slate-300 mt-0.5">
                      Wrap it up — view final standings and share with players.
                    </p>
                  </div>
                  <button
                    onClick={completeTournament}
                    className="inline-flex items-center gap-2 rounded-lg bg-[#D3FB52] text-[#00131c] font-bold px-4 py-2.5 text-sm flex-shrink-0 hover:brightness-95"
                  >
                    Complete tournament →
                  </button>
                </div>
              )}

              {event.public_status === 'completed' && (
                <div className="rounded-xl border border-[#D3FB52]/40 bg-[#D3FB52]/10 p-4 flex items-center justify-between gap-3">
                  <div className="font-semibold text-[#D3FB52] flex items-center gap-2">
                    <PartyPopper size={16} /> Tournament complete
                  </div>
                  <a
                    href={`/tournaments/${event.slug}/results`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 rounded-lg bg-[#D3FB52] text-[#00131c] font-bold px-4 py-2.5 text-sm hover:brightness-95"
                  >
                    View results →
                  </a>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {tab === 'schedule' && (
        <ScheduleTab
          event={event}
          matches={matches}
          entries={entries}
          onUpdate={fetchAll}
          onAutoSchedule={autoSchedule}
          onEmailSchedules={emailSchedules}
          scheduling={scheduling}
          emailMode={emailMode}
          emailResult={emailResult}
        />
      )}

      {tab === 'settings' && event && (
        <EventSettingsPanel event={event} onSaved={fetchAll} />
      )}

      {editing && (() => {
        const m = matches.find((x) => x.id === editing);
        if (!m) return null;
        return (
          <ScoreEntryModal
            teamAName={formatTeamName(m.player1_id ? entryById.get(m.player1_id) ?? null : null) || 'Side A'}
            teamBName={formatTeamName(m.player3_id ? entryById.get(m.player3_id) ?? null : null) || 'Side B'}
            court={m.court}
            value={scoreInput}
            onChange={setScoreInput}
            onCancel={() => setEditing(null)}
            onSave={() => saveScore(m)}
            saving={busy === m.id}
          />
        );
      })()}
    </div>
  );
}

/**
 * Desk-Hub-style score entry modal — tap the winner, pick the outcome, type the
 * score. Replaces the cramped inline edit form; reuses the parent's scoreInput
 * state + saveScore so all validation/persistence logic is unchanged.
 */
function ScoreEntryModal({
  teamAName,
  teamBName,
  court,
  value,
  onChange,
  onCancel,
  onSave,
  saving,
}: {
  teamAName: string;
  teamBName: string;
  court: string | null;
  value: { score: string; winner_side: '' | 'a' | 'b'; outcome: ScoreOutcome };
  onChange: (v: { score: string; winner_side: '' | 'a' | 'b'; outcome: ScoreOutcome }) => void;
  onCancel: () => void;
  onSave: () => void;
  saving: boolean;
}) {
  const outcomeOptions: { id: ScoreOutcome; label: string; hint: string }[] = [
    { id: 'played', label: 'Played', hint: 'Match completed normally' },
    { id: 'walkover', label: 'Walkover', hint: 'Opponent no-show — no match played' },
    { id: 'retired', label: 'Retired', hint: 'Played partial — one team had to stop' },
    { id: 'default', label: 'Default', hint: 'Disqualification / penalty' },
  ];
  const showScoreInput = value.outcome === 'played' || value.outcome === 'retired';
  const scoreValid = isValidTournamentScore(value.score, value.outcome);
  const canSave = !!value.winner_side && scoreValid && !saving;
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onCancel}>
      <div
        className="bg-[#062733] border border-white/10 rounded-2xl p-5 w-full max-w-md text-slate-100"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <p className="font-bold">Enter score{court ? ` · Court ${court}` : ''}</p>
          <button onClick={onCancel} className="text-slate-400 hover:text-slate-200">
            <X size={18} />
          </button>
        </div>
        <p className="text-xs text-slate-400 mb-3">Tap the winner, then type the score.</p>

        <div className="space-y-2 mb-3">
          {(['a', 'b'] as const).map((s) => (
            <button
              key={s}
              onClick={() => onChange({ ...value, winner_side: s })}
              className={`w-full rounded-xl px-4 py-3 text-left font-semibold border ${
                value.winner_side === s
                  ? 'bg-[#D3FB52] text-[#00131c] border-[#D3FB52]'
                  : 'bg-white/5 text-slate-100 border-white/10 hover:bg-white/10'
              }`}
            >
              {s === 'a' ? teamAName : teamBName}
            </button>
          ))}
        </div>

        <div className="mb-3">
          <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
            Outcome
          </label>
          <div className="grid grid-cols-4 gap-1.5">
            {outcomeOptions.map((opt) => (
              <button
                key={opt.id}
                type="button"
                title={opt.hint}
                onClick={() => onChange({ ...value, outcome: opt.id })}
                className={`px-1 py-2 rounded-lg text-[11px] font-semibold ${
                  value.outcome === opt.id
                    ? 'bg-white text-[#00131c]'
                    : 'bg-white/5 text-slate-300 border border-white/10 hover:bg-white/10'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {showScoreInput ? (
          <>
            <input
              type="text"
              autoFocus
              placeholder={
                value.outcome === 'retired'
                  ? 'Partial score (e.g. "6-2, 3-1") — optional'
                  : 'Score — e.g. "6-3, 6-4"'
              }
              value={value.score}
              onChange={(e) => onChange({ ...value, score: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && canSave) onSave();
                if (e.key === 'Escape') onCancel();
              }}
              className="w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2.5 text-slate-100 placeholder:text-slate-500 mb-2 focus:outline-none focus:ring-2 focus:ring-[#D3FB52]/50"
            />
            {value.score && !scoreValid && (
              <p className="text-xs text-red-400 mb-2">
                Format must be like <code>6-3</code> or <code>6-3, 6-4</code>.
              </p>
            )}
          </>
        ) : (
          <div className="text-xs text-slate-300 bg-white/5 rounded-lg px-3 py-2.5 border border-white/10 mb-2">
            Will record as{' '}
            <span className="font-mono font-semibold text-white">
              {value.outcome === 'walkover' ? 'W/O' : 'DEF'}
            </span>{' '}
            — no match score.
          </div>
        )}

        <button
          onClick={onSave}
          disabled={!canSave}
          className="w-full rounded-xl bg-[#D3FB52] text-[#00131c] font-bold py-3 mt-1 disabled:opacity-40 inline-flex items-center justify-center gap-2"
        >
          {saving && <Loader2 size={16} className="animate-spin" />}
          {saving ? 'Saving…' : 'Save score'}
        </button>
      </div>
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
  onAutoSchedule,
  onEmailSchedules,
  scheduling,
  emailMode,
  emailResult,
}: {
  event: EventRow;
  matches: Match[];
  entries: Entry[];
  onUpdate: () => void;
  onAutoSchedule: () => void;
  onEmailSchedules: () => void;
  scheduling: boolean;
  emailMode: 'scoring' | 'schedule' | null;
  emailResult: { sent: number; total: number } | null;
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
      <div className="rounded-2xl bg-[#00131c] p-4 sm:p-5">
        <div className="rounded-xl border border-amber-400/40 bg-amber-400/10 text-amber-200 p-5">
          <p className="font-semibold">No courts configured.</p>
          <p className="text-sm mt-1 text-amber-200/80">
            Set the number of courts (or court names) on the Settings tab to enable order-of-play scheduling.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl bg-[#00131c] text-slate-100 p-4 sm:p-5 space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0">
          <h3 className="text-lg font-bold">Order of play</h3>
          <p className="text-xs text-slate-400 mt-0.5 flex items-center gap-1.5">
            <Calendar size={13} className="text-[#D3FB52] flex-shrink-0" />
            Drag matches onto a court — auto-picks the next free slot. Match length{' '}
            <strong className="text-slate-300">{matchLengthMin}m</strong> · start{' '}
            <strong className="text-slate-300">{dailyStart}</strong>.
          </p>
        </div>
        <div className="flex-1" />
        {busy && <Loader2 size={16} className="animate-spin text-[#D3FB52]" />}
        {emailResult && emailMode === 'schedule' && (
          <span className="text-xs text-emerald-300 font-medium">
            ✓ Sent {emailResult.sent}/{emailResult.total} schedule emails
          </span>
        )}
        <button
          onClick={onAutoSchedule}
          disabled={scheduling || matches.length === 0}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[#D3FB52] text-[#00131c] font-bold px-3 py-2 text-sm disabled:opacity-40 hover:brightness-95"
          title="Auto-place every match across the courts and time slots"
        >
          {scheduling ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />}
          {scheduling ? 'Scheduling…' : 'Auto-schedule'}
        </button>
        <button
          onClick={onEmailSchedules}
          disabled={emailMode !== null || matches.every((m) => !m.scheduled_at)}
          className="inline-flex items-center gap-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 px-3 py-2 text-sm font-semibold disabled:opacity-40"
          title="Email each confirmed player their personal match schedule"
        >
          {emailMode === 'schedule' ? <Loader2 size={14} className="animate-spin" /> : <Mail size={14} />}
          Email schedules
        </button>
      </div>

      <div className="flex gap-3 overflow-x-auto pb-2 items-start">
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
            <div className="text-xs text-slate-500 italic text-center py-6">
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
                <div className="text-xs text-slate-500 italic text-center py-6">
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
      ? 'border-white/10 bg-[#062733]'
      : 'border-white/10 bg-white/[0.03]';
  return (
    <div
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={`flex flex-col min-w-[240px] w-[240px] rounded-xl border-2 transition-colors ${
        isDragOver ? 'border-[#D3FB52] bg-[#D3FB52]/10' : accentClasses
      }`}
    >
      <div className="p-3 border-b border-white/10">
        <div className="font-semibold text-slate-100 text-sm">{title}</div>
        <div className="text-[10px] text-slate-500 uppercase tracking-wider">{subtitle}</div>
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
      className={`border rounded-lg p-2 ${
        isCompleted
          ? 'border-white/5 bg-white/[0.02] opacity-60 cursor-default'
          : 'border-white/10 bg-white/[0.04] cursor-grab active:cursor-grabbing hover:border-[#D3FB52]/50 hover:bg-white/[0.07]'
      }`}
    >
      <div className="flex items-center justify-between mb-1">
        <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400 bg-white/10 px-1.5 py-0.5 rounded">
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
            className="text-[10px] px-1 py-0.5 border border-white/10 rounded bg-white/5 text-slate-200 [color-scheme:dark]"
          />
        )}
        {isCompleted && (
          <span className="text-[9px] text-[#D3FB52] font-bold">DONE</span>
        )}
      </div>
      <div className="text-xs text-slate-100 leading-tight truncate">{teamA}</div>
      <div className="text-[10px] text-slate-500 leading-tight">vs</div>
      <div className="text-xs text-slate-100 leading-tight truncate">{teamB}</div>
    </div>
  );
}
