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

    const { data } = await supabase
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
    await supabase.from('events').delete().eq('id', eventId);

    setEvents(events.filter(ev => ev.id !== eventId));
    setDeleting(null);
  };

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const upcomingEvents = events.filter(e => new Date(e.event_date) >= today);
  const pastEvents = events.filter(e => new Date(e.event_date) < today);

  const getFormatLabel = (fmt: string | null) => {
    const labels: Record<string, string> = {
      'singles': '🎾 Singles',
      'doubles': '👥 Doubles',
      'mixed-doubles': '👫 Mixed',
      'maximize-courts': '⚡ Optimize',
      'king-of-court': '👑 King',
      'round-robin': '🔄 Round Robin',
      'single-elimination': '🏆 Tournament',
    };
    return labels[fmt || ''] || fmt || '';
  };

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-orange-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="font-semibold text-2xl sm:text-3xl mb-1">My Events</h1>
          <p className="text-gray-500">Manage your mixers and tournaments</p>
        </div>
        <Link href="/mixer/select-format" className="inline-flex items-center gap-2 px-4 py-2 bg-orange-500 text-white rounded-lg font-medium hover:bg-orange-600">
          <Plus size={18} />
          Create Event
        </Link>
      </div>

      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-white rounded-xl border p-4 flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl flex items-center justify-center bg-orange-100 text-orange-600">
            <Calendar size={22} />
          </div>
          <div>
            <div className="text-sm text-gray-500">Upcoming</div>
            <div className="text-2xl font-semibold">{upcomingEvents.length}</div>
          </div>
        </div>
        <div className="bg-white rounded-xl border p-4 flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl flex items-center justify-center bg-blue-100 text-blue-600">
            <Trophy size={22} />
          </div>
          <div>
            <div className="text-sm text-gray-500">Total Events</div>
            <div className="text-2xl font-semibold">{events.length}</div>
          </div>
        </div>
        <div className="bg-white rounded-xl border p-4 flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl flex items-center justify-center bg-green-100 text-green-600">
            <Users size={22} />
          </div>
          <div>
            <div className="text-sm text-gray-500">This Month</div>
            <div className="text-2xl font-semibold">{events.filter(e => {
              const d = new Date(e.event_date);
              const now = new Date();
              return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
            }).length}</div>
          </div>
        </div>
      </div>

      {events.length === 0 ? (
        <div className="bg-white rounded-xl border p-12 text-center">
          <Trophy size={48} className="mx-auto text-gray-300 mb-4" />
          <h3 className="font-semibold text-lg mb-2">No events yet</h3>
          <p className="text-gray-500 mb-4">Create your first event to get started.</p>
          <Link href="/mixer/select-format" className="inline-flex items-center gap-2 px-4 py-2 bg-orange-500 text-white rounded-lg font-medium hover:bg-orange-600">
            <Plus size={18} />
            Create Event
          </Link>
        </div>
      ) : (
        <div className="space-y-6">
          {upcomingEvents.length > 0 && (
            <div>
              <h2 className="font-semibold text-lg mb-3">Upcoming Events</h2>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {upcomingEvents.map((event) => (
                  <Link key={event.id} href={`/mixer/events/${event.id}`} className="bg-white rounded-xl border p-4 hover:shadow-md transition-all">
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex-1 min-w-0">
                        <h3 className="font-semibold text-lg truncate">{event.name}</h3>
                        <p className="text-sm text-gray-500">
                          {format(new Date(event.event_date), 'MMM d, yyyy')}
                          {event.start_time && ` at ${event.start_time}`}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-1 bg-orange-100 text-orange-600 rounded-lg text-xs font-mono">{event.event_code}</span>
                        <button
                          onClick={(e) => deleteEvent(event.id, e)}
                          disabled={deleting === event.id}
                          className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg"
                        >
                          {deleting === event.id ? <div className="w-4 h-4 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin" /> : <Trash2 size={16} />}
                        </button>
                      </div>
                    </div>
                    <div className="flex items-center gap-4 text-sm text-gray-500">
                      <span className="flex items-center gap-1"><Trophy size={14} />{event.num_courts} courts</span>
                      {event.match_format && <span className="text-xs">{getFormatLabel(event.match_format)}</span>}
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {pastEvents.length > 0 && (
            <div>
              <h2 className="font-semibold text-lg mb-3 text-gray-500">Past Events</h2>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {pastEvents.map((event) => (
                  <Link key={event.id} href={`/mixer/events/${event.id}`} className="bg-white rounded-xl border p-4 hover:shadow-md transition-all opacity-60">
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex-1 min-w-0">
                        <h3 className="font-semibold text-lg truncate">{event.name}</h3>
                        <p className="text-sm text-gray-500">
                          {format(new Date(event.event_date), 'MMM d, yyyy')}
                          {event.start_time && ` at ${event.start_time}`}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-1 bg-orange-100 text-orange-600 rounded-lg text-xs font-mono">{event.event_code}</span>
                        <button
                          onClick={(e) => deleteEvent(event.id, e)}
                          disabled={deleting === event.id}
                          className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg"
                        >
                          {deleting === event.id ? <div className="w-4 h-4 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin" /> : <Trash2 size={16} />}
                        </button>
                      </div>
                    </div>
                    <div className="flex items-center gap-4 text-sm text-gray-500">
                      <span className="flex items-center gap-1"><Trophy size={14} />{event.num_courts} courts</span>
                      {event.match_format && <span className="text-xs">{getFormatLabel(event.match_format)}</span>}
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
