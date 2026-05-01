'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  Users,
  Trophy,
  Settings as SettingsIcon,
  ListChecks,
  Loader2,
  Share2,
  Copy,
  Check,
  AlertCircle,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import QuadsEntriesTab from './quads/QuadsEntriesTab';
import QuadsFlightsTab from './quads/QuadsFlightsTab';
import QuadsMatchesTab from './quads/QuadsMatchesTab';
import QuadsSettingsTab from './quads/QuadsSettingsTab';

export type QuadEvent = {
  id: string;
  name: string;
  slug: string;
  event_date: string;
  start_time: string | null;
  num_courts: number;
  age_max: number | null;
  gender_restriction: 'boys' | 'girls' | 'coed' | null;
  event_scoring_format: string;
  entry_fee_cents: number;
  max_players: number | null;
  registration_opens_at: string | null;
  registration_closes_at: string | null;
  public_status: 'draft' | 'open' | 'closed' | 'running' | 'completed' | 'cancelled';
  stripe_account_id: string | null;
  round_duration_minutes: number;
  court_names: string[] | null;
};

export type QuadEntry = {
  id: string;
  event_id: string;
  player_name: string;
  player_email: string | null;
  player_phone: string | null;
  parent_name: string | null;
  parent_email: string | null;
  parent_phone: string | null;
  date_of_birth: string | null;
  gender: 'male' | 'female' | 'nonbinary' | null;
  ntrp: number | null;
  utr: number | null;
  composite_rating: number | null;
  position: 'pending_payment' | 'in_flight' | 'waitlist' | 'withdrawn';
  flight_id: string | null;
  flight_seed: number | null;
  payment_status: 'pending' | 'paid' | 'waived' | 'refunded' | 'failed';
  amount_paid_cents: number | null;
  registered_at: string;
};

export type QuadFlight = {
  id: string;
  event_id: string;
  name: string;
  sort_order: number;
  tier_label: string | null;
};

export type QuadMatch = {
  id: string;
  flight_id: string;
  round: number;
  match_type: 'singles' | 'doubles';
  player1_id: string | null;
  player2_id: string | null;
  player3_id: string | null;
  player4_id: string | null;
  court: string | null;
  scheduled_at: string | null;
  score: string | null;
  winner_side: 'a' | 'b' | null;
  status: 'pending' | 'in_progress' | 'completed' | 'defaulted' | 'cancelled';
  score_token: string;
};

type Tab = 'entries' | 'flights' | 'matches' | 'settings';

export default function QuadsAdminDashboard({ eventId }: { eventId: string }) {
  const [event, setEvent] = useState<QuadEvent | null>(null);
  const [entries, setEntries] = useState<QuadEntry[]>([]);
  const [flights, setFlights] = useState<QuadFlight[]>([]);
  const [matches, setMatches] = useState<QuadMatch[]>([]);
  const [tab, setTab] = useState<Tab>('entries');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const supabase = createClient();
    const { data: ev, error: evErr } = await supabase
      .from('events')
      .select(
        'id, name, slug, event_date, start_time, num_courts, age_max, gender_restriction, event_scoring_format, entry_fee_cents, max_players, registration_opens_at, registration_closes_at, public_status, stripe_account_id, round_duration_minutes, court_names'
      )
      .eq('id', eventId)
      .maybeSingle();
    if (evErr) {
      setError(evErr.message);
      setLoading(false);
      return;
    }
    setEvent(ev as QuadEvent);

    const [eRes, fRes] = await Promise.all([
      supabase
        .from('quad_entries')
        .select('*')
        .eq('event_id', eventId)
        .order('registered_at', { ascending: true }),
      supabase
        .from('quad_flights')
        .select('*')
        .eq('event_id', eventId)
        .order('sort_order'),
    ]);
    setEntries((eRes.data as QuadEntry[]) || []);
    const flightList = (fRes.data as QuadFlight[]) || [];
    setFlights(flightList);

    if (flightList.length > 0) {
      const { data: mRes } = await supabase
        .from('quad_matches')
        .select('*')
        .in('flight_id', flightList.map((f) => f.id))
        .order('round');
      setMatches((mRes as QuadMatch[]) || []);
    } else {
      setMatches([]);
    }

    setLoading(false);
  }, [eventId]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const publicUrl = useMemo(() => {
    if (!event) return '';
    if (typeof window === 'undefined') return `/quads/${event.slug}`;
    return `${window.location.origin}/quads/${event.slug}`;
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

  const entriesInFlight = entries.filter((e) => e.position === 'in_flight').length;
  const entriesWaitlisted = entries.filter((e) => e.position === 'waitlist').length;
  const entriesPending = entries.filter((e) => e.position === 'pending_payment').length;

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
              Quads
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
            {entriesInFlight} confirmed · {entriesWaitlisted} waitlist · {entriesPending} pending payment
          </p>
        </div>
        <button
          onClick={copyLink}
          className="hidden sm:inline-flex items-center gap-2 px-3 py-2 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 text-sm"
        >
          {copied ? <Check size={14} className="text-emerald-600" /> : <Copy size={14} />}
          {copied ? 'Copied!' : 'Copy public link'}
        </button>
      </div>

      <div className="bg-orange-50 border border-orange-200 rounded-xl p-3 mb-6 flex items-center gap-3">
        <Share2 size={16} className="text-orange-600 flex-shrink-0" />
        <div className="text-sm text-orange-900 flex-1 truncate">
          Public signup:{' '}
          <a href={publicUrl} target="_blank" className="font-mono underline">
            {publicUrl}
          </a>
        </div>
      </div>

      <div className="border-b border-gray-200 mb-6 flex gap-1 overflow-x-auto">
        {[
          { id: 'entries' as const, label: 'Entries', icon: Users },
          { id: 'flights' as const, label: 'Flights', icon: Trophy },
          { id: 'matches' as const, label: 'Matches', icon: ListChecks },
          { id: 'settings' as const, label: 'Settings', icon: SettingsIcon },
        ].map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-2 px-4 py-2 border-b-2 font-medium text-sm whitespace-nowrap ${
                active
                  ? 'border-orange-500 text-orange-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              <Icon size={16} />
              {t.label}
            </button>
          );
        })}
      </div>

      {tab === 'entries' && (
        <QuadsEntriesTab
          event={event}
          entries={entries}
          flights={flights}
          onRefresh={fetchAll}
          onAdvanceToFlights={() => setTab('flights')}
        />
      )}
      {tab === 'flights' && (
        <QuadsFlightsTab
          event={event}
          entries={entries}
          flights={flights}
          matches={matches}
          onRefresh={fetchAll}
          onAdvanceToMatches={() => setTab('matches')}
        />
      )}
      {tab === 'matches' && (
        <QuadsMatchesTab event={event} entries={entries} flights={flights} matches={matches} onRefresh={fetchAll} />
      )}
      {tab === 'settings' && <QuadsSettingsTab event={event} onRefresh={fetchAll} />}
    </div>
  );
}
