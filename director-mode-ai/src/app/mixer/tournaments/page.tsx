'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Plus, Calendar, Trophy, Target, ExternalLink } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { format } from 'date-fns';
import { isTournamentEvent } from '@/lib/eventCategory';

type Event = {
  id: string;
  name: string;
  event_code: string;
  event_date: string;
  start_time: string | null;
  num_courts: number;
  match_format: string | null;
  slug: string | null;
  public_status: string | null;
  created_at: string;
};

const FORMAT_LABELS: Record<string, string> = {
  'single-elim-singles': '🎾 Single Elim',
  'single-elim-doubles': '👥 Single Elim',
  'single-elimination': '🏆 Single Elim',
  'fmlc-singles': '🎾 First-Match Consolation',
  'fmlc-doubles': '👥 First-Match Consolation',
  'ffic-singles': '🎾 Full Feed-In',
  'ffic-doubles': '👥 Full Feed-In',
  'rr-singles': '🔁 Round Robin',
  'rr-doubles': '🔁 Round Robin',
  'compass-singles': '🧭 Compass',
  'compass-doubles': '🧭 Compass',
  'quads': '🎯 Quads',
};

const STATUS_STYLES: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-700',
  open: 'bg-green-100 text-green-700',
  closed: 'bg-yellow-100 text-yellow-700',
  running: 'bg-blue-100 text-blue-700',
  completed: 'bg-purple-100 text-purple-700',
};

function publicPath(e: Event): string | null {
  if (!e.slug) return null;
  return e.match_format === 'quads' ? `/quads/${e.slug}` : `/tournaments/${e.slug}`;
}

export default function TournamentModePage() {
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setLoading(false);
        return;
      }
      const { data } = await supabase
        .from('events')
        .select('*')
        .eq('user_id', user.id)
        .order('event_date', { ascending: false });

      // TournamentMode = public-signup bracket/draw events + quads. Casual
      // mixers stay in MixerMode; Flex-league divisions stay in LeagueMode.
      if (data) setEvents((data as Event[]).filter(isTournamentEvent));
      setLoading(false);
    })();
  }, []);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const upcoming = events.filter((e) => new Date(e.event_date) >= today);
  const past = events.filter((e) => new Date(e.event_date) < today);

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-yellow-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const renderCard = (event: Event, dim = false) => {
    const pub = publicPath(event);
    return (
      <div
        key={event.id}
        className={`bg-white rounded-xl border p-4 hover:shadow-md transition-all ${dim ? 'opacity-60' : ''}`}
      >
        <div className="flex items-start justify-between mb-3 gap-2">
          <Link href={`/mixer/events/${event.id}`} className="flex-1 min-w-0">
            <h3 className="font-semibold text-lg truncate text-gray-900 hover:text-yellow-700">{event.name}</h3>
            <p className="text-sm text-gray-500">
              {format(new Date(event.event_date), 'MMM d, yyyy')}
              {event.start_time && ` at ${event.start_time}`}
            </p>
          </Link>
          {event.public_status && (
            <span className={`px-2 py-0.5 rounded-full text-xs font-medium shrink-0 ${STATUS_STYLES[event.public_status] || STATUS_STYLES.draft}`}>
              {event.public_status}
            </span>
          )}
        </div>
        <div className="flex items-center justify-between gap-2 text-sm text-gray-500">
          <span className="flex items-center gap-3">
            <span className="flex items-center gap-1"><Trophy size={14} />{event.num_courts} courts</span>
            {event.match_format && (
              <span className="text-xs">{FORMAT_LABELS[event.match_format] || event.match_format}</span>
            )}
          </span>
          {pub && (
            <Link href={pub} target="_blank" className="inline-flex items-center gap-1 text-xs text-yellow-700 hover:underline">
              Public page <ExternalLink size={12} />
            </Link>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="font-semibold text-2xl sm:text-3xl mb-1">TournamentMode</h1>
          <p className="text-gray-500">Brackets &amp; draws — single elim, consolation, round robin, compass, and quads.</p>
        </div>
        <Link
          href="/mixer/select-format"
          className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-yellow-500 text-white rounded-lg font-medium hover:bg-yellow-600"
        >
          <Plus size={18} />
          New Tournament
        </Link>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <div className="bg-white rounded-xl border p-4 flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl flex items-center justify-center bg-yellow-100 text-yellow-600">
            <Calendar size={22} />
          </div>
          <div>
            <div className="text-sm text-gray-500">Upcoming</div>
            <div className="text-2xl font-semibold">{upcoming.length}</div>
          </div>
        </div>
        <div className="bg-white rounded-xl border p-4 flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl flex items-center justify-center bg-blue-100 text-blue-600">
            <Trophy size={22} />
          </div>
          <div>
            <div className="text-sm text-gray-500">Total Draws</div>
            <div className="text-2xl font-semibold">{events.length}</div>
          </div>
        </div>
        <div className="bg-white rounded-xl border p-4 flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl flex items-center justify-center bg-orange-100 text-orange-600">
            <Target size={22} />
          </div>
          <div>
            <div className="text-sm text-gray-500">Live / Open</div>
            <div className="text-2xl font-semibold">
              {events.filter((e) => e.public_status === 'open' || e.public_status === 'running').length}
            </div>
          </div>
        </div>
      </div>

      {events.length === 0 ? (
        <div className="bg-white rounded-xl border p-12 text-center">
          <Trophy size={48} className="mx-auto text-gray-300 mb-4" />
          <h3 className="font-semibold text-lg mb-2 text-gray-900">No tournaments yet</h3>
          <p className="text-gray-500 mb-4">
            Create a bracket, round-robin, compass draw, or quads event. Running a casual social instead? Head to MixerMode.
          </p>
          <Link
            href="/mixer/select-format"
            className="inline-flex items-center gap-2 px-4 py-2 bg-yellow-500 text-white rounded-lg font-medium hover:bg-yellow-600"
          >
            <Plus size={18} />
            New Tournament
          </Link>
        </div>
      ) : (
        <div className="space-y-6">
          {upcoming.length > 0 && (
            <div>
              <h2 className="font-semibold text-lg mb-3">Upcoming &amp; Live</h2>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {upcoming.map((e) => renderCard(e))}
              </div>
            </div>
          )}
          {past.length > 0 && (
            <div>
              <h2 className="font-semibold text-lg mb-3 text-gray-500">Past</h2>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {past.map((e) => renderCard(e, true))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
