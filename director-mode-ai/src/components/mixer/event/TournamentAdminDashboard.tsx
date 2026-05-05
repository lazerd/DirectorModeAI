'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
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
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { isValidQuadScore, formatTimeDisplay } from '@/lib/quads';

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
};

const POSITION_LABELS: Record<Entry['position'], { label: string; color: string }> = {
  in_draw: { label: 'Confirmed', color: 'bg-emerald-100 text-emerald-700' },
  waitlist: { label: 'Waitlist', color: 'bg-amber-100 text-amber-700' },
  pending_payment: { label: 'Pending pmt', color: 'bg-gray-100 text-gray-700' },
  withdrawn: { label: 'Withdrawn', color: 'bg-red-100 text-red-700' },
};

type Tab = 'entries' | 'matches' | 'settings';

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
  const [scoreInput, setScoreInput] = useState({ score: '', winner_side: '' as '' | 'a' | 'b' });
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

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const supabase = createClient();
    const { data: ev, error: evErr } = await supabase
      .from('events')
      .select('id, name, slug, match_format, public_status, entry_fee_cents, max_players')
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
        .select('id, bracket, round, slot, match_type, player1_id, player2_id, player3_id, player4_id, score, winner_side, status, score_token, court, scheduled_at, scheduled_date')
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
    setScoreInput({ score: m.score ?? '', winner_side: m.winner_side ?? '' });
  };

  const saveScore = async (m: Match) => {
    if (!scoreInput.winner_side) return;
    if (!isValidQuadScore(scoreInput.score)) return;
    setBusy(m.id);
    try {
      const res = await fetch(`/api/tournaments/match/${m.score_token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          winner_side: scoreInput.winner_side,
          score: scoreInput.score,
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

      <div className="bg-orange-50 border border-orange-200 rounded-xl p-3 mb-6 flex items-center gap-3">
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
      </div>

      <div className="border-b border-gray-200 mb-6 flex gap-1 overflow-x-auto">
        {(['entries', 'matches', 'settings'] as const).map((t) => (
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
            <button
              onClick={() => setShowAdd((s) => !s)}
              className="inline-flex items-center gap-2 px-3 py-2 bg-orange-500 text-white rounded-lg text-sm font-medium hover:bg-orange-600"
            >
              <UserPlus size={14} />
              {showAdd ? 'Cancel' : 'Add player manually'}
            </button>
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
                    <th className="text-left px-3 py-2 w-10">#</th>
                    <th className="text-left px-3 py-2">Player</th>
                    <th className="text-left px-3 py-2">Rating</th>
                    <th className="text-left px-3 py-2">Status</th>
                    <th className="text-left px-3 py-2">Pmt</th>
                    <th className="text-right px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {entries
                    .sort((a, b) => (b.composite_rating ?? 0) - (a.composite_rating ?? 0))
                    .map((entry) => {
                      const pos = POSITION_LABELS[entry.position];
                      return (
                        <tr key={entry.id} className="border-t border-gray-100">
                          <td className="px-3 py-2 text-gray-500 text-xs">{entry.seed ?? '—'}</td>
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
              {Array.from(new Set(matches.map((m) => m.bracket))).map((bracket) => (
                <div key={bracket} className="bg-white border border-gray-200 rounded-xl p-4">
                  <h3 className="font-semibold mb-3 capitalize">{bracket} Bracket</h3>
                  {Array.from(new Set(matches.filter((m) => m.bracket === bracket).map((m) => m.round)))
                    .sort((a, b) => a - b)
                    .map((round) => (
                      <div key={round} className="mb-3">
                        <div className="text-xs text-gray-500 uppercase tracking-wide mb-1.5">
                          Round {round}
                        </div>
                        <div className="space-y-2">
                          {matches
                            .filter((m) => m.bracket === bracket && m.round === round)
                            .sort((a, b) => a.slot - b.slot)
                            .map((m) => {
                              const a = labelEntry(m.player1_id);
                              const b = labelEntry(m.player3_id);
                              const aWon = m.winner_side === 'a';
                              const bWon = m.winner_side === 'b';
                              const isPending = m.status !== 'completed';
                              const canScore = m.player1_id && m.player3_id;
                              const isOpen = editing === m.id;
                              if (isOpen) {
                                return (
                                  <div key={m.id} className="border-2 border-orange-300 bg-orange-50 rounded-lg p-3 space-y-2">
                                    <div className="grid grid-cols-2 gap-2 text-sm">
                                      <button
                                        onClick={() => setScoreInput({ ...scoreInput, winner_side: 'a' })}
                                        className={`px-2 py-1.5 rounded ${scoreInput.winner_side === 'a' ? 'bg-emerald-600 text-white' : 'bg-white border'}`}
                                      >
                                        {a} won
                                      </button>
                                      <button
                                        onClick={() => setScoreInput({ ...scoreInput, winner_side: 'b' })}
                                        className={`px-2 py-1.5 rounded ${scoreInput.winner_side === 'b' ? 'bg-emerald-600 text-white' : 'bg-white border'}`}
                                      >
                                        {b} won
                                      </button>
                                    </div>
                                    <input
                                      type="text"
                                      placeholder='Score (e.g. "6-3, 6-4")'
                                      value={scoreInput.score}
                                      onChange={(e) => setScoreInput({ ...scoreInput, score: e.target.value })}
                                      className="w-full px-2 py-1.5 border rounded text-sm text-gray-900"
                                    />
                                    {scoreInput.score && !isValidQuadScore(scoreInput.score) && (
                                      <div className="text-xs text-red-600">
                                        Format must be like <code>6-3</code> or <code>6-3, 6-4</code>.
                                      </div>
                                    )}
                                    <div className="flex gap-2">
                                      <button onClick={() => setEditing(null)} className="flex-1 px-2 py-1 text-sm border rounded hover:bg-gray-50">
                                        Cancel
                                      </button>
                                      <button
                                        onClick={() => saveScore(m)}
                                        disabled={busy === m.id || !scoreInput.winner_side || !isValidQuadScore(scoreInput.score)}
                                        className="flex-1 px-2 py-1 text-sm bg-orange-500 text-white rounded hover:bg-orange-600 disabled:opacity-50"
                                      >
                                        {busy === m.id ? 'Saving…' : 'Save'}
                                      </button>
                                    </div>
                                  </div>
                                );
                              }
                              return (
                                <div key={m.id} className="border border-gray-200 rounded-lg p-2 text-sm space-y-2">
                                  <div className="flex items-center gap-2">
                                    <div className="flex-1 grid grid-cols-2 gap-1">
                                      <div className={aWon ? 'font-semibold text-emerald-700' : 'text-gray-900'} style={!aWon ? { color: '#000000' } : undefined}>
                                        {a}
                                      </div>
                                      <div className={bWon ? 'font-semibold text-emerald-700' : 'text-gray-900'} style={!bWon ? { color: '#000000' } : undefined}>
                                        {b}
                                      </div>
                                    </div>
                                    <div className="text-gray-700 text-xs font-mono w-20 text-right truncate" style={{ color: '#000000' }}>
                                      {m.score || ''}
                                    </div>
                                    {canScore && isPending ? (
                                      <button
                                        onClick={() => openEdit(m)}
                                        className="px-3 py-1.5 bg-orange-500 hover:bg-orange-600 text-white rounded font-medium text-xs whitespace-nowrap"
                                      >
                                        Enter Score
                                      </button>
                                    ) : !isPending ? (
                                      <button onClick={() => openEdit(m)} className="px-2 py-1 text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded text-xs flex items-center gap-1">
                                        <Edit3 size={12} /> Edit
                                      </button>
                                    ) : (
                                      <span className="text-xs text-gray-400 italic">awaiting</span>
                                    )}
                                  </div>
                                  <div className="flex items-center gap-2 text-xs text-gray-600 pl-1 flex-wrap">
                                    <span>Date</span>
                                    <input
                                      type="date"
                                      defaultValue={m.scheduled_date ?? ''}
                                      onBlur={(e) => {
                                        const v = e.target.value;
                                        if ((m.scheduled_date ?? '') !== v) updateMatchSchedule(m.id, 'scheduled_date', v);
                                      }}
                                      className="px-1.5 py-0.5 border rounded text-gray-900"
                                      style={{ color: '#000000' }}
                                    />
                                    <span className="ml-2">Court</span>
                                    <input
                                      type="text"
                                      defaultValue={m.court ?? ''}
                                      onBlur={(e) => {
                                        const v = e.target.value.trim();
                                        if ((m.court ?? '') !== v) updateMatchSchedule(m.id, 'court', v);
                                      }}
                                      placeholder="—"
                                      className="w-14 px-1.5 py-0.5 border rounded text-gray-900"
                                      style={{ color: '#000000' }}
                                    />
                                    <span className="ml-2">Start</span>
                                    <input
                                      type="time"
                                      defaultValue={m.scheduled_at?.slice(0, 5) ?? ''}
                                      onBlur={(e) => {
                                        const v = e.target.value;
                                        const current = m.scheduled_at?.slice(0, 5) ?? '';
                                        if (current !== v) updateMatchSchedule(m.id, 'scheduled_at', v);
                                      }}
                                      className="px-1.5 py-0.5 border rounded text-gray-900"
                                      style={{ color: '#000000' }}
                                    />
                                    {m.scheduled_at && (
                                      <span className="text-gray-400">{formatTimeDisplay(m.scheduled_at)}</span>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                        </div>
                      </div>
                    ))}
                </div>
              ))}

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
