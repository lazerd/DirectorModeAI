'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Plus, Calendar, Users, Trophy, QrCode, Clock } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { format } from 'date-fns';

type Event = {
  id: string;
  name: string;
  event_code: string;
  event_date: string;
  start_time: string | null;
  num_courts: number;
  created_at: string;
};

export default function MixerHomePage() {
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchEvents();
  }, []);

  const fetchEvents = async () => {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) return;

    const { data } = await supabase
      .from('mixer_events')
      .select('*')
      .eq('user_id', user.id)
      .order('event_date', { ascending: false });

    if (data) setEvents(data);
    setLoading(false);
  };

  const upcomingEvents = events.filter(e => new Date(e.event_date) >= new Date());
  const pastEvents = events.filter(e => new Date(e.event_date) < new Date());

  return (
    <div className="p-6 lg:p-8">
      <div className="page-enter">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <div>
            <h1 className="font-display text-2xl sm:text-3xl mb-1">My Events</h1>
            <p className="text-gray-500">Manage your mixers and tournaments</p>
          </div>
          <Link href="/mixer/events/new" className="btn btn-mixer">
            <Plus size={18} />
            Create Event
          </Link>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          <StatCard
            icon={Calendar}
            label="Upcoming"
            value={upcomingEvents.length}
            color="warning"
          />
          <StatCard
            icon={Trophy}
            label="Total Events"
            value={events.length}
            color="primary"
          />
          <StatCard
            icon={Users}
            label="This Month"
            value={events.filter(e => {
              const d = new Date(e.event_date);
              const now = new Date();
              return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
            }).length}
            color="success"
          />
        </div>

        {/* Events List */}
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="spinner" />
          </div>
        ) : events.length === 0 ? (
          <div className="card p-12 text-center">
            <Trophy size={48} className="mx-auto text-gray-300 mb-4" />
            <h3 className="font-display text-lg mb-2">No events yet</h3>
            <p className="text-gray-500 mb-4">
              Create your first event to get started with round robins and mixers.
            </p>
            <Link href="/mixer/events/new" className="btn btn-mixer">
              <Plus size={18} />
              Create Event
            </Link>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Upcoming */}
            {upcomingEvents.length > 0 && (
              <div>
                <h2 className="font-display text-lg mb-3">Upcoming Events</h2>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {upcomingEvents.map((event) => (
                    <EventCard key={event.id} event={event} />
                  ))}
                </div>
              </div>
            )}

            {/* Past */}
            {pastEvents.length > 0 && (
              <div>
                <h2 className="font-display text-lg mb-3 text-gray-500">Past Events</h2>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {pastEvents.map((event) => (
                    <EventCard key={event.id} event={event} isPast />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  color,
}: {
  icon: React.ElementType;
  label: string;
  value: number;
  color: 'primary' | 'success' | 'warning';
}) {
  const colors = {
    primary: 'bg-primary-light text-primary',
    success: 'bg-success-light text-success',
    warning: 'bg-warning-light text-warning',
  };

  return (
    <div className="card p-4 flex items-center gap-4">
      <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${colors[color]}`}>
        <Icon size={22} />
      </div>
      <div>
        <div className="text-sm text-gray-500">{label}</div>
        <div className="text-2xl font-display">{value}</div>
      </div>
    </div>
  );
}

function EventCard({ event, isPast }: { event: Event; isPast?: boolean }) {
  return (
    <Link
      href={`/mixer/events/${event.id}`}
      className={`card p-4 hover:shadow-md transition-all ${isPast ? 'opacity-60' : ''}`}
    >
      <div className="flex items-start justify-between mb-3">
        <div>
          <h3 className="font-display text-lg">{event.name}</h3>
          <p className="text-sm text-gray-500">
            {format(new Date(event.event_date), 'MMM d, yyyy')}
            {event.start_time && ` at ${event.start_time}`}
          </p>
        </div>
        <span className="badge badge-mixer font-mono">{event.event_code}</span>
      </div>
      
      <div className="flex items-center gap-4 text-sm text-gray-500">
        <span className="flex items-center gap-1">
          <Trophy size={14} />
          {event.num_courts} courts
        </span>
      </div>
    </Link>
  );
}
