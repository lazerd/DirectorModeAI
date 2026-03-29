'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Calendar, Users, MapPin, Filter, Search, Plus } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { format } from 'date-fns';

const SPORTS = [
  { value: '', label: 'All Sports' },
  { value: 'tennis', label: 'Tennis' },
  { value: 'pickleball', label: 'Pickleball' },
  { value: 'padel', label: 'Padel' },
  { value: 'squash', label: 'Squash' },
  { value: 'badminton', label: 'Badminton' },
  { value: 'racquetball', label: 'Racquetball' },
  { value: 'table_tennis', label: 'Table Tennis' },
];

const EVENT_TYPES = [
  { value: '', label: 'All Types' },
  { value: 'doubles', label: 'Doubles' },
  { value: 'singles', label: 'Singles' },
  { value: 'clinic', label: 'Clinic' },
  { value: 'social', label: 'Social' },
  { value: 'practice', label: 'Practice' },
  { value: 'tournament', label: 'Tournament' },
  { value: 'open_play', label: 'Open Play' },
];

type Event = {
  id: string;
  title: string;
  description: string | null;
  event_type: string;
  sport: string;
  event_date: string;
  start_time: string;
  end_time: string | null;
  location: string | null;
  max_players: number;
  skill_min: number | null;
  skill_max: number | null;
  status: string;
  is_public: boolean;
  accepted_count?: number;
};

export default function EventBoardPage() {
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [sportFilter, setSportFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    fetchEvents();
  }, [sportFilter, typeFilter]);

  const fetchEvents = async () => {
    setLoading(true);
    const supabase = createClient();

    let query = supabase
      .from('cc_events')
      .select('*')
      .eq('is_public', true)
      .eq('status', 'open')
      .gte('event_date', new Date().toISOString().split('T')[0])
      .order('event_date', { ascending: true });

    if (sportFilter) query = query.eq('sport', sportFilter);
    if (typeFilter) query = query.eq('event_type', typeFilter);

    const { data } = await query;

    if (data) {
      // Fetch accepted player counts for each event
      const eventsWithCounts = await Promise.all(
        data.map(async (event) => {
          const { count } = await supabase
            .from('cc_event_players')
            .select('*', { count: 'exact', head: true })
            .eq('event_id', event.id)
            .eq('status', 'accepted');
          return { ...event, accepted_count: count || 0 };
        })
      );
      setEvents(eventsWithCounts);
    }

    setLoading(false);
  };

  const filteredEvents = events.filter(e =>
    !searchQuery || e.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    e.location?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const sportLabel = (sport: string) =>
    sport.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase());

  const typeLabel = (type: string) =>
    type.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase());

  return (
    <div className="p-6 max-w-5xl mx-auto page-enter">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-display">Event Board</h1>
          <p className="text-gray-500 mt-1">Browse and join upcoming events</p>
        </div>
        <Link href="/courtconnect/events/new" className="btn btn-courtconnect">
          <Plus size={18} />
          Create Event
        </Link>
      </div>

      {/* Filters */}
      <div className="card p-4 mb-6">
        <div className="flex flex-wrap gap-3">
          <div className="flex-1 min-w-[200px] relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Search events..."
              className="input pl-9"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
          </div>
          <select
            className="input w-auto"
            value={sportFilter}
            onChange={e => setSportFilter(e.target.value)}
          >
            {SPORTS.map(s => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
          <select
            className="input w-auto"
            value={typeFilter}
            onChange={e => setTypeFilter(e.target.value)}
          >
            {EVENT_TYPES.map(t => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Events List */}
      {loading ? (
        <div className="flex justify-center py-12">
          <div className="spinner" />
        </div>
      ) : filteredEvents.length === 0 ? (
        <div className="card p-8 text-center">
          <Calendar size={40} className="mx-auto text-gray-300 mb-3" />
          <p className="text-gray-500">No events found matching your filters.</p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {filteredEvents.map(event => (
            <Link
              key={event.id}
              href={`/courtconnect/events/${event.id}`}
              className="card card-interactive p-5"
            >
              <div className="flex items-start justify-between mb-3">
                <h3 className="font-semibold text-lg">{event.title}</h3>
                <span className="badge badge-courtconnect">{sportLabel(event.sport)}</span>
              </div>

              {event.description && (
                <p className="text-sm text-gray-600 mb-3 line-clamp-2">{event.description}</p>
              )}

              <div className="space-y-1.5 text-sm text-gray-500">
                <div className="flex items-center gap-2">
                  <Calendar size={14} />
                  {format(new Date(event.event_date), 'EEE, MMM d')} at {event.start_time.slice(0, 5)}
                  {event.end_time && ` - ${event.end_time.slice(0, 5)}`}
                </div>
                {event.location && (
                  <div className="flex items-center gap-2">
                    <MapPin size={14} />
                    {event.location}
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <Users size={14} />
                  <span>{typeLabel(event.event_type)}</span>
                  <span>&middot;</span>
                  <span className={event.accepted_count! >= event.max_players ? 'text-red-500 font-medium' : ''}>
                    {event.accepted_count}/{event.max_players} players
                  </span>
                </div>
                {(event.skill_min || event.skill_max) && (
                  <div className="flex items-center gap-2">
                    <Filter size={14} />
                    NTRP {event.skill_min || '1.0'} - {event.skill_max || '7.0'}
                  </div>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
