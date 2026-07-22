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
  Printer,
  Music,
  Download,
  LayoutGrid,
  X,
  Layers,
  Plus,
  CalendarClock,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { isValidQuadScore, formatTimeDisplay, resolveCourtList } from '@/lib/quads';
import EventSettingsPanel from './EventSettingsPanel';
import DrawView from '@/components/tournament/DrawView';
import DeskHub from '@/components/tournament/DeskHub';
import NudgePanel from '@/components/campaigns/NudgePanel';

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
  court_windows: Record<string, { from?: string; to?: string }> | null;
  event_date: string | null;
  end_date: string | null;
  daily_start_time: string | null;
  daily_end_time: string | null;
  default_match_length_minutes: number | null;
  player_rest_minutes: number | null;
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

type Tab = 'entries' | 'draw' | 'schedule' | 'matches' | 'desk' | 'notify' | 'settings';
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
  const [emailMode, setEmailMode] = useState<'scoring' | 'schedule' | null>(null);
  // Sibling divisions in the same tournament hub (for the division switcher).
  const [siblings, setSiblings] = useState<Sibling[]>([]);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const supabase = createClient();
    const { data: ev, error: evErr } = await supabase
      .from('events')
      .select(
        'id, name, slug, match_format, public_status, entry_fee_cents, max_players, num_courts, court_names, court_windows, event_date, end_date, daily_start_time, daily_end_time, default_match_length_minutes, player_rest_minutes, hub_slug, hub_title'
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
        <div className="text-sm text-orange-900 flex-1 truncate" title="The public link players use to sign up for this event">
          Public signup:{' '}
          <a href={publicUrl} target="_blank" className="font-mono underline">
            {publicUrl}
          </a>
        </div>
        <button
          onClick={copyLink}
          title="Copy the public signup link to share with players"
          className="inline-flex items-center gap-1 px-2 py-1 bg-orange-600 hover:bg-orange-700 text-white rounded text-xs font-semibold flex-shrink-0"
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
          {copied ? 'Copied!' : 'Copy link'}
        </button>
        <span title="Group this event with its other divisions (Gold/Silver, 12U…) so they share one tournament and the division switcher at the top">
          <HubButton
            eventId={event.id}
            hubSlug={event.hub_slug}
            hubTitle={event.hub_title}
            eventName={event.name}
          />
        </span>
        <span title="Pull in payments made through Square for this tournament's entry fees">
          <SquareSyncButton hubSlug={event.hub_slug} eventName={event.name} />
        </span>
        <Link
          href={`/mixer/events/${eventId}/console`}
          target="_blank"
          title="Open the DJ & announcer console — walk-up music and PA voice announcements to call matches to court"
          className="inline-flex items-center gap-1 px-2 py-1 bg-[#001820] hover:bg-black text-white rounded text-xs font-semibold flex-shrink-0"
        >
          <Music size={12} />
          DJ / Announcer
        </Link>
      </div>

      <div className="border-b border-gray-200 mb-6 flex gap-1 overflow-x-auto">
        {([
          ['entries', 'Entries', '1. Who signed up. Add players, set seeds, promote off the waitlist.'],
          ['draw', 'Draw', '2. Build the bracket / round-robin grid. This is the shape of the event — print it or share it.'],
          ['schedule', 'Schedule', '3. Set courts + times. One click builds the full order of play, then emails everyone their times.'],
          ['matches', 'Matches', '4. Enter or fix scores. Every match, any time. Winners advance automatically.'],
          ['desk', 'Desk', '5. Match day. Check players in, put matches on courts, score them fast.'],
          ['notify', 'Notify', 'Email players: a status update to everyone, or a gentle nudge to whoever still owes a match.'],
          ['settings', 'Settings', 'Event details: name, dates, entry fee, format.'],
        ] as const).map(([t, label, tip]) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            title={tip}
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
          onEmailSchedules={emailSchedules}
          emailMode={emailMode}
          emailResult={emailResult}
        />
      )}

      {tab === 'notify' && (
        <div className="space-y-4">
          <div>
            <h3 className="font-semibold text-gray-900">Notify players</h3>
            <p className="text-sm text-gray-600">
              Send a status update to everyone, or a personalized nudge to only the players who still have a match ready to
              play. Preview and send a test to yourself first — nothing goes out until you click “Send to all.”
            </p>
          </div>
          <NudgePanel surface="tournament" targetId={eventId} />
        </div>
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

const SCHED_INPUT =
  'rounded-lg bg-white/5 border border-white/10 px-2.5 py-1.5 text-sm text-slate-100 [color-scheme:dark] focus:outline-none focus:ring-2 focus:ring-[#D3FB52]/40';

function SchedField({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400" title={hint}>
        {label}
      </span>
      {children}
    </label>
  );
}

/**
 * Schedule tab — the tournament's scheduling engine.
 *
 * The director sets the day window, match length, rest, and the courts (with
 * optional per-court hours), then one "Build schedule" runs the auto-scheduler
 * (respecting bracket dependencies + player conflicts) and produces a master
 * order of play: every match with its date, time, and court. From there they
 * email each player their personal times. No manual drag-and-drop.
 */
function ScheduleTab({
  event,
  matches,
  entries,
  onUpdate,
  onEmailSchedules,
  emailMode,
  emailResult,
}: {
  event: EventRow;
  matches: Match[];
  entries: Entry[];
  onUpdate: () => void;
  onEmailSchedules: () => void;
  emailMode: 'scoring' | 'schedule' | null;
  emailResult: { sent: number; total: number } | null;
}) {
  type CourtRow = { name: string; from: string; to: string };
  const dayStartInit = (event.daily_start_time ?? '09:00').slice(0, 5);
  const dayEndInit = (event.daily_end_time ?? '18:00').slice(0, 5);

  const [dayStart, setDayStart] = useState(dayStartInit);
  const [dayEnd, setDayEnd] = useState(dayEndInit);
  const [matchLen, setMatchLen] = useState(String(event.default_match_length_minutes ?? 90));
  const [rest, setRest] = useState(String(event.player_rest_minutes ?? 60));
  const [perCourt, setPerCourt] = useState(
    () => !!event.court_windows && Object.keys(event.court_windows).length > 0
  );
  const [building, setBuilding] = useState(false);
  const [buildResult, setBuildResult] = useState<{ scheduled: number; unscheduled: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const [courtRows, setCourtRows] = useState<CourtRow[]>(() => {
    const names =
      event.court_names && event.court_names.length
        ? event.court_names
        : Array.from({ length: Math.max(1, event.num_courts ?? 4) }, (_, i) => String(i + 1));
    const w = event.court_windows ?? {};
    return names.map((n) => ({
      name: String(n),
      from: (w[n]?.from ?? dayStartInit).slice(0, 5),
      to: (w[n]?.to ?? dayEndInit).slice(0, 5),
    }));
  });

  const setCourt = (i: number, patch: Partial<CourtRow>) =>
    setCourtRows((rows) => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const addCourt = () =>
    setCourtRows((rows) => {
      const nums = rows.map((r) => parseInt(r.name, 10)).filter((n) => Number.isFinite(n));
      const next = nums.length ? Math.max(...nums) + 1 : rows.length + 1;
      return [...rows, { name: String(next), from: dayStart, to: dayEnd }];
    });
  const removeCourt = (i: number) => setCourtRows((rows) => rows.filter((_, idx) => idx !== i));

  const entryById = useMemo(() => new Map(entries.map((e) => [e.id, e])), [entries]);
  const labelSide = (id: string | null) => {
    if (!id) return 'TBD';
    const e = entryById.get(id);
    return e ? formatTeamName(e) : '—';
  };

  const build = async () => {
    const courts = courtRows
      .map((c) => ({ name: c.name.trim(), from: perCourt ? c.from : dayStart, to: perCourt ? c.to : dayEnd }))
      .filter((c) => c.name);
    if (!courts.length) {
      setErr('Add at least one court.');
      return;
    }
    setBuilding(true);
    setErr(null);
    setBuildResult(null);
    try {
      const res = await fetch(`/api/tournaments/events/${event.id}/auto-schedule`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          config: {
            dailyStartTime: dayStart,
            dailyEndTime: dayEnd,
            matchLengthMinutes: parseInt(matchLen, 10) || 90,
            playerRestMinutes: parseInt(rest, 10) || 0,
            courts,
          },
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) setErr(j?.error || 'Could not build the schedule.');
      else
        setBuildResult({
          scheduled: j.matches_scheduled ?? 0,
          unscheduled: Array.isArray(j.unscheduled) ? j.unscheduled.length : 0,
        });
      await onUpdate();
    } catch {
      setErr('Network error building the schedule.');
    }
    setBuilding(false);
  };

  const scheduled = useMemo(
    () =>
      matches
        .filter((m) => m.scheduled_at)
        .slice()
        .sort(
          (a, b) =>
            (a.scheduled_date ?? '').localeCompare(b.scheduled_date ?? '') ||
            (a.scheduled_at ?? '').localeCompare(b.scheduled_at ?? '') ||
            String(a.court ?? '').localeCompare(String(b.court ?? ''), undefined, { numeric: true })
        ),
    [matches]
  );
  const unscheduled = useMemo(() => matches.filter((m) => !m.scheduled_at), [matches]);
  const byDate = useMemo(() => {
    const map = new Map<string, Match[]>();
    for (const m of scheduled) {
      const d = m.scheduled_date ?? 'Undated';
      const list = map.get(d) ?? [];
      list.push(m);
      map.set(d, list);
    }
    return [...map.entries()];
  }, [scheduled]);

  const fmtDate = (d: string) => {
    if (d === 'Undated') return 'Scheduled';
    try {
      return new Date(d + 'T00:00:00').toLocaleDateString(undefined, {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
      });
    } catch {
      return d;
    }
  };

  return (
    <div className="rounded-2xl bg-[#00131c] text-slate-100 p-4 sm:p-5 space-y-5">
      {/* Setup */}
      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 space-y-4">
        <div>
          <h3 className="text-lg font-bold">Schedule the event</h3>
          <p className="text-xs text-slate-400 mt-0.5">
            Set your day window, match length, and courts — one click builds the full order of play,
            then emails every player their times.
          </p>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <SchedField label="Day start">
            <input type="time" value={dayStart} onChange={(e) => setDayStart(e.target.value)} className={`${SCHED_INPUT} w-full`} />
          </SchedField>
          <SchedField label="Day end">
            <input type="time" value={dayEnd} onChange={(e) => setDayEnd(e.target.value)} className={`${SCHED_INPUT} w-full`} />
          </SchedField>
          <SchedField label="Match length" hint="Anticipated minutes per match">
            <input type="number" min={10} step={5} value={matchLen} onChange={(e) => setMatchLen(e.target.value)} className={`${SCHED_INPUT} w-full`} />
          </SchedField>
          <SchedField label="Rest (min)" hint="Minimum gap between a player's own matches">
            <input type="number" min={0} step={5} value={rest} onChange={(e) => setRest(e.target.value)} className={`${SCHED_INPUT} w-full`} />
          </SchedField>
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Courts ({courtRows.length})
            </span>
            <label className="flex items-center gap-1.5 text-xs text-slate-400 cursor-pointer">
              <input type="checkbox" checked={perCourt} onChange={(e) => setPerCourt(e.target.checked)} className="accent-[#D3FB52]" />
              Different hours per court
            </label>
          </div>
          <div className="space-y-1.5">
            {courtRows.map((c, i) => (
              <div key={i} className="flex items-center gap-2 flex-wrap">
                <span className="text-[11px] text-slate-500 w-5 text-right">{i + 1}</span>
                <input
                  value={c.name}
                  onChange={(e) => setCourt(i, { name: e.target.value })}
                  placeholder="Court"
                  className={`${SCHED_INPUT} w-24`}
                />
                {perCourt && (
                  <>
                    <span className="text-[11px] text-slate-500">from</span>
                    <input type="time" value={c.from} onChange={(e) => setCourt(i, { from: e.target.value })} className={`${SCHED_INPUT} w-28`} />
                    <span className="text-[11px] text-slate-500">to</span>
                    <input type="time" value={c.to} onChange={(e) => setCourt(i, { to: e.target.value })} className={`${SCHED_INPUT} w-28`} />
                  </>
                )}
                <button
                  onClick={() => removeCourt(i)}
                  disabled={courtRows.length <= 1}
                  className="ml-auto text-slate-500 hover:text-red-400 p-1 disabled:opacity-30"
                  title="Remove court"
                >
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
          <button onClick={addCourt} className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-[#D3FB52] hover:brightness-110">
            <Plus size={14} /> Add court
          </button>
        </div>

        {err && <p className="text-sm text-red-400">{err}</p>}

        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={build}
            disabled={building || matches.length === 0}
            className="inline-flex items-center gap-2 rounded-lg bg-[#D3FB52] text-[#00131c] font-bold px-4 py-2.5 disabled:opacity-40 hover:brightness-95"
          >
            {building ? <Loader2 size={16} className="animate-spin" /> : <CalendarClock size={16} />}
            {building ? 'Building…' : scheduled.length ? 'Rebuild schedule' : 'Build schedule'}
          </button>
          {matches.length === 0 && (
            <span className="text-xs text-slate-500">Build the draw first (Draw tab), then schedule it.</span>
          )}
          {buildResult && (
            <span className="text-xs text-emerald-300 font-medium">
              ✓ Scheduled {buildResult.scheduled}
              {buildResult.unscheduled ? ` · ${buildResult.unscheduled} didn’t fit` : ''}
            </span>
          )}
        </div>
      </div>

      {/* Master schedule */}
      {scheduled.length > 0 && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-lg font-bold">Master schedule</h3>
              <p className="text-xs text-slate-400">
                {scheduled.length} match{scheduled.length === 1 ? '' : 'es'} scheduled
                {unscheduled.length ? ` · ${unscheduled.length} unscheduled` : ''}
              </p>
            </div>
            {emailResult && emailMode !== 'scoring' && (
              <span className="text-xs text-emerald-300 font-medium">
                ✓ Sent {emailResult.sent}/{emailResult.total} schedule emails
              </span>
            )}
            <button
              onClick={onEmailSchedules}
              disabled={emailMode !== null}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#D3FB52] text-[#00131c] font-bold px-3 py-2 text-sm disabled:opacity-40 hover:brightness-95"
              title="Email each confirmed player their personal match times"
            >
              {emailMode === 'schedule' ? <Loader2 size={14} className="animate-spin" /> : <Mail size={14} />}
              Email times to players
            </button>
          </div>

          {byDate.map(([date, ms]) => (
            <div key={date} className="rounded-xl border border-white/10 overflow-hidden">
              <div className="bg-white/[0.04] px-3 py-2 text-sm font-semibold text-slate-200">{fmtDate(date)}</div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[420px]">
                  <thead className="text-[11px] uppercase tracking-wider text-slate-500">
                    <tr className="border-t border-white/5">
                      <th className="text-left font-semibold px-3 py-1.5 w-20">Time</th>
                      <th className="text-left font-semibold px-3 py-1.5 w-24">Court</th>
                      <th className="text-left font-semibold px-3 py-1.5">Match</th>
                      <th className="text-left font-semibold px-3 py-1.5 w-14">Rd</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ms.map((m) => (
                      <tr key={m.id} className="border-t border-white/5">
                        <td className="px-3 py-2 font-mono text-slate-200 whitespace-nowrap">
                          {formatTimeDisplay(m.scheduled_at)}
                        </td>
                        <td className="px-3 py-2 text-slate-300 whitespace-nowrap">
                          {m.court ? `Court ${m.court}` : '—'}
                        </td>
                        <td className="px-3 py-2 text-slate-100">
                          <span className={m.winner_side === 'a' ? 'font-bold' : ''}>{labelSide(m.player1_id)}</span>
                          <span className="text-slate-500"> vs </span>
                          <span className={m.winner_side === 'b' ? 'font-bold' : ''}>{labelSide(m.player3_id)}</span>
                          {m.status === 'completed' && (
                            <span className="ml-2 text-[10px] text-[#D3FB52] font-bold">DONE</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-slate-500 whitespace-nowrap">
                          {m.bracket === 'consolation' ? 'C' : ''}R{m.round}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}

          {unscheduled.length > 0 && (
            <div className="rounded-xl border border-amber-400/30 bg-amber-400/[0.06] p-3">
              <p className="text-sm font-semibold text-amber-200 mb-1">
                {unscheduled.length} match{unscheduled.length === 1 ? '' : 'es'} not scheduled
              </p>
              <p className="text-[11px] text-slate-400">
                They didn’t fit the window/courts, or depend on results still pending. Widen the day,
                add courts, or shorten the match length and rebuild.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
