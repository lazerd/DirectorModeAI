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
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';

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
};

const POSITION_LABELS: Record<Entry['position'], { label: string; color: string }> = {
  in_draw: { label: 'Confirmed', color: 'bg-emerald-100 text-emerald-700' },
  waitlist: { label: 'Waitlist', color: 'bg-amber-100 text-amber-700' },
  pending_payment: { label: 'Pending pmt', color: 'bg-gray-100 text-gray-700' },
  withdrawn: { label: 'Withdrawn', color: 'bg-red-100 text-red-700' },
};

export default function TournamentAdminDashboard({ eventId }: { eventId: string }) {
  const [event, setEvent] = useState<EventRow | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

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

    const { data: e } = await supabase
      .from('tournament_entries')
      .select(
        'id, player_name, player_email, parent_email, partner_name, ntrp, utr, composite_rating, position, payment_status, registered_at'
      )
      .eq('event_id', eventId)
      .order('registered_at', { ascending: true });
    setEntries((e as Entry[]) || []);
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
  const sorted = [...entries].sort(
    (a, b) => (b.composite_rating ?? 0) - (a.composite_rating ?? 0)
  );

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
            {inDraw} confirmed · {waitlist} waitlist · {pending} pending payment
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

      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-6 text-sm text-amber-900">
        <p className="font-medium mb-1">⚠️ Admin tools coming soon</p>
        <p>
          Bracket generation, match scoring, and live results for this format are still being built.
          For now you can view registrations as they come in. The Quads tournament has the full
          admin experience if you want to see what this will look like.
        </p>
      </div>

      <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
        <Users size={18} /> Entries
      </h2>

      {entries.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-xl p-8 text-center text-gray-500 text-sm">
          No entries yet. Share the public link to start collecting registrations.
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-600">
              <tr>
                <th className="text-left px-3 py-2">Player</th>
                <th className="text-left px-3 py-2">Rating</th>
                <th className="text-left px-3 py-2">Status</th>
                <th className="text-left px-3 py-2">Payment</th>
                <th className="text-right px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((entry) => {
                const pos = POSITION_LABELS[entry.position];
                return (
                  <tr key={entry.id} className="border-t border-gray-100">
                    <td className="px-3 py-2">
                      <div className="font-medium text-gray-900">{entry.player_name}</div>
                      <div className="text-xs text-gray-500">
                        {entry.player_email || entry.parent_email || '—'}
                        {entry.partner_name && ` · partner: ${entry.partner_name}`}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-gray-700">
                      {entry.utr
                        ? `UTR ${entry.utr.toFixed(2)}`
                        : entry.ntrp
                          ? `NTRP ${entry.ntrp.toFixed(1)}`
                          : '—'}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${pos.color}`}
                      >
                        {pos.label}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-gray-700 text-xs">{entry.payment_status}</td>
                    <td className="px-3 py-2 text-right">
                      <button
                        onClick={() => removeEntry(entry.id)}
                        title="Delete entry"
                        className="p-1.5 hover:bg-red-50 text-red-500 rounded"
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
