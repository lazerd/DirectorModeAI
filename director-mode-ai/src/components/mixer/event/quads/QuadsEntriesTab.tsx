'use client';

import { useState } from 'react';
import {
  CheckCircle2,
  Clock,
  XCircle,
  ArrowUp,
  ArrowDown,
  UserPlus,
  Trash2,
  AlertCircle,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import type { QuadEvent, QuadEntry, QuadFlight } from '../QuadsAdminDashboard';

const POSITION_LABELS: Record<QuadEntry['position'], { label: string; color: string }> = {
  in_flight: { label: 'Confirmed', color: 'bg-emerald-100 text-emerald-700' },
  waitlist: { label: 'Waitlist', color: 'bg-amber-100 text-amber-700' },
  pending_payment: { label: 'Pending pmt', color: 'bg-gray-100 text-gray-700' },
  withdrawn: { label: 'Withdrawn', color: 'bg-red-100 text-red-700' },
};

const PAYMENT_LABELS: Record<QuadEntry['payment_status'], { label: string; color: string }> = {
  paid: { label: 'Paid', color: 'text-emerald-600' },
  waived: { label: 'Waived', color: 'text-blue-600' },
  pending: { label: 'Pending', color: 'text-amber-600' },
  refunded: { label: 'Refunded', color: 'text-purple-600' },
  failed: { label: 'Failed', color: 'text-red-600' },
};

export default function QuadsEntriesTab({
  event,
  entries,
  flights,
  onRefresh,
}: {
  event: QuadEvent;
  entries: QuadEntry[];
  flights: QuadFlight[];
  onRefresh: () => void | Promise<void>;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [newPlayer, setNewPlayer] = useState({
    player_name: '',
    player_email: '',
    parent_email: '',
    ntrp: '',
    utr: '',
    gender: '' as '' | 'male' | 'female' | 'nonbinary',
  });
  const [error, setError] = useState<string | null>(null);

  const supabase = createClient();

  const setPosition = async (entryId: string, position: QuadEntry['position']) => {
    setBusy(entryId);
    await fetch(`/api/quads/entries/${entryId}/position`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ position }),
    });
    await onRefresh();
    setBusy(null);
  };

  const setPaymentStatus = async (entryId: string, payment_status: QuadEntry['payment_status']) => {
    setBusy(entryId);
    await supabase.from('quad_entries').update({ payment_status }).eq('id', entryId);
    await onRefresh();
    setBusy(null);
  };

  const removeEntry = async (entryId: string) => {
    if (!confirm('Remove this entry permanently?')) return;
    setBusy(entryId);
    await supabase.from('quad_entries').delete().eq('id', entryId);
    await onRefresh();
    setBusy(null);
  };

  const addManualEntry = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy('add');
    const utr = newPlayer.utr ? parseFloat(newPlayer.utr) : null;
    const ntrp = newPlayer.ntrp ? parseFloat(newPlayer.ntrp) : null;
    const composite = utr && utr > 0 ? utr : ntrp ? ntrp * 2 : null;

    const inFlightCount = entries.filter((e) => e.position === 'in_flight').length;
    const initialPosition: QuadEntry['position'] =
      event.max_players && inFlightCount >= event.max_players ? 'waitlist' : 'in_flight';

    const { error: insErr } = await supabase.from('quad_entries').insert({
      event_id: event.id,
      player_name: newPlayer.player_name.trim(),
      player_email: newPlayer.player_email.trim() || null,
      parent_email: newPlayer.parent_email.trim() || null,
      gender: newPlayer.gender || null,
      ntrp,
      utr,
      composite_rating: composite,
      position: initialPosition,
      payment_status: 'waived',
    });

    if (insErr) {
      setError(insErr.message);
      setBusy(null);
      return;
    }

    setNewPlayer({
      player_name: '',
      player_email: '',
      parent_email: '',
      ntrp: '',
      utr: '',
      gender: '',
    });
    setShowAdd(false);
    await onRefresh();
    setBusy(null);
  };

  const sorted = [...entries].sort(
    (a, b) => (b.composite_rating ?? 0) - (a.composite_rating ?? 0)
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm text-gray-600">
          {entries.length} total entries · sorted by rating
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
                setNewPlayer({ ...newPlayer, gender: e.target.value as typeof newPlayer.gender })
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
          </div>
          {error && (
            <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg p-2">
              {error}
            </div>
          )}
          <button
            type="submit"
            disabled={busy === 'add' || !newPlayer.player_name.trim()}
            className="px-4 py-2 bg-orange-500 text-white rounded-lg text-sm font-medium hover:bg-orange-600 disabled:opacity-50"
          >
            Add player
          </button>
          <p className="text-xs text-gray-500">
            Manual adds skip Stripe (payment marked waived). Rating fed straight into snake-tier
            seeding.
          </p>
        </form>
      )}

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
                <th className="text-left px-3 py-2">Gender</th>
                <th className="text-left px-3 py-2">Status</th>
                <th className="text-left px-3 py-2">Payment</th>
                <th className="text-right px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((entry) => {
                const flight = flights.find((f) => f.id === entry.flight_id);
                const pos = POSITION_LABELS[entry.position];
                const pay = PAYMENT_LABELS[entry.payment_status];
                return (
                  <tr key={entry.id} className="border-t border-gray-100">
                    <td className="px-3 py-2">
                      <div className="font-medium text-gray-900">{entry.player_name}</div>
                      <div className="text-xs text-gray-500">
                        {entry.player_email || entry.parent_email || '—'}
                        {flight && ` · ${flight.name} · seed ${entry.flight_seed}`}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-gray-700">
                      {entry.utr ? `UTR ${entry.utr.toFixed(2)}` : entry.ntrp ? `NTRP ${entry.ntrp.toFixed(1)}` : '—'}
                      {entry.composite_rating ? (
                        <div className="text-xs text-gray-400">comp {entry.composite_rating.toFixed(2)}</div>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-gray-700 capitalize">{entry.gender ?? '—'}</td>
                    <td className="px-3 py-2">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${pos.color}`}>
                        {entry.position === 'in_flight' && <CheckCircle2 size={11} />}
                        {entry.position === 'waitlist' && <Clock size={11} />}
                        {entry.position === 'pending_payment' && <Clock size={11} />}
                        {entry.position === 'withdrawn' && <XCircle size={11} />}
                        {pos.label}
                      </span>
                    </td>
                    <td className={`px-3 py-2 ${pay.color} text-xs font-medium`}>{pay.label}</td>
                    <td className="px-3 py-2 text-right">
                      <div className="inline-flex items-center gap-1">
                        {entry.position === 'waitlist' && (
                          <button
                            onClick={() => setPosition(entry.id, 'in_flight')}
                            disabled={busy === entry.id}
                            title="Promote to confirmed"
                            className="p-1.5 hover:bg-emerald-50 text-emerald-600 rounded"
                          >
                            <ArrowUp size={14} />
                          </button>
                        )}
                        {entry.position === 'in_flight' && (
                          <button
                            onClick={() => setPosition(entry.id, 'waitlist')}
                            disabled={busy === entry.id}
                            title="Move to waitlist"
                            className="p-1.5 hover:bg-amber-50 text-amber-600 rounded"
                          >
                            <ArrowDown size={14} />
                          </button>
                        )}
                        {entry.payment_status !== 'paid' && entry.payment_status !== 'waived' && (
                          <button
                            onClick={() => setPaymentStatus(entry.id, 'waived')}
                            disabled={busy === entry.id}
                            title="Mark payment waived"
                            className="px-2 py-1 text-xs hover:bg-blue-50 text-blue-600 rounded"
                          >
                            Waive
                          </button>
                        )}
                        <button
                          onClick={() => removeEntry(entry.id)}
                          disabled={busy === entry.id}
                          title="Delete entry"
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

      {event.max_players && (
        <div className="text-xs text-gray-500 flex items-start gap-1">
          <AlertCircle size={12} className="mt-0.5" />
          Cap = {event.max_players} confirmed. Extras land on the waitlist automatically.
        </div>
      )}
    </div>
  );
}
