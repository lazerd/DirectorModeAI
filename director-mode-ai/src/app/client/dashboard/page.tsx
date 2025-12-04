'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Calendar, Clock, MapPin, User, X, LogOut } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { format, parseISO, isPast } from 'date-fns';

type Booking = {
  id: string;
  start_time: string;
  end_time: string;
  location: string | null;
  status: string;
  coach: {
    display_name: string | null;
    slug: string | null;
  };
};

export default function ClientDashboardPage() {
  const router = useRouter();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [clientId, setClientId] = useState<string | null>(null);
  const [clientName, setClientName] = useState<string>('');
  const [cancelling, setCancelling] = useState<string | null>(null);

  useEffect(() => {
    loadBookings();
  }, []);

  const loadBookings = async () => {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      router.push('/login?redirect=/client/dashboard');
      return;
    }

    // Get client record
    const { data: client } = await supabase
      .from('lesson_clients')
      .select('id, name')
      .eq('profile_id', user.id)
      .single();

    if (!client) {
      setLoading(false);
      return;
    }

    setClientId(client.id);
    setClientName(client.name || user.email || 'Client');

    // Get all booked slots for this client
    const { data: slots } = await supabase
      .from('lesson_slots')
      .select(`
        id,
        start_time,
        end_time,
        location,
        status,
        coach_id,
        lesson_coaches (
          display_name,
          slug
        )
      `)
      .eq('booked_by_client_id', client.id)
      .eq('status', 'booked')
      .order('start_time', { ascending: true });

    if (slots) {
      const formattedBookings = slots.map((slot: any) => ({
        id: slot.id,
        start_time: slot.start_time,
        end_time: slot.end_time,
        location: slot.location,
        status: slot.status,
        coach: {
          display_name: slot.lesson_coaches?.display_name || 'Coach',
          slug: slot.lesson_coaches?.slug
        }
      }));
      setBookings(formattedBookings);
    }

    setLoading(false);
  };

  const handleSignOut = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/');
  };

  const cancelBooking = async (slotId: string) => {
    if (!confirm('Are you sure you want to cancel this lesson?')) return;
    
    setCancelling(slotId);
    const supabase = createClient();

    const { error } = await supabase
      .from('lesson_slots')
      .update({
        status: 'open',
        booked_by_client_id: null,
        booked_at: null
      })
      .eq('id', slotId);

    if (error) {
      alert('Failed to cancel booking. Please try again.');
    } else {
      setBookings(bookings.filter(b => b.id !== slotId));
    }
    setCancelling(null);
  };

  const upcomingBookings = bookings.filter(b => !isPast(parseISO(b.start_time)));
  const pastBookings = bookings.filter(b => isPast(parseISO(b.start_time)));

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin h-8 w-8 border-4 border-blue-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">My Lessons</h1>
            <p className="text-gray-500">Welcome, {clientName}</p>
          </div>
          <button
            onClick={handleSignOut}
            className="flex items-center gap-2 px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg"
          >
            <LogOut className="h-4 w-4" />
            Sign Out
          </button>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-6">
        {bookings.length === 0 ? (
          <div className="bg-white rounded-xl border p-8 text-center">
            <Calendar className="h-12 w-12 text-gray-300 mx-auto mb-4" />
            <h2 className="text-xl font-semibold mb-2">No lessons booked</h2>
            <p className="text-gray-600 mb-6">
              You have not booked any lessons yet.
            </p>
            
              <a href="/find-coach"
              className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 inline-block"
            >
              Find a Coach
            </a>
          </div>
        ) : (
          <>
            {/* Upcoming Lessons */}
            <div className="mb-8">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold">Upcoming Lessons ({upcomingBookings.length})</h2>
                <a href="/find-coach" className="text-blue-600 hover:underline text-sm">+ Find a Coach</a>
              </div>
              {upcomingBookings.length === 0 ? (
                <div className="bg-white rounded-xl border p-6 text-center text-gray-500">
                  No upcoming lessons
                </div>
              ) : (
                <div className="space-y-4">
                  {upcomingBookings.map((booking) => (
                    <div
                      key={booking.id}
                      className="bg-white rounded-xl border p-4 flex items-center justify-between"
                    >
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center">
                          <User className="h-6 w-6 text-blue-600" />
                        </div>
                        <div>
                          <p className="font-semibold">{booking.coach.display_name}</p>
                          <div className="flex items-center gap-4 text-sm text-gray-600 mt-1">
                            <div className="flex items-center gap-1">
                              <Calendar className="h-4 w-4" />
                              {format(parseISO(booking.start_time), 'EEE, MMM d, yyyy')}
                            </div>
                            <div className="flex items-center gap-1">
                              <Clock className="h-4 w-4" />
                              {format(parseISO(booking.start_time), 'h:mm a')} - {format(parseISO(booking.end_time), 'h:mm a')}
                            </div>
                          </div>
                          {booking.location && (
                            <div className="flex items-center gap-1 text-sm text-gray-500 mt-1">
                              <MapPin className="h-4 w-4" />
                              {booking.location}
                            </div>
                          )}
                        </div>
                      </div>
                      <button
                        onClick={() => cancelBooking(booking.id)}
                        disabled={cancelling === booking.id}
                        className="p-2 text-red-500 hover:bg-red-50 rounded-lg disabled:opacity-50"
                        title="Cancel booking"
                      >
                        {cancelling === booking.id ? (
                          <div className="animate-spin h-5 w-5 border-2 border-red-500 border-t-transparent rounded-full" />
                        ) : (
                          <X className="h-5 w-5" />
                        )}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Past Lessons */}
            {pastBookings.length > 0 && (
              <div>
                <h2 className="text-lg font-semibold mb-4 text-gray-500">Past Lessons ({pastBookings.length})</h2>
                <div className="space-y-4 opacity-60">
                  {pastBookings.map((booking) => (
                    <div
                      key={booking.id}
                      className="bg-white rounded-xl border p-4 flex items-center gap-4"
                    >
                      <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center">
                        <User className="h-6 w-6 text-gray-400" />
                      </div>
                      <div>
                        <p className="font-semibold">{booking.coach.display_name}</p>
                        <div className="flex items-center gap-4 text-sm text-gray-600 mt-1">
                          <div className="flex items-center gap-1">
                            <Calendar className="h-4 w-4" />
                            {format(parseISO(booking.start_time), 'EEE, MMM d, yyyy')}
                          </div>
                          <div className="flex items-center gap-1">
                            <Clock className="h-4 w-4" />
                            {format(parseISO(booking.start_time), 'h:mm a')}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
