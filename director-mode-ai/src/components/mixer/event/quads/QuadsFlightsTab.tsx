'use client';

import { useState } from 'react';
import { Trophy, Wand2, Trash2, AlertCircle, Loader2, ArrowRight, ListChecks } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { assignToFlights, generateQuadSingles } from '@/lib/quads';
import type { QuadEvent, QuadEntry, QuadFlight, QuadMatch } from '../QuadsAdminDashboard';

export default function QuadsFlightsTab({
  event,
  entries,
  flights,
  matches,
  onRefresh,
  onAdvanceToMatches,
}: {
  event: QuadEvent;
  entries: QuadEntry[];
  flights: QuadFlight[];
  matches: QuadMatch[];
  onRefresh: () => void | Promise<void>;
  onAdvanceToMatches?: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const supabase = createClient();
  const inFlightEntries = entries.filter((e) => e.position === 'in_flight');

  const generateFlights = async () => {
    setBusy('generate');
    setError(null);

    // Tier the in_flight entries by composite rating descending
    const result = assignToFlights(
      inFlightEntries.map((e) => ({ id: e.id, composite_rating: e.composite_rating })),
      event.max_players ? { maxFlights: Math.floor(event.max_players / 4) } : undefined
    );

    // Wipe existing flights for this event (cascade kills matches + clears flight refs)
    const { error: delErr } = await supabase
      .from('quad_flights')
      .delete()
      .eq('event_id', event.id);
    if (delErr) {
      setError(delErr.message);
      setBusy(null);
      return;
    }

    // Insert flights
    const { data: newFlights, error: insErr } = await supabase
      .from('quad_flights')
      .insert(
        result.flights.map((f) => ({
          event_id: event.id,
          name: f.name,
          tier_label: f.tier_label,
          sort_order: f.sort_order,
        }))
      )
      .select('*');
    if (insErr || !newFlights) {
      setError(insErr?.message || 'Could not create flights');
      setBusy(null);
      return;
    }

    // Update each entry with flight_id + flight_seed (1..4 by tier order)
    // Also push leftover entries to waitlist.
    const flightById = new Map(
      result.flights.map((f, i) => [f.sort_order, (newFlights as any[])[i]])
    );

    for (const f of result.flights) {
      const newFlight = flightById.get(f.sort_order);
      if (!newFlight) continue;
      for (let i = 0; i < f.entryIds.length; i++) {
        await supabase
          .from('quad_entries')
          .update({
            flight_id: newFlight.id,
            flight_seed: i + 1,
            position: 'in_flight',
          })
          .eq('id', f.entryIds[i]);
      }
      // Generate the 6 singles matches for this flight
      const singles = generateQuadSingles(f.entryIds as [string, string, string, string]);
      await supabase.from('quad_matches').insert(
        singles.map((s) => ({
          flight_id: newFlight.id,
          round: s.round,
          match_type: s.match_type,
          player1_id: s.player1_id,
          player3_id: s.player3_id,
        }))
      );
    }

    // Anyone not assigned to a flight (leftovers) → waitlist + clear flight info
    if (result.waitlistIds.length > 0) {
      await supabase
        .from('quad_entries')
        .update({ flight_id: null, flight_seed: null, position: 'waitlist' })
        .in('id', result.waitlistIds);
    }

    // Move event to running
    await supabase.from('events').update({ public_status: 'running' }).eq('id', event.id);

    await onRefresh();
    setBusy(null);
  };

  const wipeFlights = async () => {
    if (!confirm('Delete all flights and matches? Entries stay; their flight assignments clear.')) return;
    setBusy('wipe');
    await supabase.from('quad_flights').delete().eq('event_id', event.id);
    await supabase
      .from('quad_entries')
      .update({ flight_id: null, flight_seed: null })
      .eq('event_id', event.id);
    await supabase.from('events').update({ public_status: 'open' }).eq('id', event.id);
    await onRefresh();
    setBusy(null);
  };

  return (
    <div className="space-y-4">
      <div className="bg-white border border-gray-200 rounded-xl p-4 flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold mb-1">Generate flights</h3>
          <p className="text-sm text-gray-600">
            {inFlightEntries.length} confirmed entries → {Math.floor(inFlightEntries.length / 4)}{' '}
            flight{Math.floor(inFlightEntries.length / 4) === 1 ? '' : 's'} of 4 ·{' '}
            {inFlightEntries.length % 4} leftover{inFlightEntries.length % 4 === 1 ? '' : 's'} to
            waitlist.
          </p>
          <p className="text-xs text-gray-500 mt-1">
            Top 4 by rating → Flight A, next 4 → Flight B, etc. (tier-based, not snake.)
          </p>
        </div>
        <div className="flex gap-2 flex-shrink-0">
          {flights.length > 0 && (
            <button
              onClick={wipeFlights}
              disabled={busy !== null}
              className="inline-flex items-center gap-2 px-3 py-2 border border-red-300 text-red-600 rounded-lg text-sm font-medium hover:bg-red-50 disabled:opacity-50"
            >
              <Trash2 size={14} />
              Wipe
            </button>
          )}
          <button
            onClick={generateFlights}
            disabled={busy !== null || inFlightEntries.length < 4}
            className="inline-flex items-center gap-2 px-3 py-2 bg-orange-500 text-white rounded-lg text-sm font-medium hover:bg-orange-600 disabled:opacity-50"
          >
            {busy === 'generate' ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />}
            {flights.length > 0 ? 'Regenerate' : 'Generate flights'}
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-3 text-sm flex items-start gap-2">
          <AlertCircle size={14} className="mt-0.5" />
          {error}
        </div>
      )}

      {flights.length === 0 ? (
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-8 text-center text-sm text-gray-500">
          No flights yet. Generate them once you have at least 4 confirmed entries.
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 gap-4">
          {flights.map((flight) => {
            const flightEntries = entries
              .filter((e) => e.flight_id === flight.id)
              .sort((a, b) => (a.flight_seed ?? 0) - (b.flight_seed ?? 0));
            const flightMatches = matches.filter((m) => m.flight_id === flight.id);
            const completed = flightMatches.filter((m) => m.status === 'completed').length;
            return (
              <div key={flight.id} className="bg-white border border-gray-200 rounded-xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <Trophy size={16} className="text-orange-500" />
                      <h3 className="font-semibold">{flight.name}</h3>
                      {flight.tier_label && (
                        <span className="text-xs text-gray-500">· {flight.tier_label}</span>
                      )}
                    </div>
                  </div>
                  <div className="text-xs text-gray-500">
                    {completed} / {flightMatches.length || 7} done
                  </div>
                </div>
                <ol className="space-y-1 text-sm">
                  {flightEntries.map((e) => (
                    <li key={e.id} className="flex items-center gap-2">
                      <span className="w-5 text-gray-400 font-mono text-xs">{e.flight_seed}.</span>
                      <span className="flex-1 truncate text-gray-900">{e.player_name}</span>
                      <span className="text-xs text-gray-500">
                        {e.utr ? `UTR ${e.utr.toFixed(2)}` : e.ntrp ? `NTRP ${e.ntrp.toFixed(1)}` : 'unrated'}
                      </span>
                    </li>
                  ))}
                </ol>
              </div>
            );
          })}
        </div>
      )}

      {/* Advance-to-matches CTA — appears once flights are generated. */}
      {flights.length > 0 && onAdvanceToMatches && (
        <div className="bg-emerald-50 border-2 border-emerald-300 rounded-xl p-4 sm:p-5 flex items-center justify-between gap-3 mt-4">
          <div className="flex-1">
            <div className="font-semibold text-emerald-900 flex items-center gap-2">
              <ListChecks size={16} />
              Flights are set
            </div>
            <p className="text-sm text-emerald-800 mt-0.5">
              {flights.length} flight{flights.length === 1 ? '' : 's'} of 4 ready. Open Matches to
              start scoring (or copy magic-link URLs to send to coaches/parents).
            </p>
          </div>
          <button
            onClick={onAdvanceToMatches}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-semibold text-sm flex-shrink-0"
          >
            View matches
            <ArrowRight size={16} />
          </button>
        </div>
      )}
    </div>
  );
}
