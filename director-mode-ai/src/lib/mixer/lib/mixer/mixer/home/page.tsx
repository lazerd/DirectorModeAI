'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { Plus, Calendar, Trophy, Users, Clock, Trash2, ArrowLeft } from 'lucide-react';
import { format } from 'date-fns';

interface Event {
  id: string;
  name: string;
  event_date: string;
  start_time: string;
  num_courts: number;
  scoring_format: string;
  match_format: string;
  event_code: string;
}

export default function MixerHomePage() {
  const router = useRouter();
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  useEffect(() => {
    fetchEvents();
  }, []);

  const fetchEvents = async () => {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      router.push('/login');
      return;
    }

    const { data, error } = await supabase
      .from('events')
      .select('*')
      .eq('user_id', user.id)
      .order('event_date', { ascending: false });

    if (!error && data) {
      setEvents(data);
    }
    setLoading(false);
  };

  const deleteEvent = async (eventId: string) => {
    const supabase = createClient();
    await supabase.from('events').delete().eq('id', eventId);
    setEvents(events.filter(e => e.id !== eventId));
    setDeleteConfirm(null);
  };

  const getScoringLabel = (format: string) => {
    switch (format) {
      case 'timed': return 'Timed Rounds';
      case 'fixed_games': return 'Fixed Games';
      case 'first_to_x': return 'First to X';
      default: return format;
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 via-white to-orange-50">
      <header className="border-b bg-white/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/" className="p-2 hover:bg-gray-100 rounded-lg">
              <ArrowLeft size={20} />
            </Link>
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-orange-500 rounded-lg flex items-center justify-center">
                <Trophy className="text-white" size={18} />
              </div>
              <h1 className="text-xl font-bold">MixerMode AI</h1>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h2 className="text-3xl font-bold mb-2">Your Events</h2>
            <p className="text-gray-600">Manage your tennis & pickleball mixers</p>
          </div>
          <Link
            href="/mixer/select-format"
            className="flex items-center gap-2 px-6 py-3 bg-orange-500 text-white rounded-xl font-semibold hover:bg-orange-600 transition-colors"
          >
            <Plus size={20} />
            New Event
          </Link>
        </div>

        {loading ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="bg-white rounded-xl border p-6 animate-pulse">
                <div className="h-6 bg-gray-200 rounded mb-4 w-3/4"></div>
                <div className="h-4 bg-gray-100 rounded mb-2 w-1/2"></div>
                <div className="h-4 bg-gray-100 rounded w-1/3"></div>
              </div>
            ))}
          </div>
        ) : events.length === 0 ? (
          <div className="bg-white rounded-xl border-2 border-dashed p-16 text-center">
            <Trophy size={64} className="mx-auto text-gray-300 mb-4" />
            <h3 className="text-xl font-semibold mb-2">No events yet</h3>
            <p className="text-gray-500 mb-6">Create your first tennis or pickleball mixer to get started</p>
            <Link
              href="/mixer/select-format"
              className="inline-flex items-center gap-2 px-6 py-3 bg-orange-500 text-white rounded-xl font-semibold hover:bg-orange-600"
            >
              <Plus size={20} />
              Create Event
            </Link>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {events.map((event) => (
              <div
                key={event.id}
                className="bg-white rounded-xl border hover:shadow-lg transition-shadow cursor-pointer relative group"
                onClick={() => router.push(`/mixer/events/${event.id}`)}
              >
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setDeleteConfirm(event.id);
                  }}
                  className="absolute top-3 right-3 p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <Trash2 size={18} />
                </button>
                
                <div className="p-6">
                  <div className="flex items-start justify-between mb-3">
                    <h3 className="font-bold text-lg line-clamp-2">{event.name}</h3>
                    <Trophy className="text-orange-500 flex-shrink-0 ml-2" size={20} />
                  </div>
                  
                  <p className="text-sm text-gray-500 mb-4">
                    {format(new Date(event.event_date), 'EEEE, MMMM d, yyyy')}
                  </p>
                  
                  <div className="space-y-2 text-sm text-gray-600">
                    <div className="flex items-center gap-2">
                      <Clock size={16} />
                      <span>{event.start_time || 'Time TBD'}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Users size={16} />
                      <span>{event.num_courts} {event.num_courts === 1 ? 'court' : 'courts'}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Calendar size={16} />
                      <span>{getScoringLabel(event.scoring_format)}</span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {/* Delete Confirmation Modal */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl p-6 max-w-md w-full">
            <h3 className="text-lg font-bold mb-2">Delete Event</h3>
            <p className="text-gray-600 mb-6">
              Are you sure? This will permanently delete all rounds, matches, and player data.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setDeleteConfirm(null)}
                className="flex-1 px-4 py-2 border rounded-lg hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={() => deleteEvent(deleteConfirm)}
                className="flex-1 px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
