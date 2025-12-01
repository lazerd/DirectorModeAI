'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Calendar, Clock, MapPin, User, Search, Plus, X, Loader2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { format, addHours } from 'date-fns';

type Coach = {
  id: string;
  display_name: string | null;
  status: string;
};

type Booking = {
  id: string;
  start_time: string;
  end_time: string;
  location: string | null;
  status: string;
  coach: {
    display_name: string | null;
  };
};

type SearchCoach = {
  id: string;
  display_name: string | null;
  email: string | null;
};

export default function ClientDashboard() {
  const router = useRouter();
  const [coaches, setCoaches] = useState<Coach[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [clientId, setClientId] = useState<string | null>(null);
  const [showFindCoach, setShowFindCoach] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchCoach[]>([]);
  const [searching, setSearching] = useState(false);
  const [requestingCoachId, setRequestingCoachId] = useState<string | null>(null);

  useEffect(() => {
    initClient();
  }, []);

  const initClient = async () => {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      router.push('/login?redirect=/client/dashboard');
      return;
    }

    // Find or create client record linked to this user
    let { data: client } = await supabase
      .from('lesson_clients')
      .select('id')
      .eq('profile_id', user.id)
      .single();

    if (!client) {
      // Create client record for this user
      const { data: newClient } = await supabase
        .from('lesson_clients')
        .insert({
          profile_id: user.id,
          name: user.user_metadata?.full_name || user.email?.split('@')[0] || 'Client',
          email: user.email
        })
        .select('id')
        .single();
      client = newClient;
    }

    if (client) {
      setClientId(client.id);
      fetchCoaches(client.id);
      fetchBookings(client.id);
    }
    setLoading(false);
  };

  const fetchCoaches = async (clientId: string) => {
    const supabase = createClient();
    const { data } = await supabase
      .from('lesson_client_coaches')
      .select('status, coach:lesson_coaches(id, display_name)')
      .eq('client_id', clientId);

    if (data) {
      setCoaches(data.map((d: any) => ({
        id: d.coach.id,
        display_name: d.coach.display_name,
        status: d.status
      })));
    }
  };

  const fetchBookings = async (clientId: string) => {
    const supabase = createClient();
    const { data } = await supabase
      .from('lesson_slots')
      .select('id, start_time, end_time, location, status, coach:lesson_coaches(display_name)')
      .eq('booked_by_client_id', clientId)
      .eq('status', 'booked')
      .gte('start_time', new Date().toISOString())
      .order('start_time');

    if (data) setBookings(data as any);
  };

  const searchCoaches = async (query: string) => {
    if (!query.trim()) {
      setSearchResults([]);
      return;
    }
    
    setSearching(true);
    const supabase = createClient();
    
    // Search coaches by display_name
    const { data } = await supabase
      .from('lesson_coaches')
      .select('id, display_name, profile:profile_id(email)')
      .ilike('display_name', `%${query}%`)
      .limit(10);

    if (data) {
      // Filter out coaches already connected
      const connectedCoachIds = coaches.map(c => c.id);
      const filtered = data
        .filter((c: any) => !connectedCoachIds.includes(c.id))
        .map((c: any) => ({
          id: c.id,
          display_name: c.display_name,
          email: c.profile?.email || null
        }));
      setSearchResults(filtered);
    }
    setSearching(false);
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      if (showFindCoach) {
        searchCoaches(searchQuery);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery, showFindCoach]);

  const requestCoach = async (coachId: string) => {
    if (!clientId) return;
    setRequestingCoachId(coachId);

    const supabase = createClient();

    // Create pending request
    const { error } = await supabase.from('lesson_client_coaches').insert({
      client_id: clientId,
      coach_id: coachId,
      status: 'pending',
      requested_at: new Date().toISOString()
    });

    if (error) {
      alert('Failed to send request. You may have already requested this coach.');
    } else {
      alert('Request sent! The coach will review your request.');
      setShowFindCoach(false);
      setSearchQuery('');
      setSearchResults([]);
      fetchCoaches(clientId);
    }
    setRequestingCoachId(null);
  };

  const cancelBooking = async (slotId: string, startTime: string) => {
    const cutoff = addHours(new Date(), 12);
    if (new Date(startTime) < cutoff) {
      alert('Cannot cancel within 12 hours of the lesson.');
      return;
    }

    if (!confirm('Are you sure you want to cancel this lesson?')) return;

    const supabase = createClient();
    await supabase
      .from('lesson_slots')
      .update({
        status: 'open',
        booked_by_client_id: null,
        booked_at: null,
        cancelled_at: new Date().toISOString()
      })
      .eq('id', slotId);

    if (clientId) fetchBookings(clientId);
  };

  const canCancel = (startTime: string) => {
    const cutoff = addHours(new Date(), 12);
    return new Date(startTime) >= cutoff;
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin h-8 w-8 border-4 border-blue-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  const approvedCoaches = coaches.filter(c => c.status === 'approved');
  const pendingCoaches = coaches.filter(c => c.status === 'pending');

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 py-4">
          <h1 className="text-xl font-bold">My Lessons</h1>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-6 space-y-6">
        {/* Upcoming Bookings */}
        <section>
          <h2 className="font-semibold text-lg mb-3">Upcoming Lessons</h2>
          {bookings.length === 0 ? (
            <div className="bg-white rounded-xl border p-6 text-center text-gray-500">
              <Calendar className="h-10 w-10 mx-auto mb-2 text-gray-300" />
              <p>No upcoming lessons</p>
            </div>
          ) : (
            <div className="space-y-3">
              {bookings.map((booking) => (
                <div key={booking.id} className="bg-white rounded-xl border p-4">
                  <div className="flex items-start justify-between">
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <User className="h-4 w-4 text-gray-400" />
                        <span className="font-medium">{booking.coach?.display_name || 'Coach'}</span>
                      </div>
                      <div className="flex items-center gap-2 text-sm text-gray-600">
                        <Calendar className="h-4 w-4" />
                        <span>{format(new Date(booking.start_time), 'EEEE, MMMM d')}</span>
                      </div>
                      <div className="flex items-center gap-2 text-sm text-gray-600">
                        <Clock className="h-4 w-4" />
                        <span>{format(new Date(booking.start_time), 'h:mm a')} - {format(new Date(booking.end_time), 'h:mm a')}</span>
                      </div>
                      {booking.location && (
                        <div className="flex items-center gap-2 text-sm text-gray-600">
                          <MapPin className="h-4 w-4" />
                          <span>{booking.location}</span>
                        </div>
                      )}
                    </div>
                    {canCancel(booking.start_time) && (
                      <button
                        onClick={() => cancelBooking(booking.id, booking.start_time)}
                        className="text-red-500 text-sm hover:underline"
                      >
                        Cancel
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* My Coaches */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-lg">My Coaches</h2>
            <button
              onClick={() => setShowFindCoach(true)}
              className="flex items-center gap-1 text-blue-600 text-sm font-medium"
            >
              <Plus className="h-4 w-4" />
              Find a Coach
            </button>
          </div>

          {pendingCoaches.length > 0 && (
            <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4 mb-3">
              <p className="text-sm text-yellow-800 font-medium mb-2">Pending Requests</p>
              {pendingCoaches.map((coach) => (
                <div key={coach.id} className="flex items-center gap-2 text-sm text-yellow-700">
                  <Clock className="h-4 w-4" />
                  <span>{coach.display_name || 'Coach'} - waiting for approval</span>
                </div>
              ))}
            </div>
          )}

          {approvedCoaches.length === 0 ? (
            <div className="bg-white rounded-xl border p-6 text-center text-gray-500">
              <User className="h-10 w-10 mx-auto mb-2 text-gray-300" />
              <p>No coaches yet</p>
              <button
                onClick={() => setShowFindCoach(true)}
                className="mt-2 text-blue-600 text-sm font-medium"
              >
                Find your first coach
              </button>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {approvedCoaches.map((coach) => (
                <button
                  key={coach.id}
                  onClick={() => router.push(`/client/coach/${coach.id}`)}
                  className="bg-white rounded-xl border p-4 text-left hover:border-blue-400 hover:shadow-sm transition-all"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
                      <User className="h-5 w-5 text-blue-600" />
                    </div>
                    <div>
                      <p className="font-medium">{coach.display_name || 'Coach'}</p>
                      <p className="text-sm text-blue-600">View availability →</p>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>
      </main>

      {/* Find Coach Modal */}
      {showFindCoach && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl p-6 w-full max-w-md max-h-[80vh] overflow-hidden flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-lg">Find a Coach</h2>
              <button onClick={() => { setShowFindCoach(false); setSearchQuery(''); setSearchResults([]); }} className="text-gray-400 hover:text-gray-600">
                <X className="h-5 w-5" />
              </button>
            </div>
            
            <div className="relative mb-4">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border rounded-lg"
                placeholder="Search by coach name..."
                autoFocus
              />
            </div>

            <div className="flex-1 overflow-y-auto">
              {searching ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-blue-500" />
                </div>
              ) : searchQuery && searchResults.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  <p>No coaches found matching "{searchQuery}"</p>
                </div>
              ) : searchResults.length > 0 ? (
                <div className="space-y-2">
                  {searchResults.map((coach) => (
                    <div key={coach.id} className="flex items-center justify-between p-3 border rounded-lg hover:bg-gray-50">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
                          <User className="h-5 w-5 text-blue-600" />
                        </div>
                        <div>
                          <p className="font-medium">{coach.display_name || 'Coach'}</p>
                        </div>
                      </div>
                      <button
                        onClick={() => requestCoach(coach.id)}
                        disabled={requestingCoachId === coach.id}
                        className="px-3 py-1 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50"
                      >
                        {requestingCoachId === coach.id ? 'Sending...' : 'Request'}
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-gray-500">
                  <Search className="h-10 w-10 mx-auto mb-2 text-gray-300" />
                  <p>Search for a coach by name</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
