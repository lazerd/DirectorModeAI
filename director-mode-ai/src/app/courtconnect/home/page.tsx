'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Plus, Calendar, Users, MapPin, Clock } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { format } from 'date-fns';

type Event = {
  id: string;
  title: string;
  event_type: string;
  sport: string;
  event_date: string;
  start_time: string;
  end_time: string | null;
  location: string | null;
  max_players: number;
  status: string;
  created_at: string;
};

type PlayerProfile = {
  id: string;
  display_name: string;
  primary_sport: string;
};

export default function CourtConnectHomePage() {
  const [myEvents, setMyEvents] = useState<Event[]>([]);
  const [upcomingEvents, setUpcomingEvents] = useState<Event[]>([]);
  const [player, setPlayer] = useState<PlayerProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }

    // Fetch player profile
    const { data: playerData } = await supabase
      .from('cc_players')
      .select('*')
      .eq('profile_id', user.id)
      .single();
    setPlayer(playerData);

    // Fetch events I created
    const { data: created } = await supabase
      .from('cc_events')
      .select('*')
      .eq('created_by', user.id)
      .order('event_date', { ascending: false });
    if (created) setMyEvents(created);

    // Fetch events I'm accepted to (via cc_event_players)
    if (playerData) {
      const { data: rsvps } = await supabase
        .from('cc_event_players')
        .select('event_id')
        .eq('player_id', playerData.id)
        .eq('status', 'accepted');

      if (rsvps && rsvps.length > 0) {
        const eventIds = rsvps.map(r => r.event_id);
        const { data: upcoming } = await supabase
          .from('cc_events')
          .select('*')
          .in('id', eventIds)
          .gte('event_date', new Date().toISOString().split('T')[0])
          .order('event_date', { ascending: true });
        if (upcoming) setUpcomingEvents(upcoming);
      }
    }

    setLoading(false);
  };

  const sportLabel = (sport: string) =>
    sport.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase());

  const typeLabel = (type: string) =>
    type.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase());

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="spinner" />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-5xl mx-auto page-enter">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-display">CourtConnect</h1>
          <p className="text-gray-500 mt-1">Find players, join events, get on court</p>
        </div>
        <Link
          href="/courtconnect/events/new"
          className="btn btn-courtconnect"
        >
          <Plus size={18} />
          Create Event
        </Link>
      </div>

      {/* Setup prompt if no player profile */}
      {!player && (
        <div className="card p-6 mb-8 border-courtconnect/30 bg-courtconnect-light">
          <h2 className="font-semibold text-lg mb-2">Set up your player profile</h2>
          <p className="text-gray-600 mb-4">
            Add your sports, skill ratings, and availability so others can find you for matches.
          </p>
          <Link href="/courtconnect/profile" className="btn btn-courtconnect btn-sm">
            Create Profile
          </Link>
        </div>
      )}

      {/* Upcoming Events I'm Playing In */}
      {upcomingEvents.length > 0 && (
        <section className="mb-8">
          <h2 className="text-lg font-semibold mb-4">Upcoming Events</h2>
          <div className="grid gap-4 md:grid-cols-2">
            {upcomingEvents.map(event => (
              <Link
                key={event.id}
                href={`/courtconnect/events/${event.id}`}
                className="card card-interactive p-5"
              >
                <div className="flex items-start justify-between mb-2">
                  <h3 className="font-semibold">{event.title}</h3>
                  <span className="badge badge-courtconnect">{sportLabel(event.sport)}</span>
                </div>
                <div className="space-y-1.5 text-sm text-gray-500">
                  <div className="flex items-center gap-2">
                    <Calendar size={14} />
                    {format(new Date(event.event_date), 'EEE, MMM d')}
                    {event.start_time && ` at ${event.start_time.slice(0, 5)}`}
                  </div>
                  {event.location && (
                    <div className="flex items-center gap-2">
                      <MapPin size={14} />
                      {event.location}
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <Users size={14} />
                    {typeLabel(event.event_type)} &middot; {event.max_players} spots
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* My Created Events */}
      <section>
        <h2 className="text-lg font-semibold mb-4">My Events</h2>
        {myEvents.length === 0 ? (
          <div className="card p-8 text-center">
            <Calendar size={40} className="mx-auto text-gray-300 mb-3" />
            <p className="text-gray-500 mb-4">You haven&apos;t created any events yet.</p>
            <Link href="/courtconnect/events/new" className="btn btn-courtconnect btn-sm">
              <Plus size={16} />
              Create Your First Event
            </Link>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {myEvents.map(event => (
              <Link
                key={event.id}
                href={`/courtconnect/events/${event.id}`}
                className="card card-interactive p-5"
              >
                <div className="flex items-start justify-between mb-2">
                  <h3 className="font-semibold">{event.title}</h3>
                  <div className="flex items-center gap-2">
                    <span className="badge badge-courtconnect">{sportLabel(event.sport)}</span>
                    <span className={`badge ${event.status === 'open' ? 'badge-success' : 'badge-warning'}`}>
                      {event.status}
                    </span>
                  </div>
                </div>
                <div className="space-y-1.5 text-sm text-gray-500">
                  <div className="flex items-center gap-2">
                    <Calendar size={14} />
                    {format(new Date(event.event_date), 'EEE, MMM d, yyyy')}
                  </div>
                  <div className="flex items-center gap-2">
                    <Clock size={14} />
                    {event.start_time?.slice(0, 5)}
                    {event.end_time && ` - ${event.end_time.slice(0, 5)}`}
                  </div>
                  <div className="flex items-center gap-2">
                    <Users size={14} />
                    {typeLabel(event.event_type)} &middot; {event.max_players} max
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
