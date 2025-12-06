'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Plus, Calendar, Users, Trophy, Trash2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { format } from 'date-fns';

type Event = {
  id: string;
  name: string;
  event_code: string;
  event_date: string;
  start_time: string | null;
  num_courts: number;
  match_format: string | null;
  created_at: string;
};

export default function MixerHomePage() {
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);

  useEffect(() => {
    fetchEvents();
  }, []);

  const fetchEvents = async () => {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      setLoading(false);
      return;
    }

    const { data, error } = await supabase
      .from('events')
      .select('*')
      .eq('user_id', user.id)
      .order('event_date', { ascending: false });

    if (data) setEvents(data);
    setLoading(false);
  };

  const deleteEvent = async (eventId: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (!confirm('Are you sure you want to delete this event? This cannot be undone.')) {
      return;
    }

    setDeleting(eventId);

    const supabase = createClient();

    // Delete related data first (get round IDs, then delete matches)
    const { data: rounds } = await supabase
      .from('rounds')
      .select('id')
      .eq('event_id', eventId);
    
    if (rounds && rounds.length > 0) {
      const roundIds = rounds.map(r => r.id);
      await supabase.from('matches').delete().in('round_id', roundIds);
    }
    
    await supabase.from('rounds').delete().eq('event_id', eventId);
    await supabase.from('event_players').delete().eq('event_id', eventId);
    
    // Delete the event
    const { error } = await supabase.from('events').delete().eq('id', eventId);

    if (!error) {
      setEvents(events.filter(ev => ev.id !== eventId));
    }
    
    setDeleting(null);
  };

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const upcomingEvents = events.filter(e => new Date(e.event_date) >= today);
  const pastEvents = events.filter(e => new Date(e.event_date) < today);

  const getFormatLabel = (format: string | null) => {
    const labels: Record<string, string> = {
      'singles': '🎾 Singles',
      'doubles': '👥 Doubles',
      'mixed-doubles': '👫 Mixed',
      'maximize-courts': '⚡ Optimize',
      'king-of-court': '👑 King',
      'round-robin': '🔄 Round Robin',
      'single-elimination': '🏆 Tournament',
    };
    return labels[format || ''] || format || '';
  };

  return (
    <div className="p-6 lg:p-8">
      <div className="page-enter">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <div>
            <h1 className="font-display text-2xl sm:text-3xl mb-1">My Events</h1>
            <p className="text-gray-500">Manage your mixers and tournaments</p>
          </div>
          <Link href="/mixer/select-format" className="btn btn-mixer">
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
          <div className="card p-12 text-center bg-white rounded-xl border">
            <Trophy size={48} className="mx-auto text-gray-300 mb-4" />
            <h3 className="font-semibold text-lg mb-2">No events yet</h3>
            <p className="text-gray-500 mb-4">
              Create your first event to get started with round robins and mixers.
            </p>
            <Link href="/mixer/select-format" className="btn btn-mixer inline-flex">
              <Plus size={18} />
              Create Event
            </Link>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Upcoming */}
            {upcomingEvents.length > 0 && (
              <div>
                <h2 className="font-semibold text-lg mb-3">Upcoming Events</h2>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {upcomingEvents.map((event) => (
                    <EventCard 
                      key={event.id} 
                      event={event} 
                      onDelete={deleteEvent}
                      deleting={deleting === event.id}
                      getFormatLabel={getFormatLabel}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Past */}
            {pastEvents.length > 0 && (
              <div>
                <h2 className="font-semibold text-lg mb-3 text-gray-500">Past Events</h2>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {pastEvents.map((event) => (
                    <EventCard 
                      key={event.id} 
                      event={event} 
                      isPast 
                      onDelete={deleteEvent}
                      deleting={deleting === event.id}
                      getFormatLabel={getFormatLabel}
                    />
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
    primary: 'bg-blue-100 text-blue-600',
    success: 'bg-green-100 text-green-600',
    warning: 'bg-orange-100 text-orange-600',
  };

  return (
    <div className="card p-4 flex items-center gap-4 bg-white rounded-xl border">
      <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${colors[color]}`}>
        <Icon size={22} />
      </div>
      <div>
        <div className="text-sm text-gray-500">{label}</div>
        <div className="text-2xl font-semibold">{value}</div>
      </div>
    </div>
  );
}

function EventCard({ 
  event, 
  isPast,
  onDelete,
  deleting,
  getFormatLabel,
}: { 
  event: Event; 
  isPast?: boolean;
  onDelete: (id: string, e: React.MouseEvent) => void;
  deleting: boolean;
  getFormatLabel: (format: string | null) => string;
}) {
  return (
    <Link
      href={`/mixer/events/${event.id}`}
      className={`card p-4 hover:shadow-md transition-all bg-white rounded-xl border ${isPast ? 'opacity-60' : ''}`}
    >
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-lg truncate">{event.name}</h3>
          <p className="text-sm text-gray-500">
            {format(new Date(event.event_date), 'MMM d, yyyy')}
            {event.start_time && ` at ${event.start_time}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="px-2 py-1 bg-orange-100 text-orange-600 rounded-lg text-xs font-mono">
            {event.event_code}
          </span>
          <button
            onClick={(e) => onDelete(event.id, e)}
            disabled={deleting}
            className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
            title="Delete event"
          >
            {deleting ? (
              <div className="w-4 h-4 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin" />
            ) : (
              <Trash2 size={16} />
            )}
          </button>
        </div>
      </div>
      
      <div className="flex items-center gap-4 text-sm text-gray-500">
        <span className="flex items-center gap-1">
          <Trophy size={14} />
          {event.num_courts} {event.num_courts === 1 ? 'court' : 'courts'}
        </span>
        {event.match_format && (
          <span className="text-xs">
            {getFormatLabel(event.match_format)}
          </span>
        )}
      </div>
    </Link>
  );
}
